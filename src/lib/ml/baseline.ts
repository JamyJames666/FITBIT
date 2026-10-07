import { ewma, finite, mad, mean, median, stdev } from '../stats'
import { DayRow, MetricKey, series } from './frame'

export interface Baseline {
  metric: MetricKey
  n: number
  centre: number
  scale: number
  robustCentre: number
  robustScale: number
  ewmaFast: number
  ewmaSlow: number
  latest: number | null
}

// Fast tracks roughly the last week, slow roughly the last month. The gap
// between them is what "trending up" means everywhere else in this folder.
export const ALPHA_FAST = 2 / (7 + 1)
export const ALPHA_SLOW = 2 / (28 + 1)

export function baselineFor(frame: DayRow[], metric: MetricKey): Baseline | null {
  const raw = series(frame, metric)
  const xs = finite(raw)
  if (xs.length < 3) return null

  const smoothFast = ewma(xs, ALPHA_FAST)
  const smoothSlow = ewma(xs, ALPHA_SLOW)
  const lastIndex = raw.length - 1
  let latest: number | null = null
  for (let i = lastIndex; i >= 0; i--) {
    if (raw[i] != null) {
      latest = raw[i] as number
      break
    }
  }

  return {
    metric,
    n: xs.length,
    centre: mean(xs),
    scale: stdev(xs),
    robustCentre: median(xs),
    robustScale: mad(xs),
    ewmaFast: smoothFast[smoothFast.length - 1],
    ewmaSlow: smoothSlow[smoothSlow.length - 1],
    latest,
  }
}
