'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
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
import { pickBucket } from '@/lib/metricMeta'

interface Point {
  startTime: string
  value: number | null
}

// A wheel notch or a settled trackpad gesture zooms by this factor. Scrolling
// down zooms out, matching every trading chart anyone has used.
const WHEEL_ZOOM_FACTOR = 0.85
const WHEEL_DEBOUNCE_MS = 60
const MIN_SPAN_MS = 2 * 60_000
const MAX_POINTS = 20_000

// Every metric chart is a single series that its own title names, so a hue per
// metric would encode nothing. One signal colour throughout, and the few
// charts that do carry two meanings get a legend instead.
const SERIES = 'var(--series-1)'
const ARTIFACT = 'var(--serious)'

function formatTick(iso: string, spanDays: number, bucket: 'none' | 'hour' | 'day'): string {
  const d = new Date(iso)
  if (spanDays <= 1) return d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })
  if (bucket === 'hour') return d.toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: 'numeric' })
  return d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
}

function formatAxisNumber(v: number): string {
  if (Math.abs(v) >= 1000) return Intl.NumberFormat('en-GB', { notation: 'compact' }).format(v)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function makeTooltip(unit: string, spanDays: number, bucket: 'none' | 'hour' | 'day', artifactBelow?: number) {
  return function ChartTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null
    const point: Point = payload[0].payload
    const isArtifact = artifactBelow != null && point.value != null && point.value < artifactBelow
    return (
      <div className="viz-tooltip">
        <div className="viz-tooltip-value">
          {point.value != null
            ? `${point.value.toLocaleString('en-GB', { maximumFractionDigits: 1 })} ${unit}`
            : 'No reading'}
        </div>
        <div className="viz-tooltip-time">{formatTick(point.startTime, spanDays, bucket)}</div>
        {isArtifact && <div className="viz-tooltip-flag">Likely a sensor artifact from motion or poor contact</div>}
      </div>
    )
  }
}

// Only the latest point and anything flagged as an artifact get a visible dot.
// A dot on every reading is noise at a month of per-minute data.
function makeDot(lastIndex: number, artifactBelow?: number) {
  // Recharts calls this per point and pushes the results straight into an
  // array, so the key has to be set here or React warns for every dot.
  return function ChartDot(props: any) {
    const { cx, cy, index, payload } = props
    const key = `dot-${index}`
    if (index === lastIndex) {
      return <circle key={key} cx={cx} cy={cy} r={4} fill={SERIES} stroke="var(--surface)" strokeWidth={2} />
    }
    if (artifactBelow != null && payload?.value != null && payload.value < artifactBelow) {
      return <circle key={key} cx={cx} cy={cy} r={4} fill="var(--surface)" stroke={ARTIFACT} strokeWidth={2} />
    }
    return <circle key={key} cx={cx} cy={cy} r={0} fill="none" />
  }
}

export default function TrendChart({
  dataType,
  title,
  unit,
  baseSince,
  baseUntil,
  resetKey,
  chartType = 'line',
  transform,
  artifactBelow,
}: {
  dataType: string
  title: string
  unit: string
  baseSince: string
  baseUntil: string
  resetKey: string
  chartType?: 'line' | 'bar'
  transform?: (value: number) => number
  artifactBelow?: number
}) {
  const [points, setPoints] = useState<Point[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<{ since: string; until: string } | null>(null)
  const [dragStart, setDragStart] = useState<string | null>(null)
  const [dragEnd, setDragEnd] = useState<string | null>(null)
  const { refreshToken } = useSync()

  // The range picker owns the base window and each chart layers its own zoom
  // on top, so scrolling one metric leaves the other eight alone.
  useEffect(() => {
    setZoom(null)
  }, [resetKey])

  const since = zoom?.since ?? baseSince
  const until = zoom?.until ?? baseUntil
  const spanDays = (new Date(until).getTime() - new Date(since).getTime()) / 86_400_000
  const bucket = pickBucket(dataType, spanDays)

  const containerRef = useRef<HTMLDivElement>(null)
  const sinceRef = useRef(since)
  sinceRef.current = since
  const untilRef = useRef(until)
  untilRef.current = until
  const hoverRef = useRef<string | null>(null)
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wheelFactorRef = useRef(1)

  useEffect(() => {
    let cancelled = false
    setError(null)

    const params = new URLSearchParams({
      dataType,
      bucket,
      since,
      until,
      limit: String(MAX_POINTS),
      dedupe: '1',
    })

    fetch(`/api/data-points?${params.toString()}`)
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error ?? `Request failed with ${r.status}`)
        return body
      })
      .then((d) => {
        if (cancelled) return
        // The raw path returns newest first for pagination. The bucketed path
        // returns oldest first from SQL. Sorted explicitly rather than
        // assumed, because a blind reverse broke the moment both existed.
        const pts: Point[] = d.points
          .map((p: any) => ({
            startTime: p.startTime,
            value: p.value != null && transform ? transform(p.value) : p.value,
          }))
          .sort((a: Point, b: Point) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        setPoints(pts)
        setTotal(d.total)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setPoints([])
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataType, since, until, bucket, refreshToken])

  const commitWheelZoom = useCallback((factor: number) => {
    const sinceMs = new Date(sinceRef.current).getTime()
    const untilMs = new Date(untilRef.current).getTime()
    const anchorMs = hoverRef.current ? new Date(hoverRef.current).getTime() : (sinceMs + untilMs) / 2

    let newSince = anchorMs - (anchorMs - sinceMs) * factor
    let newUntil = anchorMs + (untilMs - anchorMs) * factor
    if (newUntil - newSince < MIN_SPAN_MS) {
      const mid = (newSince + newUntil) / 2
      newSince = mid - MIN_SPAN_MS / 2
      newUntil = mid + MIN_SPAN_MS / 2
    }
    setZoom({ since: new Date(newSince).toISOString(), until: new Date(newUntil).toISOString() })
  }, [])

  // React attaches onWheel as a passive listener, so preventDefault inside it
  // is ignored and the page scrolls underneath the chart while it zooms. A
  // manually attached non-passive listener is the only way to stop that.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const tickFactor = e.deltaY > 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR
      wheelFactorRef.current = wheelTimerRef.current ? wheelFactorRef.current * tickFactor : tickFactor
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = setTimeout(() => {
        commitWheelZoom(wheelFactorRef.current)
        wheelTimerRef.current = null
        wheelFactorRef.current = 1
      }, WHEEL_DEBOUNCE_MS)
    }

    el.addEventListener('wheel', handler, { passive: false })
    return () => {
      el.removeEventListener('wheel', handler)
      if (wheelTimerRef.current) clearTimeout(wheelTimerRef.current)
    }
  }, [commitWheelZoom])

  function commitDragZoom() {
    if (dragStart && dragEnd && dragStart !== dragEnd) {
      const [lo, hi] = [dragStart, dragEnd].sort()
      setZoom({ since: lo, until: hi })
    }
    setDragStart(null)
    setDragEnd(null)
  }

  const dragHandlers = {
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
  }

  const hasData = points && points.some((p) => p.value != null)
  const tickFmt = (iso: string) => formatTick(iso, spanDays, bucket)
  const truncated = bucket === 'none' && total > (points?.length ?? 0)

  const axisProps = {
    stroke: 'var(--ink-3)',
    tick: { fill: 'var(--ink-3)', fontSize: 11, fontFamily: 'var(--font-mono)' },
    tickLine: false,
  }

  const selection = dragStart && dragEnd && (
    <ReferenceArea x1={dragStart} x2={dragEnd} fill={SERIES} fillOpacity={0.14} stroke={SERIES} strokeOpacity={0.4} />
  )

  return (
    <div className="card chart-card" ref={containerRef}>
      <div className="chart-head">
        <h3 className="card-title">{title}</h3>
        <div className="chart-head-meta">
          {truncated && (
            <span className="chart-meta-text">
              {points!.length.toLocaleString('en-GB')} of {total.toLocaleString('en-GB')}
            </span>
          )}
          {zoom && (
            <button type="button" className="chart-reset" onClick={() => setZoom(null)}>
              Reset zoom
            </button>
          )}
        </div>
      </div>

      {!points ? (
        <div className="skeleton" />
      ) : error ? (
        <div className="card-empty card-error">Could not load {title.toLowerCase()}: {error}</div>
      ) : !hasData ? (
        <div className="card-empty">Nothing recorded in this window.</div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          {chartType === 'bar' ? (
            <BarChart
              data={points}
              margin={{ top: 6, right: 10, bottom: 0, left: 0 }}
              style={{ cursor: 'crosshair', userSelect: 'none' }}
              {...dragHandlers}
            >
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey="startTime"
                tickFormatter={tickFmt}
                axisLine={{ stroke: 'var(--baseline)' }}
                minTickGap={40}
                {...axisProps}
              />
              <YAxis width={50} axisLine={false} tickFormatter={formatAxisNumber} {...axisProps} />
              <Tooltip
                content={makeTooltip(unit, spanDays, bucket, artifactBelow)}
                cursor={{ fill: 'var(--grid)' }}
              />
              <Bar dataKey="value" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
              {selection}
            </BarChart>
          ) : (
            <LineChart
              data={points}
              margin={{ top: 6, right: 10, bottom: 0, left: 0 }}
              style={{ cursor: 'crosshair', userSelect: 'none' }}
              {...dragHandlers}
            >
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis
                dataKey="startTime"
                tickFormatter={tickFmt}
                axisLine={{ stroke: 'var(--baseline)' }}
                minTickGap={40}
                {...axisProps}
              />
              <YAxis
                width={50}
                axisLine={false}
                domain={['auto', 'auto']}
                tickFormatter={formatAxisNumber}
                {...axisProps}
              />
              <Tooltip
                content={makeTooltip(unit, spanDays, bucket, artifactBelow)}
                cursor={{ stroke: 'var(--baseline)', strokeWidth: 1 }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={SERIES}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={makeDot(points.length - 1, artifactBelow)}
                isAnimationActive={false}
                connectNulls
              />
              {selection}
            </LineChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  )
}
