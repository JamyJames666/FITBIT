import { Attribution, attribute } from './attribution'
import { Anomaly, detectAnomalies } from './anomaly'
import { Baseline, baselineFor } from './baseline'
import { ClusterResult, clusterDays } from './cluster'
import { Decomposition, decompose } from './decompose'
import { Forecast, forecast } from './forecast'
import { DayRow, METRIC_LABELS, METRIC_UNITS, MetricKey, loadDayFrame } from './frame'
import { BAND_COPY, Readiness, computeReadiness } from './readiness'

export interface Decision {
  id: string
  headline: string
  detail: string
  tone: 'good' | 'warn' | 'neutral'
  source: string
}

export interface Insights {
  generatedAt: string
  windowDays: number
  daysWithData: number
  readiness: Readiness
  baselines: Baseline[]
  anomalies: Anomaly[]
  decomposition: Decomposition | null
  clusters: ClusterResult | null
  attributions: Attribution[]
  forecasts: Forecast[]
  decisions: Decision[]
}

const WINDOW_DAYS = 90
const ANOMALY_METRICS: MetricKey[] = [
  'restingHeartRate',
  'hrv',
  'sleepMinutes',
  'steps',
  'spo2',
  'activeMinutes',
]
const BASELINE_METRICS: MetricKey[] = [
  'steps',
  'sleepMinutes',
  'restingHeartRate',
  'hrv',
  'activeMinutes',
  'spo2',
]
const FORECAST_METRICS: MetricKey[] = ['steps', 'sleepMinutes', 'restingHeartRate']
const RECENT_ANOMALY_DAYS = 14
const SHOWN_ANOMALY_DAYS = 30
const MAX_ANOMALIES = 8

function formatValue(metric: MetricKey, value: number): string {
  if (metric === 'sleepMinutes') {
    const h = Math.floor(value / 60)
    const m = Math.round(value % 60)
    return `${h}h ${String(m).padStart(2, '0')}m`
  }
  if (value >= 1000) return Math.round(value).toLocaleString('en-GB')
  return value.toFixed(1)
}

// Dates reach the reader as "29 Sep", never as an ISO string. The ISO form is
// a storage format and reads as machine output in a sentence.
function humanDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function recent(anomalies: Anomaly[], days: number): Anomaly[] {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  return anomalies.filter((a) => a.date >= cutoff)
}

// Every statement here has to trace back to a number a model produced. The
// alternative is a dashboard that generates advice whether or not the data
// supports any, which is how health apps lose trust.
function buildDecisions(
  readiness: Readiness,
  anomalies: Anomaly[],
  baselines: Baseline[],
  decomposition: Decomposition | null,
  attributions: Attribution[],
  forecasts: Forecast[]
): Decision[] {
  const decisions: Decision[] = []

  if (readiness.score != null) {
    const copy = BAND_COPY[readiness.band]
    decisions.push({
      id: 'readiness',
      headline: `${copy.title} today, readiness ${Math.round(readiness.score)} out of 100`,
      detail: copy.advice,
      tone: readiness.band === 'push' ? 'good' : readiness.band === 'rest' ? 'warn' : 'neutral',
      source: 'Weighted composite of HRV, resting heart rate, sleep and load against your own baseline',
    })
  }

  const concerning = recent(anomalies, RECENT_ANOMALY_DAYS).filter((a) => a.concerning)
  const worst = concerning.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0]
  if (worst) {
    decisions.push({
      id: 'anomaly',
      headline: `${worst.label} was ${Math.abs(worst.z).toFixed(1)} deviations ${worst.direction} normal on ${humanDate(worst.date)}`,
      detail: `${formatValue(worst.metric, worst.value)} ${worst.unit} against a typical ${formatValue(worst.metric, worst.expected)} ${worst.unit}. Worth knowing what else happened that day.`,
      tone: 'warn',
      source: 'Robust z-score against a trailing 28 day median, scaled by median absolute deviation',
    })
  }

  if (readiness.load && (readiness.load.ratio > 1.4 || readiness.load.ratio < 0.7)) {
    const high = readiness.load.ratio > 1.4
    decisions.push({
      id: 'load',
      headline: high ? 'Your training load has spiked' : 'Your training load has dropped off',
      detail: high
        ? `The last 7 days carry ${readiness.load.ratio.toFixed(2)} times the load of the last 28. Ratios above roughly 1.5 are where injury risk climbs.`
        : `The last 7 days carry ${readiness.load.ratio.toFixed(2)} times the load of the last 28. Fitness starts to fade below about 0.8.`,
      tone: 'warn',
      source: 'Acute to chronic workload ratio, 7 day mean over 28 day mean',
    })
  }

  const trending = baselines
    .filter((b) => Number.isFinite(b.ewmaFast) && Number.isFinite(b.ewmaSlow) && b.robustScale > 0)
    .map((b) => ({ b, drift: (b.ewmaFast - b.ewmaSlow) / b.robustScale }))
    .filter((x) => Math.abs(x.drift) > 0.75)
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))[0]

  if (trending) {
    const up = trending.drift > 0
    decisions.push({
      id: 'trend',
      headline: `${METRIC_LABELS[trending.b.metric]} is trending ${up ? 'up' : 'down'}`,
      detail: `Your 7 day average sits at ${formatValue(trending.b.metric, trending.b.ewmaFast)} ${METRIC_UNITS[trending.b.metric]} against a 28 day average of ${formatValue(trending.b.metric, trending.b.ewmaSlow)}. That is a real shift, not noise.`,
      tone: 'neutral',
      source: 'Gap between a 7 day and a 28 day exponentially weighted average, measured in baseline deviations',
    })
  }

  if (decomposition?.strongestDay && decomposition.weakestDay && decomposition.seasonalStrength > 0.15) {
    decisions.push({
      id: 'weekday',
      headline: `${decomposition.weakestDay.weekday} is consistently your weakest day for ${METRIC_LABELS[decomposition.metric].toLowerCase()}`,
      detail: `Stripping out the trend, ${decomposition.weakestDay.weekday} runs ${formatValue(decomposition.metric, Math.abs(decomposition.weakestDay.effect))} ${METRIC_UNITS[decomposition.metric]} below average and ${decomposition.strongestDay.weekday} runs ${formatValue(decomposition.metric, Math.abs(decomposition.strongestDay.effect))} above.`,
      tone: 'neutral',
      source: 'Additive decomposition into trend, weekly pattern and residual',
    })
  }

  for (const attribution of attributions) {
    if (!attribution.headline) continue
    const top = attribution.drivers[0]
    decisions.push({
      id: `driver-${attribution.target}-${attribution.lagDays}`,
      headline: attribution.headline,
      detail: `Holding everything else still, each extra ${METRIC_UNITS[top.metric]} of ${top.label.toLowerCase()} moves ${attribution.targetLabel.toLowerCase()} by ${formatValue(attribution.target, Math.abs(top.effectPerUnit))} ${METRIC_UNITS[attribution.target]}. The model explains ${Math.round(attribution.r2 * 100)}% of the variation, so treat it as a lead, not a law.`,
      tone: 'neutral',
      source: `Ridge regression on ${attribution.n} days${attribution.lagDays ? `, predictors lagged ${attribution.lagDays} day` : ''}`,
    })
  }

  const sleepForecast = forecasts.find((f) => f.metric === 'sleepMinutes')
  if (sleepForecast && sleepForecast.points.length) {
    const week = sleepForecast.points.reduce((s, p) => s + p.value, 0) / sleepForecast.points.length
    decisions.push({
      id: 'forecast-sleep',
      headline: `On current form you average ${formatValue('sleepMinutes', week)} a night next week`,
      detail: `The model carries your level, your trend and your weekly rhythm forward. Typical error on past days is ${formatValue('sleepMinutes', sleepForecast.rmse)}, which is how wide to read the band.`,
      tone: week >= 7 * 60 ? 'good' : 'warn',
      source: 'Holt-Winters additive, weekly period, with a prediction interval from in-sample error',
    })
  }

  return decisions
}

export async function buildInsights(windowDays = WINDOW_DAYS): Promise<Insights> {
  const frame: DayRow[] = await loadDayFrame(windowDays)
  const daysWithData = frame.filter((d) => Object.keys(d.values).length > 0).length

  const readiness = computeReadiness(frame)

  const baselines = BASELINE_METRICS.map((m) => baselineFor(frame, m)).filter(
    (b): b is Baseline => b !== null
  )

  const anomalies = detectAnomalies(frame, ANOMALY_METRICS)

  // Picked by severity and then ordered by date. Taking the most recent few
  // instead buries a genuinely extreme week under a run of mild ones, which
  // is the opposite of what the list is for.
  const shown = [...recent(anomalies, SHOWN_ANOMALY_DAYS)]
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, MAX_ANOMALIES)
    .sort((a, b) => b.date.localeCompare(a.date))

  const decomposition = decompose(frame, 'steps') ?? decompose(frame, 'sleepMinutes')

  const clusters = clusterDays(frame)

  const attributions = [
    attribute(frame, 'sleepMinutes', ['steps', 'activeMinutes', 'calories', 'heartRate'], 0),
    attribute(frame, 'hrv', ['steps', 'activeMinutes', 'sleepMinutes', 'restingHeartRate'], 1),
  ].filter((a): a is Attribution => a !== null)

  const forecasts = FORECAST_METRICS.map((m) => forecast(frame, m, 7)).filter(
    (f): f is Forecast => f !== null
  )

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    daysWithData,
    readiness,
    baselines,
    anomalies: shown,
    decomposition,
    clusters,
    attributions,
    forecasts,
    decisions: buildDecisions(readiness, anomalies, baselines, decomposition, attributions, forecasts),
  }
}

export { BAND_COPY }
export type { Readiness, ReadinessComponent } from './readiness'
export type { Anomaly, Baseline, Decomposition, ClusterResult, Attribution, Forecast }
