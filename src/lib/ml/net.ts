import { DayRow, METRIC_LABELS, METRIC_UNITS, MetricKey, interpolate, series } from './frame'
import { mean, seededRandom, stdev } from '../stats'

// A two layer network trained to predict tomorrow's heart rate variability from
// today's vector. Ridge regression next door answers the same question with a
// straight line, which is the right default and usually enough. This exists for
// the part a line cannot represent, where the effect of a hard day depends on
// how well slept you already were.
//
// It is trained on the first 80 per cent of days and scored on the last 20,
// which it never sees. The score it is compared against is persistence, so
// "tomorrow equals today", because that is a genuinely hard baseline on a
// physiological signal and most published models quietly lose to it. If this
// network loses too, the result says so and the dashboard draws no chart.
const TARGET: MetricKey = 'hrv'
const INPUTS: MetricKey[] = [
  'hrv',
  'restingHeartRate',
  'sleepMinutes',
  'steps',
  'activeMinutes',
]
const HIDDEN = 8
const EPOCHS = 400
const LEARNING_RATE = 0.01
const L2 = 1e-4
const TRAIN_SPLIT = 0.8
const MIN_DAYS = 45

// Adam's published defaults. Plain gradient descent on this few samples either
// crawls or diverges depending on the learning rate, and tuning one by hand per
// person is not a thing a dashboard can do.
const BETA1 = 0.9
const BETA2 = 0.999
const EPSILON = 1e-8

export interface NetImportance {
  metric: MetricKey
  label: string
  increaseInError: number
  // Negative means the error went DOWN when this input was shuffled, so the
  // network is being actively misled by it. Surfaced rather than clipped at
  // zero, because a bar chart of clipped values makes a harmful input look like
  // a weak but helpful one.
  harmful: boolean
}

export interface NetResult {
  target: MetricKey
  targetLabel: string
  unit: string
  inputs: MetricKey[]
  hidden: number
  trainDays: number
  testDays: number
  rmse: number
  baselineRmse: number
  improvement: number
  beatsBaseline: boolean
  importance: NetImportance[]
  predictions: Array<{ date: string; actual: number; predicted: number }>
  epochs: number
  finalTrainLoss: number
}

interface Weights {
  w1: number[][]
  b1: number[]
  w2: number[]
  b2: number
}

function forward(w: Weights, x: number[]): { hidden: number[]; output: number } {
  const hidden = w.b1.map((bias, h) => {
    let sum = bias
    for (let i = 0; i < x.length; i++) sum += w.w1[h][i] * x[i]
    // tanh rather than ReLU. On five standardised inputs and a few dozen rows a
    // ReLU unit that starts negative gets no gradient and stays dead for the
    // whole run, which on a hidden layer this narrow means losing a quarter of
    // the capacity.
    return Math.tanh(sum)
  })
  let output = w.b2
  for (let h = 0; h < hidden.length; h++) output += w.w2[h] * hidden[h]
  return { hidden, output }
}

function rmse(pairs: Array<{ actual: number; predicted: number }>): number {
  if (pairs.length === 0) return NaN
  let sum = 0
  for (const p of pairs) sum += (p.actual - p.predicted) ** 2
  return Math.sqrt(sum / pairs.length)
}

export function trainNet(frame: DayRow[]): NetResult | null {
  const columns = INPUTS.map((m) => interpolate(series(frame, m), 2))
  const targetColumn = interpolate(series(frame, TARGET), 2)

  const x: number[][] = []
  const y: number[] = []
  const dates: string[] = []
  // Paired today to tomorrow, so the last day has no label and is dropped.
  for (let i = 0; i < frame.length - 1; i++) {
    const row = columns.map((c) => c[i])
    const label = targetColumn[i + 1]
    if (row.some((v) => v == null) || label == null) continue
    x.push(row as number[])
    y.push(label)
    dates.push(frame[i + 1].date)
  }
  if (x.length < MIN_DAYS) return null

  const split = Math.floor(x.length * TRAIN_SPLIT)
  if (split < 24 || x.length - split < 6) return null

  // Centres and scales come from the training rows only. Computing them over
  // everything leaks the test period's mean into training and quietly flatters
  // the result.
  const centres = INPUTS.map((_, d) => mean(x.slice(0, split).map((r) => r[d])))
  const scales = INPUTS.map((_, d) => {
    const s = stdev(x.slice(0, split).map((r) => r[d]))
    return Number.isFinite(s) && s > 0 ? s : 1
  })
  const yCentre = mean(y.slice(0, split))
  const yScale = stdev(y.slice(0, split)) || 1

  const xz = x.map((row) => row.map((v, d) => (v - centres[d]) / scales[d]))
  const yz = y.map((v) => (v - yCentre) / yScale)

  const rand = seededRandom(1337)
  const d = INPUTS.length
  // Xavier scaling on the initial weights, so the pre-activation sum starts
  // inside tanh's responsive range rather than saturated flat at one end.
  const spread = Math.sqrt(1 / d)
  const w: Weights = {
    w1: Array.from({ length: HIDDEN }, () =>
      Array.from({ length: d }, () => (rand() * 2 - 1) * spread),
    ),
    b1: new Array(HIDDEN).fill(0),
    w2: Array.from({ length: HIDDEN }, () => (rand() * 2 - 1) * Math.sqrt(1 / HIDDEN)),
    b2: 0,
  }

  const m: Weights = {
    w1: Array.from({ length: HIDDEN }, () => new Array(d).fill(0)),
    b1: new Array(HIDDEN).fill(0),
    w2: new Array(HIDDEN).fill(0),
    b2: 0,
  }
  const v: Weights = {
    w1: Array.from({ length: HIDDEN }, () => new Array(d).fill(0)),
    b1: new Array(HIDDEN).fill(0),
    w2: new Array(HIDDEN).fill(0),
    b2: 0,
  }

  let step = 0
  let finalLoss = NaN
  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    const gw1 = Array.from({ length: HIDDEN }, () => new Array(d).fill(0))
    const gb1 = new Array(HIDDEN).fill(0)
    const gw2 = new Array(HIDDEN).fill(0)
    let gb2 = 0
    let loss = 0

    for (let i = 0; i < split; i++) {
      const { hidden, output } = forward(w, xz[i])
      const error = output - yz[i]
      loss += error * error
      gb2 += 2 * error
      for (let h = 0; h < HIDDEN; h++) {
        gw2[h] += 2 * error * hidden[h]
        const dh = 2 * error * w.w2[h] * (1 - hidden[h] * hidden[h])
        gb1[h] += dh
        for (let j = 0; j < d; j++) gw1[h][j] += dh * xz[i][j]
      }
    }

    loss /= split
    finalLoss = loss
    step++
    const correction1 = 1 - Math.pow(BETA1, step)
    const correction2 = 1 - Math.pow(BETA2, step)

    const apply = (
      value: number,
      grad: number,
      first: number,
      second: number,
    ): [number, number, number] => {
      const g = grad / split + L2 * value
      const nextFirst = BETA1 * first + (1 - BETA1) * g
      const nextSecond = BETA2 * second + (1 - BETA2) * g * g
      const update =
        (LEARNING_RATE * (nextFirst / correction1)) /
        (Math.sqrt(nextSecond / correction2) + EPSILON)
      return [value - update, nextFirst, nextSecond]
    }

    for (let h = 0; h < HIDDEN; h++) {
      for (let j = 0; j < d; j++) {
        const [nw, nm, nv] = apply(w.w1[h][j], gw1[h][j], m.w1[h][j], v.w1[h][j])
        w.w1[h][j] = nw
        m.w1[h][j] = nm
        v.w1[h][j] = nv
      }
      const [nb, nmb, nvb] = apply(w.b1[h], gb1[h], m.b1[h], v.b1[h])
      w.b1[h] = nb
      m.b1[h] = nmb
      v.b1[h] = nvb
      const [n2, nm2, nv2] = apply(w.w2[h], gw2[h], m.w2[h], v.w2[h])
      w.w2[h] = n2
      m.w2[h] = nm2
      v.w2[h] = nv2
    }
    const [nb2, nmb2, nvb2] = apply(w.b2, gb2, m.b2, v.b2)
    w.b2 = nb2
    m.b2 = nmb2
    v.b2 = nvb2
  }

  const predict = (row: number[]) => forward(w, row).output * yScale + yCentre
  const test: Array<{ date: string; actual: number; predicted: number }> = []
  for (let i = split; i < xz.length; i++) {
    test.push({ date: dates[i], actual: y[i], predicted: predict(xz[i]) })
  }

  const modelError = rmse(test)
  // Persistence, so today's value as tomorrow's prediction. Input 0 is today's
  // HRV in native units.
  const baselineError = rmse(
    test.map((t, i) => ({ actual: t.actual, predicted: x[split + i][0] })),
  )
  if (!Number.isFinite(modelError) || !Number.isFinite(baselineError)) return null

  // Permutation importance. Each input is shuffled across the test rows in turn
  // and the error is remeasured, so a feature the network leans on shows up as a
  // large increase. Read off the fitted model rather than from the weights,
  // because a weight in the first layer of a network says very little on its own.
  const importance: NetImportance[] = INPUTS.map((metric, column) => {
    const shuffleRand = seededRandom(99 + column)
    const permuted = xz.slice(split).map((r) => [...r])
    for (let i = permuted.length - 1; i > 0; i--) {
      const j = Math.floor(shuffleRand() * (i + 1))
      const swap = permuted[i][column]
      permuted[i][column] = permuted[j][column]
      permuted[j][column] = swap
    }
    const shuffledError = rmse(
      permuted.map((row, i) => ({ actual: test[i].actual, predicted: predict(row) })),
    )
    const delta = shuffledError - modelError
    return {
      metric,
      label: METRIC_LABELS[metric],
      increaseInError: delta,
      harmful: delta < 0,
    }
  }).sort((a, b) => b.increaseInError - a.increaseInError)

  return {
    target: TARGET,
    targetLabel: METRIC_LABELS[TARGET],
    unit: METRIC_UNITS[TARGET],
    inputs: INPUTS,
    hidden: HIDDEN,
    trainDays: split,
    testDays: test.length,
    rmse: modelError,
    baselineRmse: baselineError,
    improvement: (baselineError - modelError) / baselineError,
    beatsBaseline: modelError < baselineError,
    importance,
    predictions: test,
    epochs: EPOCHS,
    finalTrainLoss: finalLoss,
  }
}
