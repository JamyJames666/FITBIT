import { finite, mad, median, zScore } from '../stats'
import { DayRow, HIGHER_IS_BETTER, METRIC_LABELS, METRIC_UNITS, MetricKey, series } from './frame'

export interface Anomaly {
  metric: MetricKey
  label: string
  date: string
  value: number
  expected: number
  unit: string
  z: number
  direction: 'above' | 'below'
  severity: 'watch' | 'notable' | 'extreme'
  concerning: boolean
}

// A day is scored against the 28 days before it, never including itself, so a
// run of bad days cannot quietly redefine normal and hide the next one.
const LOOKBACK_DAYS = 28
const MIN_HISTORY = 10
const WATCH = 2
const NOTABLE = 3
const EXTREME = 4

function severityFor(absZ: number): Anomaly['severity'] | null {
  if (absZ >= EXTREME) return 'extreme'
  if (absZ >= NOTABLE) return 'notable'
  if (absZ >= WATCH) return 'watch'
  return null
}

export function detectAnomalies(frame: DayRow[], metrics: MetricKey[]): Anomaly[] {
  const found: Anomaly[] = []

  for (const metric of metrics) {
    const values = series(frame, metric)

    for (let i = 0; i < values.length; i++) {
      const value = values[i]
      if (value == null) continue

      const window = finite(values.slice(Math.max(0, i - LOOKBACK_DAYS), i))
      if (window.length < MIN_HISTORY) continue

      const centre = median(window)
      const scale = mad(window)
      if (!Number.isFinite(scale) || scale === 0) continue

      const z = zScore(value, centre, scale)
      const severity = severityFor(Math.abs(z))
      if (!severity) continue

      const direction: Anomaly['direction'] = z > 0 ? 'above' : 'below'
      const good = HIGHER_IS_BETTER[metric]

      found.push({
        metric,
        label: METRIC_LABELS[metric],
        date: frame[i].date,
        value,
        expected: centre,
        unit: METRIC_UNITS[metric],
        z,
        direction,
        severity,
        concerning: good ? direction === 'below' : direction === 'above',
      })
    }
  }

  return found.sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.z) - Math.abs(a.z))
}
