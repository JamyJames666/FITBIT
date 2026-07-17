'use client'

import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface Point {
  startTime: string
  value: number | null
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function makeTooltip(unit: string) {
  return function CustomTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null
    const point: Point = payload[0].payload
    return (
      <div className="viz-tooltip">
        <div className="viz-tooltip-value">
          {point.value != null ? `${point.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}` : '—'}
        </div>
        <div className="viz-tooltip-time">{formatTime(point.startTime)}</div>
      </div>
    )
  }
}

function EndDot(lastIndex: number, color: string) {
  return function Dot(props: any) {
    const { cx, cy, index } = props
    if (index !== lastIndex) return <circle cx={cx} cy={cy} r={0} fill="none" />
    return <circle cx={cx} cy={cy} r={4} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
  }
}

export default function TrendChart({
  dataType,
  title,
  unit,
  hours = 24,
  chartType = 'line',
  seriesSlot = 1,
}: {
  dataType: string
  title: string
  unit: string
  hours?: number
  chartType?: 'line' | 'bar'
  seriesSlot?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}) {
  const [points, setPoints] = useState<Point[] | null>(null)
  const color = `var(--series-${seriesSlot})`

  useEffect(() => {
    let cancelled = false
    fetch(`/api/data-points?dataType=${dataType}&hours=${hours}&limit=2000`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        const pts: Point[] = d.points
          .map((p: any) => ({ startTime: p.startTime, value: p.value }))
          .reverse()
        setPoints(pts)
      })
    return () => {
      cancelled = true
    }
  }, [dataType, hours])

  const hasData = points && points.some((p) => p.value != null)

  return (
    <div className="viz-root card">
      <h3 className="card-title">{title}</h3>
      {!points ? (
        <div className="card-empty">Loading…</div>
      ) : !hasData ? (
        <div className="card-empty">No data synced yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          {chartType === 'bar' ? (
            <BarChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
              <CartesianGrid vertical={false} stroke="var(--gridline)" strokeWidth={1} />
              <XAxis
                dataKey="startTime"
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
              <Tooltip content={makeTooltip(unit)} cursor={{ fill: 'var(--gridline)' }} />
              <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          ) : (
            <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
              <CartesianGrid vertical={false} stroke="var(--gridline)" strokeWidth={1} />
              <XAxis
                dataKey="startTime"
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
                domain={['auto', 'auto']}
              />
              <Tooltip content={makeTooltip(unit)} cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={EndDot(points.length - 1, color)}
                isAnimationActive={false}
                connectNulls
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  )
}
