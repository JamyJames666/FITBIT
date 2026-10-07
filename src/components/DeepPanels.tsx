'use client'

import {
  Area,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { FactorResult, ForestResult, GpForecast, Insights, NetResult, StateModel } from '@/lib/ml'
import { useInsights } from './useInsights'

const AXIS = {
  stroke: 'var(--ink-3)',
  tick: { fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)' },
  tickLine: false,
}

const POLE_UP = 'var(--series-1)'
const POLE_DOWN = 'var(--series-8)'

// State colours follow the same rule the readiness bands do. The ladder is a
// magnitude, so it steps one hue, and only the bottom rung borrows a status
// colour because being strained genuinely is a status rather than a category.
const STATE_COLOR: Record<string, string> = {
  Strained: 'var(--serious)',
  Flat: 'var(--series-7)',
  Typical: 'var(--ink-3)',
  Holding: 'var(--series-1)',
  Recovered: 'var(--series-3)',
}

function stateColor(name: string): string {
  return STATE_COLOR[name] ?? 'var(--series-5)'
}

function compact(v: number): string {
  if (Math.abs(v) >= 10_000) return `${(v / 1000).toFixed(0)}k`
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`
  if (Math.abs(v) >= 100) return v.toFixed(0)
  return v.toFixed(1)
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
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

function Legend({
  items,
}: {
  items: Array<{ label: string; color: string; shape?: 'line' | 'band' }>
}) {
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

/* ------------------------------------------------------- hidden states */

function StatePanel({ states }: { states: StateModel }) {
  const current = states.current
  const dwell = (d: number) => (Number.isFinite(d) ? `${d.toFixed(1)} days` : 'not established')

  return (
    <div className="card">
      <h3 className="card-title">
        Your days fall into {states.stateCount} conditions, and you are in one of them now
      </h3>
      <p className="card-note">
        A Gaussian hidden Markov model over heart rate variability, resting heart rate, sleep and
        active minutes. The number of conditions was chosen by BIC rather than picked, which is why
        it is {states.stateCount} and not three. The day by day path is the Viterbi decoding, so each
        day is assigned the condition that best explains the whole sequence rather than that day
        alone.
      </p>

      <div className="ribbon" role="img" aria-label="One cell per day, coloured by fitted condition">
        {states.path.map((p) => (
          <span
            key={p.date}
            className="ribbon-cell"
            style={{
              ['--cell' as string]: stateColor(states.states[p.state].name),
              // Confidence is the posterior probability of that state on that
              // day. A day the model is unsure about is drawn faint rather than
              // solid, so an uncertain stretch cannot be mistaken for a settled
              // one.
              opacity: 0.35 + 0.65 * p.confidence,
            }}
            title={`${shortDate(p.date)}, ${states.states[p.state].name}, ${Math.round(
              p.confidence * 100,
            )}% confident`}
          />
        ))}
      </div>
      <div className="ribbon-ends">
        <span>{shortDate(states.path[0].date)}</span>
        <span>{shortDate(states.path[states.path.length - 1].date)}</span>
      </div>

      <Legend
        items={states.states.map((s) => ({ label: s.name, color: stateColor(s.name) }))}
      />

      {current && (
        <p className="state-now">
          <strong>{current.name}</strong> for {current.runLength}{' '}
          {current.runLength === 1 ? 'day' : 'days'}. That condition usually runs{' '}
          {dwell(current.meanDwellDays)}, and the transition matrix puts the chance of moving
          tomorrow at {Math.round(current.changeTomorrow * 100)} per cent
          {current.likelyNext ? `, most likely into ${current.likelyNext.name.toLowerCase()}` : ''}.
        </p>
      )}

      <div className="state-grid">
        {states.states.map((s) => (
          <div key={s.index} className="state-card">
            <h4 className="state-name">
              <span className="state-swatch" style={{ ['--swatch' as string]: stateColor(s.name) }} />
              {s.name}
            </h4>
            <p className="state-meta">
              {Math.round(s.share * 100)}% of days, typically {dwell(s.meanDwellDays)} at a time
            </p>
            <ul className="state-traits">
              {s.profile.slice(0, 3).map((p) => (
                <li key={p.metric} className="state-trait">
                  <span>{p.label}</span>
                  <span className="state-trait-value">
                    {p.z >= 0 ? '+' : ''}
                    {p.z.toFixed(2)} sd
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

/* ------------------------------------------------------------- factors */

function FactorPanel({ factors, states }: { factors: FactorResult; states: StateModel | null }) {
  const stateByDate = new Map<string, string>()
  if (states) {
    for (const p of states.path) stateByDate.set(p.date, states.states[p.state].name)
  }

  const points = factors.scores
    .filter((s) => s.values.length >= 2)
    .map((s) => ({
      x: s.values[0],
      y: s.values[1],
      date: s.date,
      state: stateByDate.get(s.date) ?? 'Typical',
    }))

  const present = Array.from(new Set(points.map((p) => p.state)))

  return (
    <div className="card chart-card">
      <h3 className="card-title">Six metrics, two real directions</h3>
      <p className="card-note">
        Principal components of the standardised daily vector. The six numbers on this dashboard are
        not six independent things, and this asks how many directions the data actually moves in.
        These two carry {Math.round(factors.totalExplained * 100)} per cent of all the variation
        between your days.
      </p>

      {factors.components.map((c) => (
        <div key={c.index} className="loading-block">
          <div className="loading-head">
            <span className="loading-name">
              PC{c.index + 1}, {c.name.toLowerCase()}
            </span>
            <span className="loading-share">
              {Math.round(c.explainedVariance * 100)}% of variation
            </span>
          </div>
          <ResponsiveContainer width="100%" height={92}>
            <BarChart
              // Fixed metric order across every component. Sorting each chart by
            // its own magnitude puts the same metric in a different column on
            // PC1 and PC2, which is exactly the comparison the panel exists to
            // let someone make.
            data={factors.metrics.map((m) => {
              const l = c.loadings.find((x) => x.metric === m)
              return { name: l ? l.label : m, weight: l ? l.weight : 0, metric: m }
            })}
              margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
            >
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="name" {...AXIS} interval={0} tick={{ ...AXIS.tick, fontSize: 9 }} />
              <YAxis {...AXIS} width={34} domain={[-1, 1]} />
              <ReferenceLine y={0} stroke="var(--ink-3)" />
              <Tooltip
                cursor={{ fill: 'var(--raised)' }}
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <Tip
                      rows={[
                        [String(payload[0].payload.name), (payload[0].value as number).toFixed(2)],
                      ]}
                    />
                  ) : null
                }
              />
              <Bar dataKey="weight" radius={[3, 3, 0, 0]} maxBarSize={30}>
                {factors.metrics.map((m) => {
                  const l = c.loadings.find((x) => x.metric === m)
                  return (
                    <Cell key={m} fill={(l?.weight ?? 0) >= 0 ? POLE_UP : POLE_DOWN} />
                  )
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ))}

      <p className="card-note" style={{ marginTop: 18 }}>
        Every day placed on those two axes, coloured by the condition the state model put it in. The
        two models never see each other, so where the colours separate here they agree.
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <ScatterChart margin={{ top: 8, right: 30, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--line)" />
          <XAxis
            type="number"
            dataKey="x"
            name={`PC1`}
            {...AXIS}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={`PC2`}
            {...AXIS}
            width={40}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <ReferenceLine x={0} stroke="var(--ink-3)" />
          <ReferenceLine y={0} stroke="var(--ink-3)" />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as (typeof points)[number]
              return (
                <Tip
                  rows={[
                    [shortDate(p.date), p.state],
                    ['PC1', p.x.toFixed(2)],
                    ['PC2', p.y.toFixed(2)],
                  ]}
                />
              )
            }}
          />
          <Scatter data={points}>
            {points.map((p) => (
              <Cell key={p.date} fill={stateColor(p.state)} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <Legend items={present.map((s) => ({ label: s, color: stateColor(s) }))} />
    </div>
  )
}

/* -------------------------------------------------------------- forest */

function ForestPanel({ forest }: { forest: ForestResult }) {
  const data = forest.scores.map((s) => ({ date: s.date, score: s.score }))
  const flaggedDates = new Set(forest.flagged.map((f) => f.date))

  return (
    <div className="card chart-card">
      <h3 className="card-title">Days that were odd as a whole, not in any one number</h3>
      <p className="card-note">
        An isolation forest, {forest.trees} trees over {forest.metrics.length} metrics at once. The
        z-score detector elsewhere on this page reads one metric at a time, so it can only catch a
        day where something was individually extreme. This catches the day where every number is
        ordinary on its own and the combination is not. Above {forest.threshold} is more isolated
        than the data explains.
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 8, right: 30, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="date"
            {...AXIS}
            tickFormatter={shortDate}
            minTickGap={44}
          />
          <YAxis {...AXIS} width={40} domain={[0.3, 0.8]} tickFormatter={(v: number) => v.toFixed(2)} />
          <ReferenceLine
            y={forest.threshold}
            stroke="var(--serious)"
            strokeDasharray="4 4"
            label={{ value: 'flagged', fill: 'var(--ink-3)', fontSize: 10, position: 'insideTopRight' }}
          />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <Tip
                  rows={[
                    [shortDate(String(label)), (payload[0].value as number).toFixed(3)],
                  ]}
                />
              ) : null
            }
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={(props: { cx?: number; cy?: number; index?: number; payload?: { date: string } }) => {
              const flagged = props.payload ? flaggedDates.has(props.payload.date) : false
              if (!flagged || props.cx == null || props.cy == null) {
                return <circle key={`d-${props.index}`} r={0} cx={props.cx} cy={props.cy} />
              }
              return (
                <circle
                  key={`d-${props.index}`}
                  cx={props.cx}
                  cy={props.cy}
                  r={4}
                  fill="var(--serious)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              )
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {forest.flagged.length > 0 ? (
        <ul className="forest-list">
          {forest.flagged.map((f) => (
            <li key={f.date} className="forest-item">
              <span className="forest-date">{shortDate(f.date)}</span>
              <span className="forest-score">{f.score.toFixed(3)}</span>
              <span className="forest-why">
                {f.contributors
                  .map((c) => `${c.label.toLowerCase()} ${c.z >= 0 ? '+' : ''}${c.z.toFixed(1)} sd`)
                  .join(', ')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card-note" style={{ marginBottom: 0 }}>
          Nothing over the line in this window. Every day was explicable as a combination.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ gp */

function GpPanel({ gp }: { gp: GpForecast }) {
  const data = [
    ...gp.history.map((h) => ({
      label: shortDate(h.date),
      actual: h.value,
      band: undefined as [number, number] | undefined,
      mean: undefined as number | undefined,
    })),
    ...gp.predictions.map((p) => ({
      label: `+${p.day}`,
      actual: undefined as number | undefined,
      band: [p.lower, p.upper] as [number, number],
      mean: p.mean,
    })),
  ]

  return (
    <div className="card chart-card">
      <h3 className="card-title">{gp.label}, with the uncertainty the data actually supports</h3>
      <p className="card-note">
        A Gaussian process rather than a point forecast with an error bar bolted on. The kernel is a
        trend term plus a weekly term plus noise, and its three hyperparameters were chosen by the
        exact log marginal likelihood over a grid. What it selected is itself the finding. Here it
        settled on a length scale of {gp.hyperparameters.lengthScale} days and a noise term of{' '}
        {gp.hyperparameters.noise}, which reads as <strong>{gp.structure}</strong>.
      </p>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 30, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" {...AXIS} minTickGap={36} />
          <YAxis {...AXIS} width={46} tickFormatter={compact} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload as (typeof data)[number]
              const rows: Array<[string, string]> = [['Day', String(label)]]
              if (row.actual != null) rows.push(['Recorded', compact(row.actual)])
              if (row.mean != null) rows.push(['Posterior mean', compact(row.mean)])
              if (row.band) rows.push(['95% interval', `${compact(row.band[0])} to ${compact(row.band[1])}`])
              return <Tip rows={rows} />
            }}
          />
          <Area
            dataKey="band"
            stroke="none"
            fill="var(--series-1)"
            fillOpacity={0.16}
            isAnimationActive={false}
          />
          <Line
            dataKey="actual"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="mean"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <Legend
        items={[
          { label: 'Recorded', color: 'var(--series-1)', shape: 'line' },
          { label: 'Posterior mean and 95% interval', color: 'var(--series-1)', shape: 'band' },
        ]}
      />
    </div>
  )
}

/* ----------------------------------------------------------------- net */

function NetPanel({ net }: { net: NetResult }) {
  const harmful = net.importance.filter((i) => i.harmful)

  return (
    <div className="card chart-card">
      <h3 className="card-title">
        {net.beatsBaseline
          ? `A small network predicts tomorrow's ${net.targetLabel.toLowerCase()} better than assuming no change`
          : `A small network cannot beat assuming tomorrow equals today`}
      </h3>
      <p className="card-note">
        Two layers, {net.hidden} hidden units, trained with Adam on the first {net.trainDays} days
        and scored on the last {net.testDays}, which it never saw. The bar it has to clear is
        persistence, so predicting today's value for tomorrow. That is a hard baseline on a body
        signal and most models quietly lose to it. This one was off by {net.rmse.toFixed(1)}{' '}
        {net.unit} against {net.baselineRmse.toFixed(1)} for the baseline,{' '}
        {net.beatsBaseline
          ? `so ${Math.round(net.improvement * 100)} per cent better.`
          : 'so it lost. The chart below is the comparison, not a recommendation.'}
      </p>

      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={net.predictions} margin={{ top: 8, right: 30, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="date" {...AXIS} tickFormatter={shortDate} minTickGap={40} />
          <YAxis {...AXIS} width={42} tickFormatter={compact} />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <Tip
                  rows={[
                    [shortDate(String(label)), ''],
                    ['Recorded', compact(payload[0].payload.actual)],
                    ['Predicted', compact(payload[0].payload.predicted)],
                  ]}
                />
              ) : null
            }
          />
          <Line
            dataKey="actual"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="predicted"
            stroke="var(--series-3)"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <Legend
        items={[
          { label: 'Recorded', color: 'var(--series-1)', shape: 'line' },
          { label: 'Predicted on held-out days', color: 'var(--series-3)', shape: 'line' },
        ]}
      />

      <p className="card-note" style={{ marginTop: 22 }}>
        Which inputs it leans on, measured by shuffling each one across the held-out days and seeing
        how much worse it gets. Read off the fitted model, because a single weight in the first layer
        of a network means very little on its own.
        {harmful.length > 0 && (
          <>
            {' '}
            A negative bar means the error went <em>down</em> when that input was scrambled, so the
            network is being misled by it.
          </>
        )}
      </p>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart
          data={net.importance.map((i) => ({ name: i.label, value: i.increaseInError }))}
          layout="vertical"
          margin={{ top: 4, right: 30, bottom: 4, left: 8 }}
        >
          <CartesianGrid stroke="var(--line)" horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={(v: number) => v.toFixed(1)} />
          <YAxis type="category" dataKey="name" {...AXIS} width={152} tick={{ ...AXIS.tick, fontSize: 10 }} />
          <ReferenceLine x={0} stroke="var(--ink-3)" />
          <Tooltip
            cursor={{ fill: 'var(--raised)' }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <Tip
                  rows={[
                    [
                      String(payload[0].payload.name),
                      `${(payload[0].value as number) >= 0 ? '+' : ''}${(payload[0].value as number).toFixed(2)} ${net.unit} error`,
                    ],
                  ]}
                />
              ) : null
            }
          />
          <Bar dataKey="value" radius={[0, 3, 3, 0]} maxBarSize={18}>
            {net.importance.map((i) => (
              <Cell key={i.metric} fill={i.harmful ? POLE_DOWN : POLE_UP} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* --------------------------------------------------------------- shell */

export default function DeepPanels() {
  const { data, error } = useInsights()
  if (error || !data) return null
  const insights: Insights = data

  const anything =
    insights.states || insights.factors || insights.forest || insights.gp.length || insights.net
  if (!anything) return null

  return (
    <>
      {insights.states && <StatePanel states={insights.states} />}
      {insights.forest && <ForestPanel forest={insights.forest} />}
      {insights.factors && <FactorPanel factors={insights.factors} states={insights.states} />}
      <div className="chart-grid">
        {insights.gp.slice(0, 2).map((g) => (
          <GpPanel key={`gp-${g.metric}`} gp={g} />
        ))}
      </div>
      {insights.net && <NetPanel net={insights.net} />}
    </>
  )
}
