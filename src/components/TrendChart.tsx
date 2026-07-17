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

export interface RangeConfig {
  hours?: number
  since?: string
  until?: string
  bucket: 'none' | 'hour' | 'day'
}

interface Point {
  startTime: string
  value: number | null
}

function formatTick(iso: string, bucket: RangeConfig['bucket']) {
  const d = new Date(iso)
  if (bucket === 'day') return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  if (bucket === 'hour') return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' })
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatAxisNumber(v: number) {
  if (Math.abs(v) >= 1000) return Intl.NumberFormat(undefined, { notation: 'compact' }).format(v)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function makeTooltip(unit: string, bucket: RangeConfig['bucket']) {
  return function CustomTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null
    const point: Point = payload[0].payload
    return (
      <div className="viz-tooltip">
        <div className="viz-tooltip-value">
          {point.value != null ? `${point.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}` : '—'}
        </div>
        <div className="viz-tooltip-time">{formatTick(point.startTime, bucket)}</div>
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
  range,
  chartType = 'line',
  seriesSlot = 1,
}: {
  dataType: string
  title: string
  unit: string
  range: RangeConfig
  chartType?: 'line' | 'bar'
  seriesSlot?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}) {
  const [points, setPoints] = useState<Point[] | null>(null)
  const color = `var(--series-${seriesSlot})`

  useEffect(() => {
    let cancelled = false
    setPoints(null)
    const params = new URLSearchParams({ dataType, bucket: range.bucket, limit: '3000' })
    if (range.since) params.set('since', range.since)
    if (range.until) params.set('until', range.until)
    if (range.hours != null) params.set('hours', String(range.hours))

    fetch(`/api/data-points?${params.toString()}`)
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
  }, [dataType, range.hours, range.since, range.until, range.bucket])

  const hasData = points && points.some((p) => p.value != null)
  const tickFmt = (iso: string) => formatTick(iso, range.bucket)

  return (
    <div className="viz-root card chart-card">
      <h3 className="card-title">{title}</h3>
      {!points ? (
        <div className="card-empty">Loading…</div>
      ) : !hasData ? (
        <div className="card-empty">No data synced yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          {chartType === 'bar' ? (
            <BarChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--gridline)" strokeWidth={1} />
              <XAxis
                dataKey="startTime"
                tickFormatter={tickFmt}
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
                width={52}
                tickFormatter={formatAxisNumber}
              />
              <Tooltip content={makeTooltip(unit, range.bucket)} cursor={{ fill: 'var(--gridline)' }} />
              <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          ) : (
            <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--gridline)" strokeWidth={1} />
              <XAxis
                dataKey="startTime"
                tickFormatter={tickFmt}
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
                width={52}
                domain={['auto', 'auto']}
                tickFormatter={formatAxisNumber}
              />
              <Tooltip content={makeTooltip(unit, range.bucket)} cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }} />
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
