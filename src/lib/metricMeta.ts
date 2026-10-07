// Which aggregation makes sense per data type when bucketing for the trend
// charts. Sum types are cumulative counters within a period, so steps and
// distance. Everything else is a point-in-time measurement and gets averaged
// instead. Dependency-free so client components can import it too.
export const SUM_TYPES = new Set([
  'steps',
  'distance',
  'active-energy-burned',
  'active-minutes',
  'active-zone-minutes',
  'floors',
  'total-calories',
])

// Data types already at roughly one row per day or session. Bucketing them
// further doesn't help, so they're always fetched raw.
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

// Picks the bucket granularity for a chart from how wide its currently visible
// window is. Called per chart, not once globally, so zooming into one metric
// leaves every other chart's granularity alone.
export function pickBucket(dataType: string, spanDays: number): 'none' | 'hour' | 'day' {
  if (RAW_ALWAYS_TYPES.has(dataType)) return 'none'
  const isSum = SUM_TYPES.has(dataType)
  if (spanDays <= 0.25) return 'none'
  if (spanDays <= 2) return isSum ? 'hour' : 'none'
  if (spanDays <= 10) return isSum ? 'day' : 'hour'
  return 'day'
}
