import { DayRow, METRIC_LABELS, MetricKey, interpolate, series } from './frame'
import { covariance, jacobiEigen, standardise } from '../stats'

// Principal components of the standardised daily vector. Six metrics is six
// axes to read, and they are not independent, a long day moves steps and active
// minutes and calories together. This asks how many directions the data
// actually varies in, and usually the answer is two. The first component is
// nearly always overall load and the second is recovery, but the model is not
// told that, it is read off the loadings afterwards.
const FACTOR_METRICS: MetricKey[] = [
  'steps',
  'activeMinutes',
  'calories',
  'sleepMinutes',
  'restingHeartRate',
  'hrv',
]
const MIN_DAYS = 24
const COMPONENTS = 2

// A loading below this is left out of a component's name. Including everything
// makes every component sound like it is about everything.
const NAMING_FLOOR = 0.35

export interface Loading {
  metric: MetricKey
  label: string
  weight: number
}

export interface Component {
  index: number
  name: string
  explainedVariance: number
  loadings: Loading[]
}

export interface FactorResult {
  metrics: MetricKey[]
  components: Component[]
  totalExplained: number
  scores: Array<{ date: string; values: number[] }>
  n: number
}

function nameComponent(loadings: Loading[]): string {
  const heavy = loadings.filter((l) => Math.abs(l.weight) >= NAMING_FLOOR)
  if (heavy.length === 0) return 'Mixed'

  const activity = new Set<MetricKey>(['steps', 'activeMinutes', 'calories'])
  const recovery = new Set<MetricKey>(['sleepMinutes', 'hrv', 'restingHeartRate'])
  const activityWeight = heavy
    .filter((l) => activity.has(l.metric))
    .reduce((s, l) => s + Math.abs(l.weight), 0)
  const recoveryWeight = heavy
    .filter((l) => recovery.has(l.metric))
    .reduce((s, l) => s + Math.abs(l.weight), 0)

  if (activityWeight > recoveryWeight * 1.6) return 'How hard the day was'
  if (recoveryWeight > activityWeight * 1.6) return 'How well recovered you were'
  return 'Load against recovery'
}

export function factorise(frame: DayRow[]): FactorResult | null {
  const columns = FACTOR_METRICS.map((m) => interpolate(series(frame, m), 2))
  const rows: number[][] = []
  const dates: string[] = []
  frame.forEach((day, i) => {
    const row = columns.map((c) => c[i])
    if (row.some((v) => v == null)) return
    rows.push(row as number[])
    dates.push(day.date)
  })
  if (rows.length < MIN_DAYS) return null

  const byColumn = FACTOR_METRICS.map((_, d) => rows.map((r) => r[d]))
  const { z } = standardise(byColumn)
  // Standardised first, so this is the correlation matrix. On raw units steps
  // would carry a variance in the millions and own every component by itself.
  const { values, vectors } = jacobiEigen(covariance(z))

  const total = values.reduce((s, v) => s + Math.max(0, v), 0)
  if (!(total > 0)) return null
  const take = Math.min(COMPONENTS, values.length)

  const components: Component[] = []
  for (let c = 0; c < take; c++) {
    const loadings: Loading[] = FACTOR_METRICS.map((metric, d) => ({
      metric,
      label: METRIC_LABELS[metric],
      weight: vectors[d][c],
    })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    components.push({
      index: c,
      name: nameComponent(loadings),
      explainedVariance: Math.max(0, values[c]) / total,
      loadings,
    })
  }

  const scores = dates.map((date, i) => ({
    date,
    values: Array.from({ length: take }, (_, c) => {
      let sum = 0
      for (let d = 0; d < FACTOR_METRICS.length; d++) sum += z[d][i] * vectors[d][c]
      return sum
    }),
  }))

  return {
    metrics: FACTOR_METRICS,
    components,
    totalExplained: components.reduce((s, c) => s + c.explainedVariance, 0),
    scores,
    n: rows.length,
  }
}
