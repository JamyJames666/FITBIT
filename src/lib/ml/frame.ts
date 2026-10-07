import { prisma } from '../prisma'
import { TIME_ZONE, localDateKey, startOfLocalDate, weekdayIndex } from '../time'

// Every model in this folder reads one shape, a row per local calendar day
// and a column per metric. Building it once means the eight models agree on
// what "Tuesday" meant instead of each re-deriving it.
export const FRAME_METRICS = {
  steps: { dataType: 'steps', agg: 'total' },
  distance: { dataType: 'distance', agg: 'total' },
  calories: { dataType: 'active-energy-burned', agg: 'total' },
  activeMinutes: { dataType: 'active-minutes', agg: 'total' },
  sleepMinutes: { dataType: 'sleep', agg: 'total' },
  restingHeartRate: { dataType: 'daily-resting-heart-rate', agg: 'avg' },
  hrv: { dataType: 'heart-rate-variability', agg: 'avg' },
  spo2: { dataType: 'oxygen-saturation', agg: 'avg' },
  heartRate: { dataType: 'heart-rate', agg: 'avg' },
} as const

export type MetricKey = keyof typeof FRAME_METRICS

export const METRIC_LABELS: Record<MetricKey, string> = {
  steps: 'Steps',
  distance: 'Distance',
  calories: 'Calories burned',
  activeMinutes: 'Active minutes',
  sleepMinutes: 'Sleep',
  restingHeartRate: 'Resting heart rate',
  hrv: 'Heart rate variability',
  spo2: 'Blood oxygen',
  heartRate: 'Heart rate',
}

export const METRIC_UNITS: Record<MetricKey, string> = {
  steps: 'steps',
  distance: 'm',
  calories: 'kcal',
  activeMinutes: 'min',
  sleepMinutes: 'min',
  restingHeartRate: 'bpm',
  hrv: 'ms',
  spo2: '%',
  heartRate: 'bpm',
}

// For these, higher is better, so a drop is the direction worth flagging.
export const HIGHER_IS_BETTER: Record<MetricKey, boolean> = {
  steps: true,
  distance: true,
  calories: true,
  activeMinutes: true,
  sleepMinutes: true,
  restingHeartRate: false,
  hrv: true,
  spo2: true,
  heartRate: false,
}

export interface DayRow {
  date: string
  weekday: number
  values: Partial<Record<MetricKey, number>>
}

interface AggRow {
  dataType: string
  day: string
  total: number | null
  avg: number | null
  n: number
}

// Health Connect records the same walk twice when both the watch and the
// phone see it. Within each type and day the wearable wins if it reported at
// all, and anything else is used only when it didn't.
const PREFERRED_SOURCE = 'FITBIT'

// A night's sleep starts the evening before the morning it belongs to, which is
// why the API itself filters sleep on civil_end_time. Bucketing it by start
// time puts two nights on one calendar day and none on the next, and every
// model downstream then sees a fourteen hour night followed by a missing one.
const ANCHOR_TO_END_TYPES = ['sleep']

export async function loadDayFrame(days: number): Promise<DayRow[]> {
  const until = new Date()
  const firstDate = localDateKey(new Date(until.getTime() - (days - 1) * 86_400_000))
  const since = startOfLocalDate(firstDate)
  const dataTypes = Array.from(new Set(Object.values(FRAME_METRICS).map((m) => m.dataType)))

  const rows = await prisma.$queryRawUnsafe<AggRow[]>(
    `WITH scoped AS (
       SELECT "dataType",
              to_char(
                (CASE WHEN "dataType" = ANY($6) THEN COALESCE("endTime", "startTime") ELSE "startTime" END)
                AT TIME ZONE 'UTC' AT TIME ZONE $4, 'YYYY-MM-DD'
              ) AS day,
              "value",
              "source"
       FROM "DataPoint"
       WHERE "dataType" = ANY($1)
         AND "startTime" >= $2
         AND "startTime" < $3
         AND "value" IS NOT NULL
     ), ranked AS (
       SELECT *, bool_or("source" = $5) OVER (PARTITION BY "dataType", day) AS has_preferred
       FROM scoped
     )
     SELECT "dataType",
            day,
            SUM("value")::float AS total,
            AVG("value")::float AS avg,
            COUNT(*)::int AS n
     FROM ranked
     WHERE NOT has_preferred OR "source" = $5
     GROUP BY 1, 2
     ORDER BY 2 ASC`,
    dataTypes,
    since,
    until,
    TIME_ZONE,
    PREFERRED_SOURCE,
    ANCHOR_TO_END_TYPES
  )

  const byDay = new Map<string, DayRow>()
  for (let i = 0; i < days; i++) {
    const date = localDateKey(new Date(since.getTime() + i * 86_400_000))
    byDay.set(date, { date, weekday: weekdayIndex(date), values: {} })
  }

  const metricsByDataType = new Map<string, MetricKey[]>()
  for (const [key, spec] of Object.entries(FRAME_METRICS) as Array<[MetricKey, { dataType: string; agg: string }]>) {
    const list = metricsByDataType.get(spec.dataType) ?? []
    list.push(key)
    metricsByDataType.set(spec.dataType, list)
  }

  for (const row of rows) {
    const day = byDay.get(row.day)
    if (!day) continue
    for (const key of metricsByDataType.get(row.dataType) ?? []) {
      const value = FRAME_METRICS[key].agg === 'total' ? row.total : row.avg
      if (value != null && Number.isFinite(value)) day.values[key] = value
    }
  }

  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export function series(frame: DayRow[], key: MetricKey): Array<number | null> {
  return frame.map((d) => d.values[key] ?? null)
}

// Linear interpolation across short gaps, so a single missing night does not
// split a series into two unusable halves. Gaps longer than maxGap are left
// as null for the caller to handle.
export function interpolate(values: Array<number | null>, maxGap = 2): Array<number | null> {
  const out = [...values]
  let i = 0
  while (i < out.length) {
    if (out[i] != null) {
      i++
      continue
    }
    let j = i
    while (j < out.length && out[j] == null) j++
    const before = i > 0 ? out[i - 1] : null
    const after = j < out.length ? out[j] : null
    const gap = j - i
    if (before != null && after != null && gap <= maxGap) {
      for (let k = i; k < j; k++) out[k] = before + ((after - before) * (k - i + 1)) / (gap + 1)
    }
    i = j
  }
  return out
}
