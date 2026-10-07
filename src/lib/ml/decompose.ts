import { finite, mean } from '../stats'
import { DayRow, MetricKey, interpolate, series } from './frame'
import { WEEKDAY_NAMES } from '../time'

export interface Decomposition {
  metric: MetricKey
  dates: string[]
  observed: Array<number | null>
  trend: Array<number | null>
  seasonal: Array<number | null>
  residual: Array<number | null>
  weekdayEffect: Array<{ weekday: string; effect: number }>
  strongestDay: { weekday: string; effect: number } | null
  weakestDay: { weekday: string; effect: number } | null
  seasonalStrength: number
}

const PERIOD = 7
const MIN_DAYS = PERIOD * 3

// Classical additive decomposition. A centred 7 day moving average is the
// trend, the average of what is left over on each weekday is the seasonal
// term, and whatever remains after removing both is the residual. Additive
// rather than multiplicative because these metrics do not scale with their
// own level the way revenue does.
export function decompose(frame: DayRow[], metric: MetricKey): Decomposition | null {
  const dates = frame.map((d) => d.date)
  const observed = series(frame, metric)
  const filled = interpolate(observed, 3)
  if (finite(filled).length < MIN_DAYS) return null

  const half = Math.floor(PERIOD / 2)
  const trend: Array<number | null> = filled.map((_, i) => {
    if (i < half || i >= filled.length - half) return null
    const window = finite(filled.slice(i - half, i + half + 1))
    return window.length === PERIOD ? mean(window) : null
  })

  const detrended = filled.map((v, i) => (v != null && trend[i] != null ? v - (trend[i] as number) : null))

  const byWeekday: number[][] = Array.from({ length: PERIOD }, () => [])
  detrended.forEach((v, i) => {
    if (v != null) byWeekday[frame[i].weekday].push(v)
  })

  const rawEffects = byWeekday.map((xs) => (xs.length ? mean(xs) : 0))
  const offset = mean(rawEffects)
  const effects = rawEffects.map((e) => e - offset)

  const seasonal = frame.map((d) => effects[d.weekday])
  const residual = filled.map((v, i) =>
    v != null && trend[i] != null ? v - (trend[i] as number) - seasonal[i] : null
  )

  const residualVar = variance(finite(residual))
  const detrendedVar = variance(finite(detrended))
  const seasonalStrength = detrendedVar > 0 ? Math.max(0, 1 - residualVar / detrendedVar) : 0

  const weekdayEffect = effects.map((effect, i) => ({ weekday: WEEKDAY_NAMES[i], effect }))
  const sorted = [...weekdayEffect].sort((a, b) => b.effect - a.effect)

  return {
    metric,
    dates,
    observed,
    trend,
    seasonal,
    residual,
    weekdayEffect,
    strongestDay: sorted[0] ?? null,
    weakestDay: sorted[sorted.length - 1] ?? null,
    seasonalStrength,
  }
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return mean(xs.map((x) => (x - m) ** 2))
}
