'use client'

import { useEffect, useState } from 'react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'

interface Point {
  time: string
  bpm: number | null
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const point: Point = payload[0].payload
  return (
    <div className="viz-tooltip">
      <div className="viz-tooltip-value">{point.bpm ?? '—'} bpm</div>
      <div className="viz-tooltip-time">{formatTime(point.time)}</div>
    </div>
  )
}

// End-of-line marker: an 8px dot with a 2px surface ring, drawn only on the
// last point so we're not putting a number/mark on every sample.
function EndDot(lastIndex: number) {
  return function Dot(props: any) {
    const { cx, cy, index } = props
    if (index !== lastIndex) return <circle cx={cx} cy={cy} r={0} fill="none" />
    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill="var(--series-1)"
        stroke="var(--surface-1)"
        strokeWidth={2}
      />
    )
  }
}

export default function HeartRateChart({ hours = 24 }: { hours?: number }) {
  const [points, setPoints] = useState<Point[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/heart-rate?hours=${hours}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setPoints(d.points)
      })
    return () => {
      cancelled = true
    }
  }, [hours])

  return (
    <div className="viz-root card">
      <h3 className="card-title">Heart rate (bpm)</h3>
      {!points ? (
        <div className="card-empty">Loading…</div>
      ) : points.length === 0 ? (
        <div className="card-empty">No heart rate data synced yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--gridline)" strokeWidth={1} />
            <XAxis
              dataKey="time"
              tickFormatter={formatTime}
              stroke="var(--muted)"
              tick={{ fill: 'var(--muted)', fontSize: 12 }}
              axisLine={{ stroke: 'var(--baseline)' }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              stroke="var(--muted)"
              tick={{ fill: 'var(--muted)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="bpm"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={EndDot(points.length - 1)}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
