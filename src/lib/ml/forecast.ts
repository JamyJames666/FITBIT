import { finite, mean } from '../stats'
import { DayRow, MetricKey, interpolate, series } from './frame'
import { localDateKey } from '../time'

export interface ForecastPoint {
  date: string
  value: number
  lower80: number
  upper80: number
  lower95: number
  upper95: number
}

export interface Forecast {
  metric: MetricKey
  history: Array<{ date: string; value: number | null; fitted: number | null }>
  points: ForecastPoint[]
  rmse: number
  trendPerDay: number
}

// Holt-Winters with an additive weekly term, so a level, a slope and seven
// seasonal offsets, each nudged by every new observation. Smoothing constants
// are fixed rather than fitted because fitting three parameters on a few
// weeks of data overfits reliably.
const ALPHA = 0.3
const BETA = 0.05
const GAMMA = 0.3
const PERIOD = 7
const MIN_DAYS = PERIOD * 3

const Z80 = 1.2816
const Z95 = 1.96

// Counts and durations cannot go below zero. The interval is symmetric around
// the projection, so without this a wide band on a low-volume metric draws a
// floor at minus eleven thousand steps.
const NON_NEGATIVE: MetricKey[] = ['steps', 'distance', 'calories', 'activeMinutes', 'sleepMinutes']

export function forecast(frame: DayRow[], metric: MetricKey, horizon = 7): Forecast | null {
  const values = interpolate(series(frame, metric), 3)
  if (finite(values).length < MIN_DAYS) return null

  const firstIdx = values.findIndex((v) => v != null)
  const window = values.slice(firstIdx)
  const dates = frame.slice(firstIdx).map((d) => d.date)

  const seed = finite(window.slice(0, PERIOD * 2))
  if (seed.length < PERIOD) return null

  let level = mean(seed)
  let slope = (mean(finite(window.slice(PERIOD, PERIOD * 2))) - mean(finite(window.slice(0, PERIOD)))) / PERIOD
  if (!Number.isFinite(slope)) slope = 0

  const seasonal: number[] = Array.from({ length: PERIOD }, (_, i) => {
    const sameDay = finite(window.filter((_, j) => j % PERIOD === i))
    return sameDay.length ? mean(sameDay) - level : 0
  })

  const fitted: Array<number | null> = []
  const errors: number[] = []

  window.forEach((observed, i) => {
    const s = seasonal[i % PERIOD]
    const prediction = level + slope + s
    fitted.push(prediction)

    if (observed == null) {
      level = level + slope
      return
    }

    errors.push(observed - prediction)
    const prevLevel = level
    level = ALPHA * (observed - s) + (1 - ALPHA) * (level + slope)
    slope = BETA * (level - prevLevel) + (1 - BETA) * slope
    seasonal[i % PERIOD] = GAMMA * (observed - level) + (1 - GAMMA) * s
  })

  const rmse = errors.length ? Math.sqrt(mean(errors.map((e) => e * e))) : 0
  const lastDate = dates[dates.length - 1]
  const lastMs = new Date(`${lastDate}T12:00:00Z`).getTime()

  const floorAtZero = NON_NEGATIVE.includes(metric)
  const floor = (v: number) => (floorAtZero ? Math.max(0, v) : v)

  const points: ForecastPoint[] = []
  for (let h = 1; h <= horizon; h++) {
    const value = floor(level + h * slope + seasonal[(window.length + h - 1) % PERIOD])
    // Uncertainty grows with the square root of the horizon, the standard
    // random-walk widening. Three days out is not as knowable as tomorrow.
    const spread = rmse * Math.sqrt(h)
    points.push({
      date: localDateKey(new Date(lastMs + h * 86_400_000)),
      value,
      lower80: floor(value - Z80 * spread),
      upper80: value + Z80 * spread,
      lower95: floor(value - Z95 * spread),
      upper95: value + Z95 * spread,
    })
  }

  return {
    metric,
    history: dates.map((date, i) => ({ date, value: window[i], fitted: fitted[i] })),
    points,
    rmse,
    trendPerDay: slope,
  }
}
