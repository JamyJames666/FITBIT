import { DayRow, HIGHER_IS_BETTER, METRIC_LABELS, MetricKey, interpolate, series } from './frame'
import { seededRandom, standardise } from '../stats'

// A Gaussian hidden Markov model over the daily vector. The layers above this
// one all score a day against a baseline, which treats every day as
// independent. A body is not independent day to day, it sits in a condition for
// a stretch and then moves, so the useful question is which condition you are in
// and how long it usually lasts. Three latent states, diagonal covariance
// emissions, fitted by Baum-Welch, with the day-by-day path recovered by
// Viterbi.
// The state count is chosen by BIC rather than asserted. Three is the obvious
// guess and it is often right, but a body that spent the window in one
// condition genuinely has fewer, and BIC's parameter penalty is what stops the
// model inventing states to fit noise.
const STATE_RANGE = [2, 3, 4]
const MODEL_METRICS: MetricKey[] = ['hrv', 'restingHeartRate', 'sleepMinutes', 'activeMinutes']
const MIN_DAYS = 42
const MAX_ITER = 200
const TOLERANCE = 1e-6
const RESTARTS = 8

// Diagonal variances collapse toward zero on a state that captures only a
// handful of near-identical days, which sends its density to infinity and
// freezes the model on that state. The floor is in standardised units, so 0.01
// is a tenth of a standard deviation.
const VARIANCE_FLOOR = 0.01

// Mean absolute standardised distance from the baseline, below which a state is
// named Typical rather than given a verdict.
const TYPICAL_SPREAD = 0.35

export interface StateProfile {
  metric: MetricKey
  label: string
  z: number
  direction: 'above' | 'below'
}

export interface HiddenState {
  index: number
  name: string
  share: number
  meanDwellDays: number
  profile: StateProfile[]
}

export interface StateModel {
  metrics: MetricKey[]
  states: HiddenState[]
  path: Array<{ date: string; state: number; confidence: number }>
  current: {
    state: number
    name: string
    runLength: number
    meanDwellDays: number
    changeTomorrow: number
    likelyNext: { state: number; name: string; probability: number } | null
  } | null
  transitions: number[][]
  logLikelihood: number
  iterations: number
  stateCount: number
  bic: number
  n: number
}

interface Params {
  pi: number[]
  a: number[][]
  mu: number[][]
  variance: number[][]
}

function logGaussianRow(x: number[], mu: number[], variance: number[]): number {
  let sum = 0
  for (let d = 0; d < x.length; d++) {
    const diff = x[d] - mu[d]
    sum += -0.5 * (Math.log(2 * Math.PI * variance[d]) + (diff * diff) / variance[d])
  }
  return sum
}

// Emission densities are built in log space and then exponentiated relative to
// each row's own maximum. A raw product of four Gaussian densities underflows to
// zero on an unusual day, and a zero row makes the forward pass divide by zero.
function emissions(x: number[][], p: Params): number[][] {
  return x.map((row) => {
    const logs = p.mu.map((mu, j) => logGaussianRow(row, mu, p.variance[j]))
    const top = Math.max(...logs)
    return logs.map((l) => Math.exp(l - top))
  })
}

// Scaled forward-backward. The scale factors are kept because the sum of their
// logs is the log likelihood, which is what decides between random restarts.
function forwardBackward(b: number[][], p: Params) {
  const t = b.length
  const k = p.pi.length
  const alpha: number[][] = Array.from({ length: t }, () => new Array(k).fill(0))
  const beta: number[][] = Array.from({ length: t }, () => new Array(k).fill(0))
  const scale = new Array(t).fill(0)

  for (let j = 0; j < k; j++) alpha[0][j] = p.pi[j] * b[0][j]
  scale[0] = alpha[0].reduce((s, v) => s + v, 0) || 1
  for (let j = 0; j < k; j++) alpha[0][j] /= scale[0]

  for (let i = 1; i < t; i++) {
    for (let j = 0; j < k; j++) {
      let sum = 0
      for (let m = 0; m < k; m++) sum += alpha[i - 1][m] * p.a[m][j]
      alpha[i][j] = sum * b[i][j]
    }
    scale[i] = alpha[i].reduce((s, v) => s + v, 0) || 1
    for (let j = 0; j < k; j++) alpha[i][j] /= scale[i]
  }

  for (let j = 0; j < k; j++) beta[t - 1][j] = 1
  for (let i = t - 2; i >= 0; i--) {
    for (let j = 0; j < k; j++) {
      let sum = 0
      for (let m = 0; m < k; m++) sum += p.a[j][m] * b[i + 1][m] * beta[i + 1][m]
      beta[i][j] = sum / scale[i + 1]
    }
  }

  const gamma: number[][] = Array.from({ length: t }, () => new Array(k).fill(0))
  for (let i = 0; i < t; i++) {
    let total = 0
    for (let j = 0; j < k; j++) {
      gamma[i][j] = alpha[i][j] * beta[i][j]
      total += gamma[i][j]
    }
    for (let j = 0; j < k; j++) gamma[i][j] = total > 0 ? gamma[i][j] / total : 1 / k
  }

  const xi: number[][][] = Array.from({ length: Math.max(0, t - 1) }, () =>
    Array.from({ length: k }, () => new Array(k).fill(0)),
  )
  for (let i = 0; i < t - 1; i++) {
    let total = 0
    for (let m = 0; m < k; m++) {
      for (let j = 0; j < k; j++) {
        const v = alpha[i][m] * p.a[m][j] * b[i + 1][j] * beta[i + 1][j]
        xi[i][m][j] = v
        total += v
      }
    }
    for (let m = 0; m < k; m++) {
      for (let j = 0; j < k; j++) xi[i][m][j] = total > 0 ? xi[i][m][j] / total : 1 / (k * k)
    }
  }

  const logLik = scale.reduce((s, v) => s + Math.log(v), 0)
  return { gamma, xi, logLik }
}

function reestimate(x: number[][], gamma: number[][], xi: number[][][]): Params {
  const t = x.length
  const k = gamma[0].length
  const d = x[0].length

  const pi = gamma[0].slice()

  const a: number[][] = Array.from({ length: k }, () => new Array(k).fill(0))
  for (let i = 0; i < k; i++) {
    let denom = 0
    for (let s = 0; s < t - 1; s++) denom += gamma[s][i]
    for (let j = 0; j < k; j++) {
      let num = 0
      for (let s = 0; s < t - 1; s++) num += xi[s][i][j]
      a[i][j] = denom > 0 ? num / denom : 1 / k
    }
  }

  const mu: number[][] = Array.from({ length: k }, () => new Array(d).fill(0))
  const variance: number[][] = Array.from({ length: k }, () => new Array(d).fill(1))
  for (let j = 0; j < k; j++) {
    let weight = 0
    for (let s = 0; s < t; s++) weight += gamma[s][j]
    if (weight <= 0) continue
    for (let c = 0; c < d; c++) {
      let sum = 0
      for (let s = 0; s < t; s++) sum += gamma[s][j] * x[s][c]
      mu[j][c] = sum / weight
    }
    for (let c = 0; c < d; c++) {
      let sum = 0
      for (let s = 0; s < t; s++) {
        const diff = x[s][c] - mu[j][c]
        sum += gamma[s][j] * diff * diff
      }
      variance[j][c] = Math.max(VARIANCE_FLOOR, sum / weight)
    }
  }

  return { pi, a, mu, variance }
}

// Random restarts rather than one run, because Baum-Welch only ever climbs to a
// local optimum and the one it reaches depends entirely on where it started.
function initialise(x: number[][], k: number, rand: () => number): Params {
  const d = x[0].length
  const mu: number[][] = Array.from({ length: k }, () => {
    const row = x[Math.floor(rand() * x.length)]
    return row.map((v) => v + (rand() - 0.5) * 0.5)
  })
  // Started with a bias toward staying put, which is the prior that a body
  // holds a condition for more than one day at a time.
  const a = Array.from({ length: k }, (_, i) => {
    const row = new Array(k).fill(0.3 / (k - 1))
    row[i] = 0.7
    return row
  })
  return {
    pi: new Array(k).fill(1 / k),
    a,
    mu,
    variance: Array.from({ length: k }, () => new Array(d).fill(1)),
  }
}

function fitK(
  x: number[][],
  k: number,
): { params: Params; logLik: number; iterations: number } | null {
  const rand = seededRandom(7 + k)
  let best: { params: Params; logLik: number; iterations: number } | null = null

  for (let restart = 0; restart < RESTARTS; restart++) {
    let params = initialise(x, k, rand)
    let previous = -Infinity
    let iterations = 0
    let logLik = -Infinity
    let failed = false

    for (let iter = 0; iter < MAX_ITER; iter++) {
      const b = emissions(x, params)
      const { gamma, xi, logLik: ll } = forwardBackward(b, params)
      if (!Number.isFinite(ll)) {
        failed = true
        break
      }
      params = reestimate(x, gamma, xi)
      iterations = iter + 1
      logLik = ll
      if (Math.abs(ll - previous) < TOLERANCE) break
      previous = ll
    }

    if (failed || !Number.isFinite(logLik)) continue
    if (!best || logLik > best.logLik) best = { params, logLik, iterations }
  }

  return best
}

// Free parameters are the initial distribution, the transition rows and the
// diagonal Gaussian means and variances, each counted net of the simplex
// constraint that makes every row sum to one.
function parameterCount(k: number, d: number): number {
  return k - 1 + k * (k - 1) + 2 * k * d
}

function fit(
  x: number[][],
): { params: Params; logLik: number; iterations: number; stateCount: number; bic: number } | null {
  let best:
    | { params: Params; logLik: number; iterations: number; stateCount: number; bic: number }
    | null = null
  for (const k of STATE_RANGE) {
    const candidate = fitK(x, k)
    if (!candidate) continue
    const bic =
      -2 * candidate.logLik + parameterCount(k, x[0].length) * Math.log(x.length)
    if (!best || bic < best.bic) best = { ...candidate, stateCount: k, bic }
  }
  return best
}

function viterbi(x: number[][], p: Params): number[] {
  const t = x.length
  const k = p.pi.length
  const logA = p.a.map((row) => row.map((v) => Math.log(Math.max(v, 1e-12))))
  const delta: number[][] = Array.from({ length: t }, () => new Array(k).fill(-Infinity))
  const psi: number[][] = Array.from({ length: t }, () => new Array(k).fill(0))

  for (let j = 0; j < k; j++) {
    delta[0][j] = Math.log(Math.max(p.pi[j], 1e-12)) + logGaussianRow(x[0], p.mu[j], p.variance[j])
  }
  for (let i = 1; i < t; i++) {
    for (let j = 0; j < k; j++) {
      let bestValue = -Infinity
      let bestFrom = 0
      for (let m = 0; m < k; m++) {
        const v = delta[i - 1][m] + logA[m][j]
        if (v > bestValue) {
          bestValue = v
          bestFrom = m
        }
      }
      delta[i][j] = bestValue + logGaussianRow(x[i], p.mu[j], p.variance[j])
      psi[i][j] = bestFrom
    }
  }

  const path = new Array(t).fill(0)
  let last = 0
  for (let j = 1; j < k; j++) if (delta[t - 1][j] > delta[t - 1][last]) last = j
  path[t - 1] = last
  for (let i = t - 2; i >= 0; i--) path[i] = psi[i + 1][path[i + 1]]
  return path
}

// States come out of EM in no meaningful order, so they are named by what their
// own mean vector says rather than by index. Without this the same state is
// called 1 on one run and 3 on the next and no sentence built on it survives a
// refresh.
function nameStates(mu: number[][]): string[] {
  const recovery = mu.map((row) =>
    row.reduce((sum, v, d) => {
      const metric = MODEL_METRICS[d]
      if (metric === 'activeMinutes') return sum
      return sum + (HIGHER_IS_BETTER[metric] ? v : -v)
    }, 0),
  )
  const order = recovery.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const ladder =
    mu.length >= 4
      ? ['Strained', 'Flat', 'Holding', 'Recovered']
      : mu.length === 3
        ? ['Strained', 'Holding', 'Recovered']
        : ['Strained', 'Recovered']

  const names = new Array(mu.length).fill('Typical')
  order.forEach((entry, rank) => {
    // A state whose mean sits on top of the baseline is the baseline, whatever
    // rank it came out at. Naming purely by rank calls an unremarkable state
    // "Recovered" the moment it happens to be the better of two, which reads as
    // a verdict on a day the model is making no claim about.
    const spread = mu[entry.i].reduce((sum, v) => sum + Math.abs(v), 0) / mu[entry.i].length
    if (spread < TYPICAL_SPREAD) return
    names[entry.i] = ladder[Math.min(rank, ladder.length - 1)]
  })
  return names
}

export function fitStates(frame: DayRow[]): StateModel | null {
  const columns = MODEL_METRICS.map((m) => interpolate(series(frame, m), 2))
  const rows: number[][] = []
  const dates: string[] = []
  frame.forEach((day, i) => {
    const row = columns.map((c) => c[i])
    if (row.some((v) => v == null)) return
    rows.push(row as number[])
    dates.push(day.date)
  })
  if (rows.length < MIN_DAYS) return null

  const byColumn = MODEL_METRICS.map((_, d) => rows.map((r) => r[d]))
  const { z } = standardise(byColumn)
  const x = rows.map((_, i) => z.map((col) => col[i]))

  const fitted = fit(x)
  if (!fitted) return null
  const { params, logLik, iterations, stateCount, bic } = fitted

  const path = viterbi(x, params)
  const { gamma } = forwardBackward(emissions(x, params), params)
  const names = nameStates(params.mu)

  const states: HiddenState[] = params.mu.map((mu, j) => {
    const occupancy = path.filter((s) => s === j).length
    const stay = params.a[j][j]
    return {
      index: j,
      name: names[j],
      share: occupancy / path.length,
      meanDwellDays: stay >= 1 ? Infinity : 1 / (1 - stay),
      profile: mu
        .map((v, d) => ({
          metric: MODEL_METRICS[d],
          label: METRIC_LABELS[MODEL_METRICS[d]],
          z: v,
          direction: (v >= 0 ? 'above' : 'below') as 'above' | 'below',
        }))
        .sort((a, b) => Math.abs(b.z) - Math.abs(a.z)),
    }
  })

  const lastState = path[path.length - 1]
  let runLength = 1
  for (let i = path.length - 2; i >= 0 && path[i] === lastState; i--) runLength++
  const outward = params.a[lastState]
    .map((probability, state) => ({ state, name: names[state], probability }))
    .filter((entry) => entry.state !== lastState)
    .sort((a, b) => b.probability - a.probability)

  return {
    metrics: MODEL_METRICS,
    states,
    path: dates.map((date, i) => ({
      date,
      state: path[i],
      confidence: gamma[i][path[i]],
    })),
    current: {
      state: lastState,
      name: names[lastState],
      runLength,
      meanDwellDays: states[lastState].meanDwellDays,
      changeTomorrow: 1 - params.a[lastState][lastState],
      likelyNext: outward[0] ?? null,
    },
    transitions: params.a,
    logLikelihood: logLik,
    iterations,
    stateCount,
    bic,
    n: rows.length,
  }
}
