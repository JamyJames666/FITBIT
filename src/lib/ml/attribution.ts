import { mean, standardise, stdev } from '../stats'
import { DayRow, METRIC_LABELS, METRIC_UNITS, MetricKey } from './frame'

export interface Driver {
  metric: MetricKey
  label: string
  unit: string
  coefficient: number
  effectPerUnit: number
  direction: 'raises' | 'lowers'
  share: number
}

export interface Attribution {
  target: MetricKey
  targetLabel: string
  lagDays: number
  n: number
  r2: number
  drivers: Driver[]
  headline: string | null
}

// Ridge rather than plain least squares because these predictors move
// together. A day with more steps is a day with more active minutes and more
// calories. Ordinary regression splits a shared effect between collinear
// columns almost arbitrarily and produces coefficients that flip sign when
// one more day of data arrives. The penalty shrinks them toward zero
// together, which is stable enough to put on a dashboard.
const RIDGE_LAMBDA = 1.0
const MIN_ROWS = 14

// Solves (A + lambda I) b = y by Gauss-Jordan with partial pivoting. The
// matrix is at most 6x6 here, so there is no case for a linear algebra
// dependency.
function solve(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length
  const a = matrix.map((row, i) => [...row, rhs[i]])

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null
    ;[a[col], a[pivot]] = [a[pivot], a[col]]

    const d = a[col][col]
    for (let c = col; c <= n; c++) a[col][c] /= d

    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = a[r][col]
      if (factor === 0) continue
      for (let c = col; c <= n; c++) a[r][c] -= factor * a[col][c]
    }
  }

  return a.map((row) => row[n])
}

export function attribute(
  frame: DayRow[],
  target: MetricKey,
  predictors: MetricKey[],
  lagDays = 0
): Attribution | null {
  const usable = predictors.filter((p) => p !== target)
  if (!usable.length) return null

  const targetValues: number[] = []
  const predictorValues: number[][] = usable.map(() => [])

  for (let i = 0; i < frame.length; i++) {
    const outcomeIdx = i + lagDays
    if (outcomeIdx >= frame.length) break

    const y = frame[outcomeIdx].values[target]
    const xs = usable.map((p) => frame[i].values[p])
    if (y == null || xs.some((x) => x == null)) continue

    targetValues.push(y)
    xs.forEach((x, j) => predictorValues[j].push(x as number))
  }

  if (targetValues.length < MIN_ROWS) return null

  const targetSd = stdev(targetValues)
  if (!Number.isFinite(targetSd) || targetSd === 0) return null

  const { z, scales } = standardise(predictorValues)
  const targetMean = mean(targetValues)
  const zy = targetValues.map((v) => (v - targetMean) / targetSd)

  const p = usable.length
  const n = targetValues.length

  const xtx: number[][] = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => {
      let s = 0
      for (let r = 0; r < n; r++) s += z[i][r] * z[j][r]
      return s + (i === j ? RIDGE_LAMBDA : 0)
    })
  )

  const xty = Array.from({ length: p }, (_, i) => {
    let s = 0
    for (let r = 0; r < n; r++) s += z[i][r] * zy[r]
    return s
  })

  const beta = solve(xtx, xty)
  if (!beta || beta.some((b) => !Number.isFinite(b))) return null

  let ssRes = 0
  let ssTot = 0
  for (let r = 0; r < n; r++) {
    let pred = 0
    for (let i = 0; i < p; i++) pred += beta[i] * z[i][r]
    ssRes += (zy[r] - pred) ** 2
    ssTot += zy[r] ** 2
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot)

  const totalWeight = beta.reduce((s, b) => s + Math.abs(b), 0)

  const drivers: Driver[] = usable
    .map((metric, i) => ({
      metric,
      label: METRIC_LABELS[metric],
      unit: METRIC_UNITS[metric],
      coefficient: beta[i],
      // Back out of standardised space so the number means something in real
      // units, how much the target moves per one unit of this predictor with
      // everything else held still.
      effectPerUnit: (beta[i] * targetSd) / scales[i],
      direction: beta[i] >= 0 ? ('raises' as const) : ('lowers' as const),
      share: totalWeight === 0 ? 0 : Math.abs(beta[i]) / totalWeight,
    }))
    .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient))

  const top = drivers[0]
  const headline =
    top && Math.abs(top.coefficient) > 0.1 && r2 > 0.1
      ? `${top.label} ${top.direction} ${METRIC_LABELS[target].toLowerCase()} more than anything else measured`
      : null

  return {
    target,
    targetLabel: METRIC_LABELS[target],
    lagDays,
    n,
    r2,
    drivers,
    headline,
  }
}

export const ATTRIBUTION_UNITS = METRIC_UNITS
