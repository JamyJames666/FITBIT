import { DayRow, METRIC_LABELS, METRIC_UNITS, MetricKey, interpolate, series } from './frame'
import { cholLogDet, cholSolve, cholesky, mean, stdev } from '../stats'

// Gaussian process regression on the day index. Holt-Winters next door gives a
// point forecast and an interval built from its own past error, which assumes
// the error is one size everywhere and asserts a trend whether or not there is
// one. A GP instead puts a prior over functions and returns a posterior, and
// the hyperparameters it selects are themselves the readout. A length scale at
// or beyond the window with a high noise term is the model saying there is no
// short-term structure here, which is a real answer and not a failure.
//
// Nothing is fitted by gradient descent. The hyperparameters are chosen by
// scoring the exact log marginal likelihood over a grid, which is cheap at this
// many days and cannot diverge.
const HORIZON = 14
const MIN_DAYS = 30
const Z95 = 1.96

// A sum of three kernels. The long RBF term is the trend, the periodic term is
// the weekly rhythm, and white noise is the measurement error that stops the
// covariance matrix being singular.
// Capped near the window length on purpose. Beyond it the RBF term is flat
// across every pair of days and all larger values score the same, so a bigger
// grid buys nothing and only hides the fact that the model found no trend.
const LENGTH_SCALES = [3, 5, 10, 20, 40, 80, 120]
const PERIODIC_WEIGHTS = [0, 0.25, 0.5, 1]
// The grid has to bracket the optimum on both sides. An earlier version stopped
// at 0.4 and every metric selected exactly 0.4, which is the tell that the best
// value was outside the grid rather than in it.
const NOISE_LEVELS = [0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1.2, 1.8, 2.6]
const WEEKLY_PERIOD = 7
const PERIODIC_LENGTH = 1.5
const NON_NEGATIVE: MetricKey[] = ['steps', 'distance', 'calories', 'activeMinutes', 'sleepMinutes']

export interface GpForecast {
  metric: MetricKey
  label: string
  unit: string
  history: Array<{ date: string; value: number }>
  predictions: Array<{ day: number; mean: number; lower: number; upper: number }>
  hyperparameters: { lengthScale: number; periodicWeight: number; noise: number }
  structure: 'trend and weekly rhythm' | 'weekly rhythm only' | 'mostly day to day noise'
  logMarginalLikelihood: number
  n: number
}

function kernel(
  a: number,
  b: number,
  lengthScale: number,
  periodicWeight: number,
): number {
  const diff = a - b
  const rbf = Math.exp(-(diff * diff) / (2 * lengthScale * lengthScale))
  const sine = Math.sin((Math.PI * Math.abs(diff)) / WEEKLY_PERIOD)
  const periodic = Math.exp(-(2 * sine * sine) / (PERIODIC_LENGTH * PERIODIC_LENGTH))
  return rbf + periodicWeight * periodic
}

function gram(
  xs: number[],
  lengthScale: number,
  periodicWeight: number,
  noise: number,
): number[][] {
  const n = xs.length
  const k: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const v = kernel(xs[i], xs[j], lengthScale, periodicWeight)
      k[i][j] = v
      k[j][i] = v
    }
    k[i][i] += noise
  }
  return k
}

// The exact expression, so -0.5 yt K-1 y - 0.5 log|K| - n/2 log 2pi. The middle
// term is what stops the search picking the smallest noise on offer, because a
// tight fit that needs a near-singular K is punished by its own determinant.
function logMarginalLikelihood(l: number[][], y: number[], alpha: number[]): number {
  let fit = 0
  for (let i = 0; i < y.length; i++) fit += y[i] * alpha[i]
  return -0.5 * fit - 0.5 * cholLogDet(l) - (y.length / 2) * Math.log(2 * Math.PI)
}

export function gpForecast(frame: DayRow[], metric: MetricKey): GpForecast | null {
  const raw = interpolate(series(frame, metric), 2)
  const xs: number[] = []
  const ys: number[] = []
  const history: Array<{ date: string; value: number }> = []
  frame.forEach((day, i) => {
    const v = raw[i]
    if (v == null) return
    xs.push(i)
    ys.push(v)
    history.push({ date: day.date, value: v })
  })
  if (ys.length < MIN_DAYS) return null

  const centre = mean(ys)
  const scale = stdev(ys) || 1
  const y = ys.map((v) => (v - centre) / scale)

  let best: {
    l: number[][]
    alpha: number[]
    score: number
    lengthScale: number
    periodicWeight: number
    noise: number
  } | null = null

  for (const lengthScale of LENGTH_SCALES) {
    for (const periodicWeight of PERIODIC_WEIGHTS) {
      for (const noise of NOISE_LEVELS) {
        const l = cholesky(gram(xs, lengthScale, periodicWeight, noise))
        if (!l) continue
        const alpha = cholSolve(l, y)
        const score = logMarginalLikelihood(l, y, alpha)
        if (!Number.isFinite(score)) continue
        if (!best || score > best.score) {
          best = { l, alpha, score, lengthScale, periodicWeight, noise }
        }
      }
    }
  }
  if (!best) return null

  const lastIndex = xs[xs.length - 1]
  const predictions: GpForecast['predictions'] = []
  for (let h = 1; h <= HORIZON; h++) {
    const star = lastIndex + h
    const kStar = xs.map((x) => kernel(x, star, best.lengthScale, best.periodicWeight))
    let posteriorMean = 0
    for (let i = 0; i < kStar.length; i++) posteriorMean += kStar[i] * best.alpha[i]

    const v = cholSolve(best.l, kStar)
    let explained = 0
    for (let i = 0; i < kStar.length; i++) explained += kStar[i] * v[i]
    const prior = kernel(star, star, best.lengthScale, best.periodicWeight) + best.noise
    const variance = Math.max(1e-9, prior - explained)
    const sd = Math.sqrt(variance)

    // Floored for anything that cannot go negative. A symmetric interval on a
    // step count happily predicts minus eleven thousand steps.
    const floorAtZero = NON_NEGATIVE.includes(metric)
    const toNative = (z: number) => {
      const v = z * scale + centre
      return floorAtZero ? Math.max(0, v) : v
    }
    predictions.push({
      day: h,
      mean: toNative(posteriorMean),
      lower: toNative(posteriorMean - Z95 * sd),
      upper: toNative(posteriorMean + Z95 * sd),
    })
  }

  // Read off the selected kernel rather than asserted. A length scale short
  // enough to bend inside the window is a trend, a periodic weight that
  // survived selection is a weekly rhythm, and neither means the series is
  // dominated by noise.
  const foundTrend = best.lengthScale < ys.length / 2
  const foundRhythm = best.periodicWeight > 0
  const structure: GpForecast['structure'] = foundTrend
    ? 'trend and weekly rhythm'
    : foundRhythm
      ? 'weekly rhythm only'
      : 'mostly day to day noise'

  return {
    metric,
    label: METRIC_LABELS[metric],
    unit: METRIC_UNITS[metric],
    history: history.slice(-42),
    structure,
    predictions,
    hyperparameters: {
      lengthScale: best.lengthScale,
      periodicWeight: best.periodicWeight,
      noise: best.noise,
    },
    logMarginalLikelihood: best.score,
    n: ys.length,
  }
}
