'use client'

import { useEffect, useRef, useState } from 'react'
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
import { useSync } from './DashboardClient'

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

// A wheel notch (mouse) or a settled trackpad gesture zooms by this factor;
// deltaY > 0 (scroll down) zooms out, < 0 zooms in — matches trading charts.
const WHEEL_ZOOM_FACTOR = 0.85
const WHEEL_DEBOUNCE_MS = 120
const MIN_SPAN_MS = 2 * 60_000
const MAX_POINTS = 20_000

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

function makeTooltip(unit: string, range: RangeConfig, artifactBelow?: number) {
  return function CustomTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null
    const point: Point = payload[0].payload
    const isArtifact = artifactBelow != null && point.value != null && point.value < artifactBelow
    return (
      <div className="viz-tooltip">
        <div className="viz-tooltip-value">
          {point.value != null ? `${point.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}` : '—'}
        </div>
        <div className="viz-tooltip-time">{formatTick(point.startTime, range)}</div>
        {isArtifact && <div className="viz-tooltip-flag">Likely sensor artifact (motion / poor contact)</div>}
      </div>
    )
  }
}

function makeDot(lastIndex: number, color: string, artifactBelow?: number) {
  return function Dot(props: any) {
    const { cx, cy, index, payload } = props
    if (index === lastIndex) {
      return <circle cx={cx} cy={cy} r={4} fill={color} stroke="var(--surface-1)" strokeWidth={2} />
    }
    if (artifactBelow != null && payload?.value != null && payload.value < artifactBelow) {
      return <circle cx={cx} cy={cy} r={3.5} fill="var(--page-plane)" stroke="var(--series-8)" strokeWidth={2} />
    }
    return <circle cx={cx} cy={cy} r={0} fill="none" />
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
  transform,
  artifactBelow,
}: {
  dataType: string
  title: string
  unit: string
  range: RangeConfig
  chartType?: 'line' | 'bar'
  seriesSlot?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  onZoom?: (sinceISO: string, untilISO: string) => void
  transform?: (value: number) => number
  artifactBelow?: number
}) {
  const [points, setPoints] = useState<Point[] | null>(null)
  const [total, setTotal] = useState(0)
  const [dragStart, setDragStart] = useState<string | null>(null)
  const [dragEnd, setDragEnd] = useState<string | null>(null)
  const color = `var(--series-${seriesSlot})`
  const { refreshToken } = useSync()

  const rangeRef = useRef(range)
  rangeRef.current = range
  const hoverRef = useRef<string | null>(null)
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelFactorRef = useRef(1)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ dataType, bucket: range.bucket, limit: String(MAX_POINTS), dedupe: '1' })
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
          .map((p: any) => ({ startTime: p.startTime, value: p.value != null && transform ? transform(p.value) : p.value }))
          .sort((a: Point, b: Point) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        setPoints(pts)
        setTotal(d.total)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataType, range.hours, range.since, range.until, range.bucket, refreshToken])

  const hasData = points && points.some((p) => p.value != null)
  const tickFmt = (iso: string) => formatTick(iso, range)
  const truncated = range.bucket === 'none' && total > (points?.length ?? 0)

  function commitDragZoom() {
    if (dragStart && dragEnd && dragStart !== dragEnd && onZoom) {
      const [lo, hi] = [dragStart, dragEnd].sort()
      onZoom(lo, hi)
    }
    setDragStart(null)
    setDragEnd(null)
  }

  function commitWheelZoom(factor: number) {
    const r = rangeRef.current
    if (!onZoom || !r.since || !r.until) return
    const sinceMs = new Date(r.since).getTime()
    const untilMs = new Date(r.until).getTime()
    const anchorMs = hoverRef.current ? new Date(hoverRef.current).getTime() : (sinceMs + untilMs) / 2

    let newSince = anchorMs - (anchorMs - sinceMs) * factor
    let newUntil = anchorMs + (untilMs - anchorMs) * factor
    if (newUntil - newSince < MIN_SPAN_MS) {
      const mid = (newSince + newUntil) / 2
      newSince = mid - MIN_SPAN_MS / 2
      newUntil = mid + MIN_SPAN_MS / 2
    }
    onZoom(new Date(newSince).toISOString(), new Date(newUntil).toISOString())
  }

  function handleWheel(e: React.WheelEvent) {
    if (!onZoom) return
    e.preventDefault()
    const tickFactor = e.deltaY > 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR
    // Compound ticks that land within one debounce window into a single
    // committed zoom — a trackpad fires dozens of small deltas per gesture,
    // and re-fetching all charts on every one of them would be very janky.
    wheelFactorRef.current = wheelTimerRef.current ? wheelFactorRef.current * tickFactor : tickFactor
    if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
    wheelTimerRef.current = setTimeout(() => {
      commitWheelZoom(wheelFactorRef.current)
      wheelTimerRef.current = null
      wheelFactorRef.current = 1
    }, WHEEL_DEBOUNCE_MS)
  }

  const dragHandlers = onZoom
    ? {
        onMouseDown: (e: any) => e?.activeLabel && setDragStart(e.activeLabel),
        onMouseMove: (e: any) => {
          if (e?.activeLabel) hoverRef.current = e.activeLabel
          if (dragStart && e?.activeLabel) setDragEnd(e.activeLabel)
        },
        onMouseUp: commitDragZoom,
        onMouseLeave: () => {
          setDragStart(null)
          setDragEnd(null)
        },
        onWheel: handleWheel,
      }
    : {}

  return (
    <div className="viz-root card chart-card">
      <div className="chart-header">
        <h3 className="card-title">{title}</h3>
        {truncated && (
          <span className="muted chart-truncated">
            Showing {points!.length.toLocaleString()} of {total.toLocaleString()} points
          </span>
        )}
      </div>
      {!points ? (
        <div className="card-empty">Loading…</div>
      ) : !hasData ? (
        <div className="card-empty">No data synced yet.</div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
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
              <Tooltip content={makeTooltip(unit, range, artifactBelow)} cursor={{ fill: 'var(--gridline)' }} />
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
              <Tooltip content={makeTooltip(unit, range, artifactBelow)} cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={makeDot(points.length - 1, color, artifactBelow)}
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
