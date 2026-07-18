'use client'

import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
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
  // Total span of the selected period in days — drives tick formatting
  // (e.g. sleep is always fetched raw/unbucketed, but still needs date
  // labels instead of time-of-day once the span crosses a day).
  spanDays: number
}

interface Point {
  startTime: string
  value: number | null
}

function formatTick(iso: string, range: Pick<RangeConfig, 'bucket' | 'spanDays'>) {
  const d = new Date(iso)
  if (range.spanDays <= 1) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (range.bucket === 'hour') return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatAxisNumber(v: number) {
  if (Math.abs(v) >= 1000) return Intl.NumberFormat(undefined, { notation: 'compact' }).format(v)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function makeTooltip(unit: string, range: RangeConfig) {
  return function CustomTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null
    const point: Point = payload[0].payload
    return (
      <div className="viz-tooltip">
        <div className="viz-tooltip-value">
          {point.value != null ? `${point.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}` : '—'}
        </div>
        <div className="viz-tooltip-time">{formatTick(point.startTime, range)}</div>
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
  onZoom,
}: {
  dataType: string
  title: string
  unit: string
  range: RangeConfig
  chartType?: 'line' | 'bar'
  seriesSlot?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  onZoom?: (sinceISO: string, untilISO: string) => void
}) {
  const [points, setPoints] = useState<Point[] | null>(null)
  const [dragStart, setDragStart] = useState<string | null>(null)
  const [dragEnd, setDragEnd] = useState<string | null>(null)
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
        // The raw (unbucketed) path returns newest-first for pagination's
        // sake; the bucketed path returns oldest-first from SQL. Sort
        // explicitly rather than assume — a blind reverse() broke as soon
        // as both orderings existed.
        const pts: Point[] = d.points
          .map((p: any) => ({ startTime: p.startTime, value: p.value }))
          .sort((a: Point, b: Point) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        setPoints(pts)
      })
    return () => {
      cancelled = true
    }
  }, [dataType, range.hours, range.since, range.until, range.bucket])

  const hasData = points && points.some((p) => p.value != null)
  const tickFmt = (iso: string) => formatTick(iso, range)

  function commitZoom() {
    if (dragStart && dragEnd && dragStart !== dragEnd && onZoom) {
      const [lo, hi] = [dragStart, dragEnd].sort()
      onZoom(lo, hi)
    }
    setDragStart(null)
    setDragEnd(null)
  }

  const dragHandlers = onZoom
    ? {
        onMouseDown: (e: any) => e?.activeLabel && setDragStart(e.activeLabel),
        onMouseMove: (e: any) => dragStart && e?.activeLabel && setDragEnd(e.activeLabel),
        onMouseUp: commitZoom,
        onMouseLeave: () => {
          setDragStart(null)
          setDragEnd(null)
        },
      }
    : {}

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
            <BarChart
              data={points}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
              style={{ cursor: onZoom ? 'crosshair' : undefined, userSelect: 'none' }}
              {...dragHandlers}
            >
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
              <Tooltip content={makeTooltip(unit, range)} cursor={{ fill: 'var(--gridline)' }} />
              <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              {dragStart && dragEnd && (
                <ReferenceArea x1={dragStart} x2={dragEnd} fill={color} fillOpacity={0.15} stroke={color} strokeOpacity={0.4} />
              )}
            </BarChart>
          ) : (
            <LineChart
              data={points}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
              style={{ cursor: onZoom ? 'crosshair' : undefined, userSelect: 'none' }}
              {...dragHandlers}
            >
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
              <Tooltip content={makeTooltip(unit, range)} cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }} />
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
              {dragStart && dragEnd && (
                <ReferenceArea x1={dragStart} x2={dragEnd} fill={color} fillOpacity={0.15} stroke={color} strokeOpacity={0.4} />
              )}
            </LineChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  )
}
