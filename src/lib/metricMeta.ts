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
