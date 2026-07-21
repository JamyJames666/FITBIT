'use client'

import { useState } from 'react'
import TrendChart, { RangeConfig } from './TrendChart'
import SummaryStats from './SummaryStats'
import { RAW_ALWAYS_TYPES, SUM_TYPES } from '@/lib/metricMeta'

type Timeframe = 'day' | 'week' | 'month' | 'custom'

const SPO2_ARTIFACT_BELOW = 70
const minutesToHours = (v: number) => v / 60

const CHARTS: Array<{
  dataType: string
  title: string
  unit: string
  chartType: 'line' | 'bar'
  seriesSlot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  transform?: (v: number) => number
  artifactBelow?: number
}> = [
  { dataType: 'heart-rate', title: 'Heart rate', unit: 'bpm', chartType: 'line', seriesSlot: 1 },
  { dataType: 'steps', title: 'Steps', unit: 'steps', chartType: 'bar', seriesSlot: 2 },
  { dataType: 'distance', title: 'Distance', unit: 'm', chartType: 'bar', seriesSlot: 3 },
  { dataType: 'active-energy-burned', title: 'Calories burned', unit: 'kcal', chartType: 'bar', seriesSlot: 4 },
  { dataType: 'active-minutes', title: 'Active minutes', unit: 'min', chartType: 'bar', seriesSlot: 5 },
  { dataType: 'heart-rate-variability', title: 'Heart rate variability', unit: 'ms', chartType: 'line', seriesSlot: 6 },
  {
    dataType: 'oxygen-saturation',
    title: 'Blood oxygen (SpO2)',
    unit: '%',
    chartType: 'line',
    seriesSlot: 7,
    artifactBelow: SPO2_ARTIFACT_BELOW,
  },
  { dataType: 'daily-resting-heart-rate', title: 'Resting heart rate', unit: 'bpm', chartType: 'line', seriesSlot: 8 },
  { dataType: 'sleep', title: 'Sleep', unit: 'hrs', chartType: 'bar', seriesSlot: 1, transform: minutesToHours },
]

const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  day: 'Today',
  week: 'This week',
  month: 'This month',
  custom: 'Selected range',
}

function hoursFor(timeframe: Timeframe): number {
  if (timeframe === 'day') return 24
  if (timeframe === 'week') return 24 * 7
  return 24 * 30
}

function todayInputValue(daysAgo = 0) {
  const d = new Date(Date.now() - daysAgo * 86_400_000)
  return d.toISOString().slice(0, 10)
}

export default function TrendsSection() {
  const [timeframe, setTimeframe] = useState<Timeframe>('day')
  // Full ISO timestamps, not just dates — a scroll/drag zoom needs
  // sub-day precision, only the manual date-picker inputs below round to
  // whole days.
  const [customSince, setCustomSince] = useState(todayInputValue(7) + 'T00:00:00.000Z')
  const [customUntil, setCustomUntil] = useState(todayInputValue(0) + 'T23:59:59.999Z')

  const since = timeframe === 'custom' ? customSince : new Date(Date.now() - hoursFor(timeframe) * 3_600_000).toISOString()
  const until = timeframe === 'custom' ? customUntil : new Date().toISOString()
  const spanDays = (new Date(until).getTime() - new Date(since).getTime()) / 86_400_000

  function chartRange(dataType: string): RangeConfig {
    if (RAW_ALWAYS_TYPES.has(dataType)) return { since, until, bucket: 'none', spanDays }
    const isSum = SUM_TYPES.has(dataType)
    let bucket: RangeConfig['bucket']
    // Progressively finer as the window narrows — zoomed in far enough,
    // every chart (including cumulative-count ones like steps) shows raw
    // unbucketed points rather than an hourly rollup.
    if (spanDays <= 0.25) bucket = 'none'
    else if (spanDays <= 2) bucket = isSum ? 'hour' : 'none'
    else if (spanDays <= 10) bucket = isSum ? 'day' : 'hour'
    else bucket = 'day'
    return { since, until, bucket, spanDays }
  }

  function handleZoom(sinceISO: string, untilISO: string) {
    setTimeframe('custom')
    setCustomSince(sinceISO)
    setCustomUntil(untilISO)
  }

  function setCustomDate(which: 'since' | 'until', dateValue: string) {
    if (which === 'since') setCustomSince(dateValue + 'T00:00:00.000Z')
    else setCustomUntil(dateValue + 'T23:59:59.999Z')
  }

  return (
    <>
      <div className="status-row">
        <h2 className="section-title" style={{ margin: 0 }}>
          {TIMEFRAME_LABEL[timeframe]}
        </h2>
      </div>
      <SummaryStats since={since} until={until} />

      <div className="range-row">
        {(['day', 'week', 'month'] as Timeframe[]).map((tf) => (
          <button
            key={tf}
            className={`range-btn ${timeframe === tf ? 'active' : ''}`}
            onClick={() => setTimeframe(tf)}
          >
            {tf === 'day' ? 'Day' : tf === 'week' ? 'Week' : 'Month'}
          </button>
        ))}
        <button
          className={`range-btn ${timeframe === 'custom' ? 'active' : ''}`}
          onClick={() => setTimeframe('custom')}
        >
          Custom
        </button>
        {timeframe === 'custom' && (
          <span className="range-custom">
            <input type="date" value={customSince.slice(0, 10)} onChange={(e) => setCustomDate('since', e.target.value)} />
            <span className="muted">to</span>
            <input type="date" value={customUntil.slice(0, 10)} onChange={(e) => setCustomDate('until', e.target.value)} />
          </span>
        )}
        <span className="muted range-hint">Drag to zoom, or scroll on a chart to zoom in/out around the cursor.</span>
      </div>

      <div className="chart-grid">
        {CHARTS.map((c) => (
          <TrendChart
            key={c.dataType}
            dataType={c.dataType}
            title={c.title}
            unit={c.unit}
            chartType={c.chartType}
            seriesSlot={c.seriesSlot}
            range={chartRange(c.dataType)}
            onZoom={handleZoom}
            transform={c.transform}
            artifactBelow={c.artifactBelow}
          />
        ))}
      </div>
    </>
  )
}
