// Which aggregation makes sense per data type when bucketing into
// hour/day buckets for the trend charts. Sum types are cumulative counters
// within a period (steps, distance); everything else is a point-in-time
// measurement, so it gets averaged instead. Dependency-free so client
// components can import it too.
export const SUM_TYPES = new Set([
  'steps',
  'distance',
  'active-energy-burned',
  'active-minutes',
  'active-zone-minutes',
  'floors',
  'total-calories',
])

// Data types that are already coarse (roughly one row per day/session) —
// bucketing them further doesn't help, so they're always fetched raw.
export const RAW_ALWAYS_TYPES = new Set([
  'sleep',
  'daily-resting-heart-rate',
  'daily-heart-rate-variability',
  'daily-oxygen-saturation',
  'daily-respiratory-rate',
  'daily-vo2-max',
  'weight',
  'body-fat',
  'height',
])

export function aggMode(dataType: string): 'sum' | 'avg' {
  return SUM_TYPES.has(dataType) ? 'sum' : 'avg'
}

// Picks the bucket granularity for a chart given how wide its *currently
// visible* window is — called per-chart (not once globally) so zooming
// into one metric doesn't affect any other chart's granularity.
// Matches each /api/summary metric key to the same series color its trend
// chart uses below, so a stat tile visually points at its own chart.
export const METRIC_ACCENT: Record<string, string> = {
  heartRate: 'var(--series-1)',
  steps: 'var(--series-2)',
  distance: 'var(--series-3)',
  calories: 'var(--series-4)',
  activeMinutes: 'var(--series-5)',
  hrv: 'var(--series-6)',
  spo2: 'var(--series-7)',
  restingHeartRate: 'var(--series-8)',
  sleep: 'var(--series-1)',
}

export function pickBucket(dataType: string, spanDays: number): 'none' | 'hour' | 'day' {
  if (RAW_ALWAYS_TYPES.has(dataType)) return 'none'
  const isSum = SUM_TYPES.has(dataType)
  if (spanDays <= 0.25) return 'none'
  if (spanDays <= 2) return isSum ? 'hour' : 'none'
  if (spanDays <= 10) return isSum ? 'day' : 'hour'
  return 'day'
}
