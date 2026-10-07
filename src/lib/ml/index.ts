import { Attribution, attribute } from './attribution'
import { Anomaly, detectAnomalies } from './anomaly'
import { Baseline, baselineFor } from './baseline'
import { ClusterResult, clusterDays } from './cluster'
import { Decomposition, decompose } from './decompose'
import { Forecast, forecast } from './forecast'
import { DayRow, METRIC_LABELS, METRIC_UNITS, MetricKey, loadDayFrame } from './frame'
import { BAND_COPY, Readiness, computeReadiness } from './readiness'
import { FactorResult, factorise } from './factors'
import { ForestResult, isolationForest } from './isolation'
import { GpForecast, gpForecast } from './gp'
import { NetResult, trainNet } from './net'
import { StateModel, fitStates } from './states'

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
  states: StateModel | null
  factors: FactorResult | null
  forest: ForestResult | null
  gp: GpForecast[]
  net: NetResult | null
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
const GP_METRICS: MetricKey[] = ['hrv', 'sleepMinutes', 'steps']
const DEEP_WINDOW_DAYS = 365
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

// Groups the contributors by direction before listing them, so three metrics
// that all moved the same way read as one clause rather than as "above baseline
// and above baseline and above baseline".
function describeContributors(
  contributors: Array<{ label: string; z: number }>
): string {
  const list = (names: string[]) =>
    names.length <= 1
      ? names.join('')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

  const above = contributors.filter((c) => c.z >= 0).map((c) => c.label.toLowerCase())
  const below = contributors.filter((c) => c.z < 0).map((c) => c.label.toLowerCase())
  const parts: string[] = []
  if (above.length) parts.push(`${list(above)} ${above.length > 1 ? 'all ' : ''}above baseline`)
  if (below.length) parts.push(`${list(below)} ${below.length > 1 ? 'all ' : ''}below baseline`)
  return parts.join(', with ')
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
  forecasts: Forecast[],
  states: StateModel | null,
  forest: ForestResult | null,
  net: NetResult | null
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

  // The state model earns a line only when it has something to say, so either
  // the current condition is not the ordinary one, or the run has already gone
  // past how long that condition usually lasts.
  if (states?.current) {
    const { name, runLength, meanDwellDays, changeTomorrow, likelyNext } = states.current
    const overdue = Number.isFinite(meanDwellDays) && runLength > meanDwellDays
    if (name !== 'Typical' || overdue) {
      const dwell = Number.isFinite(meanDwellDays) ? `${meanDwellDays.toFixed(1)} days` : 'unclear'
      decisions.push({
        id: 'state',
        headline: `${runLength} ${runLength === 1 ? 'day' : 'days'} in the ${name.toLowerCase()} state`,
        detail:
          `That state has typically run ${dwell} at a time, and the fitted transition ` +
          `probabilities put the chance of moving tomorrow at ${Math.round(changeTomorrow * 100)} per cent` +
          (likelyNext ? `, most likely into ${likelyNext.name.toLowerCase()}.` : '.'),
        tone: name === 'Strained' ? 'warn' : name === 'Recovered' ? 'good' : 'neutral',
        source: `Gaussian hidden Markov model, ${states.stateCount} states chosen by BIC, path by Viterbi`,
      })
    }
  }

  // Only reported when the univariate detector did not already have the day. A
  // combination anomaly that is also a plain outlier tells the reader nothing
  // the line above it did not.
  const alreadyFlagged = new Set(anomalies.filter((a) => a.concerning).map((a) => a.date))
  const combination = forest?.flagged.find((f) => !alreadyFlagged.has(f.date))
  if (combination) {
    decisions.push({
      id: 'combination',
      headline: `${humanDate(combination.date)} was unusual as a whole day, not in any one number`,
      detail:
        `No single metric was extreme enough to flag on its own. The combination was, driven by ` +
        describeContributors(combination.contributors) +
        '.',
      tone: 'warn',
      source: `Isolation forest, ${forest?.trees} trees on ${forest?.metrics.length} metrics together`,
    })
  }

  // The network reports whichever way the comparison went. A model that loses
  // to persistence and says nothing is the thing this dashboard exists not to
  // be, so the losing case gets a line too.
  if (net) {
    const top = net.importance[0]
    decisions.push({
      id: 'net',
      headline: net.beatsBaseline
        ? `Tomorrow's ${net.targetLabel.toLowerCase()} is ${Math.round(net.improvement * 100)} per cent more predictable than guessing today's`
        : `Tomorrow's ${net.targetLabel.toLowerCase()} is no more predictable than guessing today's`,
      detail: net.beatsBaseline
        ? `On ${net.testDays} held-out days the network was off by ${net.rmse.toFixed(1)} ${net.unit} against ` +
          `${net.baselineRmse.toFixed(1)} for assuming no change. ${top.label} mattered most.` +
          (net.importance.some((i) => i.harmful)
            ? ` It would do better without ${net.importance
                .filter((i) => i.harmful)
                .map((i) => i.label.toLowerCase())
                .join(' and ')}.`
            : '')
        : `On ${net.testDays} held-out days it was off by ${net.rmse.toFixed(1)} ${net.unit} against ` +
          `${net.baselineRmse.toFixed(1)} for assuming no change, so there is no signal here worth acting on.`,
      tone: net.beatsBaseline ? 'neutral' : 'neutral',
      source: `Two layer network, ${net.hidden} hidden units, trained on ${net.trainDays} days and scored on ${net.testDays} it never saw`,
    })
  }

  return decisions
}

export async function buildInsights(windowDays = WINDOW_DAYS): Promise<Insights> {
  const frame: DayRow[] = await loadDayFrame(windowDays)
  const daysWithData = frame.filter((d) => Object.keys(d.values).length > 0).length

  // The heavier models read a longer frame than the rest of the page. The window
  // picker is a reading choice, so 90 days is the right default for "what has
  // been going on lately". It is not enough to fit a hidden Markov model or to
  // hold out a test set worth trusting, and squeezing those models into it
  // produces a confident answer from 70 training rows. One extra SQL pass is
  // cheaper than a model nobody should believe.
  const deepFrame: DayRow[] =
    windowDays >= DEEP_WINDOW_DAYS ? frame : await loadDayFrame(DEEP_WINDOW_DAYS)

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

  const states = fitStates(deepFrame)
  const factors = factorise(deepFrame)
  const forest = isolationForest(deepFrame)
  const gp = GP_METRICS.map((m) => gpForecast(deepFrame, m)).filter(
    (g): g is GpForecast => g !== null
  )
  const net = trainNet(deepFrame)

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
    states,
    factors,
    forest,
    gp,
    net,
    decisions: buildDecisions(
      readiness,
      anomalies,
      baselines,
      decomposition,
      attributions,
      forecasts,
      states,
      forest,
      net
    ),
  }
}

export { BAND_COPY }
export type { Readiness, ReadinessComponent } from './readiness'
export type { Anomaly, Baseline, Decomposition, ClusterResult, Attribution, Forecast }
export type { StateModel, HiddenState } from './states'
export type { FactorResult, Component, Loading } from './factors'
export type { ForestResult, CombinationAnomaly } from './isolation'
export type { GpForecast } from './gp'
export type { NetResult, NetImportance } from './net'
