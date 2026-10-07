'use client'

import { BAND_COLOR, BAND_COPY, SEVERITY_COLOR } from '@/lib/ml/bands'
import type { Anomaly, Insights, ReadinessComponent } from '@/lib/ml'
import Icon from './Icon'
import { useInsights } from './useInsights'

function formatMetric(unit: string, value: number): string {
  if (unit === 'min') {
    const h = Math.floor(value / 60)
    const m = Math.round(value % 60)
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
  }
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString('en-GB')
  return value.toFixed(1)
}

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// The bar is the evidence for the score above it. Its length is the
// component's own 0-100 sub-score, and its weight in the total is stated in
// words beside it, so nothing about how the number was reached is left to
// colour.
function Contribution({ component }: { component: ReadinessComponent }) {
  const width = component.available ? Math.max(1.5, component.score) : 100

  return (
    <div className="contrib-row" data-available={String(component.available)}>
      <span className="contrib-label">{component.label}</span>
      <span className="contrib-value">
        {component.available ? `${Math.round(component.score)}` : 'no data'}
      </span>
      <span className="contrib-track">
        <span
          className="contrib-fill"
          style={{
            width: `${width}%`,
            background: component.available ? 'var(--series-1)' : 'var(--line-strong)',
          }}
        />
      </span>
      <span className="contrib-detail">
        {component.detail}
        {component.available && ` · ${Math.round(component.weight * 100)}% of the score`}
      </span>
    </div>
  )
}

function Verdict({ insights }: { insights: Insights }) {
  const { readiness, daysWithData, windowDays } = insights
  const copy = BAND_COPY[readiness.band]

  if (readiness.score == null) {
    return (
      <section>
        <h1 className="verdict-word">No verdict yet</h1>
        <p className="verdict-advice">
          The readiness model needs a baseline before it will say anything. It has {daysWithData} day
          {daysWithData === 1 ? '' : 's'} of data and wants about ten.
        </p>
      </section>
    )
  }

  return (
    <section>
      <p className="verdict-band">
        <span className="verdict-dot" style={{ color: BAND_COLOR[readiness.band] }} />
        Today
      </p>
      <h1 className="verdict-word">{copy.title}</h1>
      <p className="verdict-advice">{copy.advice}</p>

      <p className="verdict-score">
        <span className="verdict-score-value">{Math.round(readiness.score)}</span>
        <span className="verdict-score-label">
          readiness out of 100, built from {daysWithData} days of history
        </span>
      </p>

      <div className="contrib">
        {readiness.components.map((c) => (
          <Contribution key={c.key} component={c} />
        ))}
      </div>
    </section>
  )
}

function Decisions({ insights }: { insights: Insights }) {
  if (!insights.decisions.length) return null

  return (
    <section className="feed">
      <h2 className="feed-heading">What the models found</h2>
      {insights.decisions.map((d) => (
        <article key={d.id} className="decision" data-tone={d.tone}>
          <h3 className="decision-headline">
            <span className="decision-mark" />
            {d.headline}
          </h3>
          <p className="decision-detail">{d.detail}</p>
          <p className="decision-source">{d.source}</p>
        </article>
      ))}
    </section>
  )
}

function AnomalyRow({ anomaly }: { anomaly: Anomaly }) {
  return (
    <div className="anomaly">
      <span className="anomaly-date">{formatDate(anomaly.date)}</span>
      <span className="anomaly-label">
        <span className="anomaly-severity" style={{ ['--sev-color' as string]: SEVERITY_COLOR[anomaly.severity] }}>
          {anomaly.label}
        </span>
      </span>
      <span className="anomaly-z">
        {anomaly.z > 0 ? '+' : ''}
        {anomaly.z.toFixed(1)}&#963;
      </span>
      <span className="anomaly-detail">
        {formatMetric(anomaly.unit, anomaly.value)} {anomaly.unit}, {anomaly.direction} a typical{' '}
        {formatMetric(anomaly.unit, anomaly.expected)} {anomaly.unit}
      </span>
    </div>
  )
}

function Anomalies({ insights }: { insights: Insights }) {
  if (!insights.anomalies.length) return null

  return (
    <section className="feed">
      <h2 className="feed-heading">Days that stood out</h2>
      {insights.anomalies.map((a) => (
        <AnomalyRow key={`${a.metric}-${a.date}`} anomaly={a} />
      ))}
    </section>
  )
}

export default function Brief() {
  const { data, error, loading } = useInsights()

  if (error) {
    return (
      <div className="brief">
        <p className="card-error" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="alert" />
          The model layer could not run: {error}
        </p>
      </div>
    )
  }

  if (loading && !data) {
    return (
      <div className="brief">
        <div className="skeleton" style={{ height: 420 }} />
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="brief">
      <Verdict insights={data} />
      <Decisions insights={data} />
      <Anomalies insights={data} />
    </div>
  )
}
