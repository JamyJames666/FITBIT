import { clamp, finite, mean } from '../stats'
import { baselineFor } from './baseline'
import { DayRow, MetricKey, series } from './frame'
import { BAND_COPY, ReadinessBand } from './bands'

export interface ReadinessComponent {
  key: string
  label: string
  score: number
  weight: number
  detail: string
  available: boolean
}

export interface Readiness {
  score: number | null
  band: ReadinessBand
  components: ReadinessComponent[]
  load: { acute: number; chronic: number; ratio: number; verdict: string } | null
  coverage: number
}

// Each sub-score is a deviation from this body's own recent baseline mapped
// onto 0-100, not a comparison against population norms. A resting heart rate
// of 58 is unremarkable in general and a warning sign for someone who sits at
// 48. The weights sum to 1 and are renormalised over whichever components
// actually have data.
const WEIGHTS = {
  hrv: 0.3,
  restingHeartRate: 0.25,
  sleepDuration: 0.25,
  sleepConsistency: 0.1,
  load: 0.1,
}

// A logistic squash. One baseline standard deviation away from normal moves
// the sub-score about 23 points, so a single freak reading can't run away
// with the total.
function squash(z: number): number {
  return 100 / (1 + Math.exp(-z))
}

function deviationScore(latest: number | null, centre: number, scale: number, higherIsBetter: boolean): number | null {
  if (latest == null || !Number.isFinite(centre) || !Number.isFinite(scale) || scale === 0) return null
  const z = (latest - centre) / scale
  return clamp(squash(higherIsBetter ? z : -z), 0, 100)
}

const SLEEP_TARGET_MINUTES = 7.5 * 60

// Training load as an acute-to-chronic ratio, the last 7 days of effort
// against the last 28. Well under 1 is detraining, well over is a spike that
// tends to precede injury. The 0.8 to 1.3 window is the usual guidance.
function trainingLoad(frame: DayRow[]): Readiness['load'] {
  const effort = frame.map((d) => {
    const active = d.values.activeMinutes
    const calories = d.values.calories
    if (active == null && calories == null) return null
    return (active ?? 0) + (calories ?? 0) / 10
  })

  const acuteWindow = finite(effort.slice(-7))
  const chronicWindow = finite(effort.slice(-28))
  if (acuteWindow.length < 3 || chronicWindow.length < 10) return null

  const acute = mean(acuteWindow)
  const chronic = mean(chronicWindow)
  if (!Number.isFinite(chronic) || chronic === 0) return null

  const ratio = acute / chronic
  const verdict =
    ratio < 0.8 ? 'Detraining' : ratio > 1.5 ? 'Spiking' : ratio > 1.3 ? 'Ramping hard' : 'In the sweet spot'
  return { acute, chronic, ratio, verdict }
}

// Consistency is the spread of bedtimes, approximated by how much sleep
// duration itself varies night to night. A steady 6 hours scores better than
// an erratic mix of 4 and 9, which is what the research on sleep regularity
// actually finds.
function sleepConsistency(frame: DayRow[]): number | null {
  const nights = finite(series(frame, 'sleepMinutes').slice(-14))
  if (nights.length < 5) return null
  const avg = mean(nights)
  if (!Number.isFinite(avg) || avg === 0) return null
  const spread = Math.sqrt(mean(nights.map((n) => (n - avg) ** 2))) / avg
  return clamp(100 * (1 - spread / 0.35), 0, 100)
}

export function computeReadiness(frame: DayRow[]): Readiness {
  const components: ReadinessComponent[] = []

  const add = (
    key: string,
    label: string,
    weight: number,
    score: number | null,
    detail: string
  ) => {
    components.push({ key, label, weight, score: score ?? 0, detail, available: score != null })
  }

  const metricComponent = (metric: MetricKey, higherIsBetter: boolean) => {
    const base = baselineFor(frame, metric)
    if (!base) return { score: null as number | null, detail: 'Not enough history yet' }
    const score = deviationScore(base.latest, base.robustCentre, base.robustScale, higherIsBetter)
    if (score == null) return { score: null as number | null, detail: 'Not enough history yet' }
    const delta = (base.latest as number) - base.robustCentre
    const sign = delta >= 0 ? '+' : ''
    return { score, detail: `${sign}${delta.toFixed(1)} vs your usual ${base.robustCentre.toFixed(1)}` }
  }

  const hrv = metricComponent('hrv', true)
  add('hrv', 'Heart rate variability', WEIGHTS.hrv, hrv.score, hrv.detail)

  const rhr = metricComponent('restingHeartRate', false)
  add('restingHeartRate', 'Resting heart rate', WEIGHTS.restingHeartRate, rhr.score, rhr.detail)

  const sleepBase = baselineFor(frame, 'sleepMinutes')
  let sleepScore: number | null = null
  let sleepDetail = 'Not enough history yet'
  if (sleepBase?.latest != null) {
    const vsTarget = clamp(100 * (sleepBase.latest / SLEEP_TARGET_MINUTES), 0, 100)
    const vsSelf = deviationScore(sleepBase.latest, sleepBase.robustCentre, sleepBase.robustScale, true)
    sleepScore = vsSelf == null ? vsTarget : 0.5 * vsTarget + 0.5 * vsSelf
    sleepDetail = `${(sleepBase.latest / 60).toFixed(1)}h against a ${(SLEEP_TARGET_MINUTES / 60).toFixed(1)}h target`
  }
  add('sleepDuration', 'Sleep duration', WEIGHTS.sleepDuration, sleepScore, sleepDetail)

  const consistency = sleepConsistency(frame)
  add(
    'sleepConsistency',
    'Sleep consistency',
    WEIGHTS.sleepConsistency,
    consistency,
    consistency == null ? 'Needs five nights' : 'Spread of the last fortnight of nights'
  )

  const load = trainingLoad(frame)
  const loadScore = load ? clamp(100 - Math.abs(load.ratio - 1.05) * 180, 0, 100) : null
  add(
    'load',
    'Training load',
    WEIGHTS.load,
    loadScore,
    load ? `${load.verdict}, 7 day load is ${load.ratio.toFixed(2)}x the 28 day` : 'Needs ten days of activity'
  )

  const usable = components.filter((c) => c.available)
  const totalWeight = usable.reduce((s, c) => s + c.weight, 0)
  const score = totalWeight === 0 ? null : usable.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight

  const band: ReadinessBand =
    score == null || score < 35 ? 'rest' : score < 55 ? 'easy' : score < 75 ? 'steady' : 'push'

  return { score, band, components, load, coverage: totalWeight }
}

export { BAND_COPY }
export type { ReadinessBand }
