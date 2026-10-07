'use client'

import {
  Area,
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Attribution, ClusterResult, Decomposition, Forecast, Insights } from '@/lib/ml'
import { useInsights } from './useInsights'

const AXIS = {
  stroke: 'var(--ink-3)',
  tick: { fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)' },
  tickLine: false,
}

// A diverging pair, one warm pole and one cool. Used wherever a value's sign
// is the point, never for plain magnitude.
const POLE_UP = 'var(--series-1)'
const POLE_DOWN = 'var(--series-8)'

// How much past context a seven day projection is shown against.
const HISTORY_DAYS_SHOWN = 28

// Below this the regression is not telling you anything, and drawing confident
// bars for it would be the dishonest option.
const MIN_INFORMATIVE_R2 = 0.05

const CLUSTER_HUES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-5)']

function compact(v: number): string {
  if (Math.abs(v) >= 1000) return Intl.NumberFormat('en-GB', { notation: 'compact' }).format(v)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function Legend({ items }: { items: Array<{ label: string; color: string; shape?: 'line' | 'band' }> }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label} className="legend-item">
          <span
            className="legend-swatch"
            data-shape={i.shape}
            style={{ ['--swatch' as string]: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  )
}

function Tip({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="viz-tooltip">
      {rows.map(([label, value], i) => (
        <div key={`${label}-${i}`} className="viz-tooltip-time">
          {label} <span className="viz-tooltip-value">{value}</span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------ forecast */

function ForecastPanel({ forecast }: { forecast: Forecast }) {
  const unit = forecast.metric === 'sleepMinutes' ? 'min' : ''
  // Only the recent run-up is plotted. Against four months of history a seven
  // day projection is a sliver at the right edge and the bands are unreadable.
  const history = forecast.history.filter((h) => h.value != null).slice(-HISTORY_DAYS_SHOWN)
  const last = history[history.length - 1]

  const data = [
    ...history.map((h) => ({
      date: h.date,
      actual: h.value,
      projected: null as number | null,
      band80: null as [number, number] | null,
      band95: null as [number, number] | null,
    })),
    // The join row repeats the last observation as the start of the
    // projection, so the dashed line meets the solid one instead of floating.
    ...(last
      ? [
          {
            date: last.date,
            actual: last.value,
            projected: last.value,
            band80: [last.value as number, last.value as number] as [number, number],
            band95: [last.value as number, last.value as number] as [number, number],
          },
        ]
      : []),
    ...forecast.points.map((p) => ({
      date: p.date,
      actual: null as number | null,
      projected: p.value,
      band80: [p.lower80, p.upper80] as [number, number],
      band95: [p.lower95, p.upper95] as [number, number],
    })),
  ]

  const title = forecast.metric === 'sleepMinutes' ? 'Sleep' : forecast.metric === 'steps' ? 'Steps' : 'Resting heart rate'

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div>
          <h3 className="card-title">{title}, next seven days</h3>
          <p className="card-note" style={{ marginBottom: 0 }}>
            Holt-Winters with a weekly cycle. Typical error on past days is {compact(forecast.rmse)}
            {unit && ` ${unit}`}, and the bands widen with the square root of how far ahead you look.
          </p>
        </div>
      </div>

      <Legend
        items={[
          { label: 'Recorded', color: 'var(--series-1)', shape: 'line' },
          { label: 'Projected', color: 'var(--series-2)', shape: 'line' },
          { label: '80% interval', color: 'var(--series-2)', shape: 'band' },
          { label: '95% interval', color: 'var(--series-2)', shape: 'band' },
        ]}
      />

      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 6, right: 30, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={32} axisLine={{ stroke: 'var(--baseline)' }} {...AXIS} />
          <YAxis width={48} tickFormatter={compact} axisLine={false} {...AXIS} />
          <Tooltip
            cursor={{ stroke: 'var(--baseline)' }}
            content={({ active, payload, label }: any) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload
              const rows: Array<[string, string]> = [['', shortDate(String(label))]]
              if (row.actual != null) rows.push(['Recorded', `${compact(row.actual)} ${unit}`.trim()])
              if (row.projected != null && row.actual == null) {
                rows.push(['Projected', `${compact(row.projected)} ${unit}`.trim()])
                if (row.band80) rows.push(['80% range', `${compact(row.band80[0])} to ${compact(row.band80[1])}`])
              }
              return <Tip rows={rows} />
            }}
          />
          <Area dataKey="band95" stroke="none" fill="var(--series-2)" fillOpacity={0.1} isAnimationActive={false} />
          <Area dataKey="band80" stroke="none" fill="var(--series-2)" fillOpacity={0.18} isAnimationActive={false} />
          <Line dataKey="actual" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          <Line
            dataKey="projected"
            stroke="var(--series-2)"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ------------------------------------------------------- decomposition */

function WeekdayPanel({ decomposition }: { decomposition: Decomposition }) {
  const unit = decomposition.metric === 'sleepMinutes' ? 'min' : 'steps'
  const label = decomposition.metric === 'sleepMinutes' ? 'sleep' : 'steps'

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div>
          <h3 className="card-title">Which day of the week moves your {label}</h3>
          <p className="card-note" style={{ marginBottom: 0 }}>
            The trend is removed first, so what is left is the day of the week on its own. The weekly
            pattern accounts for {Math.round(decomposition.seasonalStrength * 100)}% of what varies
            once the trend is gone.
          </p>
        </div>
      </div>

      <Legend
        items={[
          { label: `Above your average`, color: POLE_UP },
          { label: `Below your average`, color: POLE_DOWN },
        ]}
      />

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={decomposition.weekdayEffect} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="weekday" axisLine={{ stroke: 'var(--baseline)' }} {...AXIS} />
          <YAxis width={48} tickFormatter={compact} axisLine={false} {...AXIS} />
          <ReferenceLine y={0} stroke="var(--baseline)" />
          <Tooltip
            cursor={{ fill: 'var(--grid)' }}
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload
              return (
                <Tip
                  rows={[
                    [p.weekday, `${p.effect >= 0 ? '+' : ''}${compact(p.effect)} ${unit}`],
                  ]}
                />
              )
            }}
          />
          <Bar dataKey="effect" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
            {decomposition.weekdayEffect.map((d) => (
              <Cell key={d.weekday} fill={d.effect >= 0 ? POLE_UP : POLE_DOWN} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ---------------------------------------------------------- attribution */

function DriversPanel({ attribution }: { attribution: Attribution }) {
  const data = [...attribution.drivers].reverse()
  const target = attribution.targetLabel.toLowerCase()
  const title = `What moves your ${target}${attribution.lagDays ? ' the next day' : ''}`

  if (attribution.r2 < MIN_INFORMATIVE_R2) {
    return (
      <div className="card chart-card">
        <h3 className="card-title">{title}</h3>
        <p className="card-note" style={{ marginBottom: 0 }}>
          Nothing measured here predicts your {target}. Across {attribution.n} days, steps, active
          minutes, calories and heart rate together explain under{' '}
          {Math.max(1, Math.round(MIN_INFORMATIVE_R2 * 100))}% of how it varies, so the model has no
          drivers to show rather than weak ones worth acting on.
        </p>
      </div>
    )
  }

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div>
          <h3 className="card-title">{title}</h3>
          <p className="card-note" style={{ marginBottom: 0 }}>
            Ridge regression over {attribution.n} days, explaining {Math.round(attribution.r2 * 100)}%
            of the variation. Bars are standardised, so they compare directly with each other but not
            with any raw figure.
          </p>
        </div>
      </div>

      <Legend
        items={[
          { label: 'Pushes it up', color: POLE_UP },
          { label: 'Pulls it down', color: POLE_DOWN },
        ]}
      />

      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44 + 40)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tickFormatter={(v: number) => v.toFixed(2)} axisLine={false} {...AXIS} />
          <YAxis type="category" dataKey="label" width={132} axisLine={false} {...AXIS} />
          <ReferenceLine x={0} stroke="var(--baseline)" />
          <Tooltip
            cursor={{ fill: 'var(--grid)' }}
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload
              return (
                <Tip
                  rows={[
                    [d.label, `${d.coefficient >= 0 ? '+' : ''}${d.coefficient.toFixed(2)}`],
                    ['Share of the effect', `${Math.round(d.share * 100)}%`],
                  ]}
                />
              )
            }}
          />
          <Bar dataKey="coefficient" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.metric} fill={d.coefficient >= 0 ? POLE_UP : POLE_DOWN} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* -------------------------------------------------------------- clusters */

function ClusterPanel({ clusters }: { clusters: ClusterResult }) {
  return (
    <div className="card">
      <h3 className="card-title">Your days sort into {clusters.k} kinds</h3>
      <p className="card-note">
        k-means over steps, active minutes, sleep, resting heart rate and heart rate variability,
        each standardised first. k was chosen by silhouette width, which came out at{' '}
        {clusters.silhouette.toFixed(2)}.{' '}
        {clusters.silhouette < 0.2
          ? 'That is weak, so read these as loose tendencies rather than distinct kinds of day.'
          : 'Above 0.25 counts as a real separation.'}
      </p>

      <div className="cluster-grid">
        {clusters.clusters.map((c, i) => (
          <div key={c.id} className="cluster">
            <h4 className="cluster-name">
              <span className="cluster-swatch" style={{ ['--swatch' as string]: CLUSTER_HUES[i % CLUSTER_HUES.length] }} />
              {c.name}
            </h4>
            <p className="cluster-size">
              {c.size} days, {Math.round(c.share * 100)}% of the window
            </p>
            <ul className="cluster-traits">
              {c.distinguishing.map((d) => (
                <li key={d.metric} className="cluster-trait">
                  <span>{d.label}</span>
                  <span className="cluster-trait-value">
                    {d.metric === 'sleepMinutes'
                      ? `${(d.value / 60).toFixed(1)}h`
                      : `${compact(d.value)} ${d.unit}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- shell */

function NotEnoughYet({ what, need }: { what: string; need: string }) {
  return (
    <div className="card">
      <h3 className="card-title">{what}</h3>
      <p className="card-note" style={{ marginBottom: 0 }}>
        {need}
      </p>
    </div>
  )
}

export default function ModelPanels() {
  const { data, error, loading } = useInsights()

  if (error) return null
  if (loading && !data) {
    return (
      <div className="chart-grid">
        <div className="card chart-card">
          <div className="skeleton" style={{ height: 240 }} />
        </div>
        <div className="card chart-card">
          <div className="skeleton" style={{ height: 240 }} />
        </div>
      </div>
    )
  }
  if (!data) return null

  const panels: React.ReactNode[] = []
  const insights: Insights = data

  for (const f of insights.forecasts) {
    if (f.metric === 'sleepMinutes' || f.metric === 'steps') {
      panels.push(<ForecastPanel key={`forecast-${f.metric}`} forecast={f} />)
    }
  }
  if (insights.decomposition) {
    panels.push(<WeekdayPanel key="weekday" decomposition={insights.decomposition} />)
  }
  for (const a of insights.attributions) {
    panels.push(<DriversPanel key={`drivers-${a.target}-${a.lagDays}`} attribution={a} />)
  }

  if (!panels.length && !insights.clusters) {
    return (
      <NotEnoughYet
        what="The model panels are waiting on history"
        need={`The forecast and decomposition models need about three weeks of daily data, and the clustering needs two. There are ${insights.daysWithData} days recorded so far.`}
      />
    )
  }

  return (
    <>
      {panels.length > 0 && <div className="chart-grid">{panels}</div>}
      {insights.clusters && <ClusterPanel clusters={insights.clusters} />}
    </>
  )
}
