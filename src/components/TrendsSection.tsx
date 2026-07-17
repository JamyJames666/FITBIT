'use client'

import { useState } from 'react'
import TrendChart, { RangeConfig } from './TrendChart'
import { RAW_ALWAYS_TYPES } from '@/lib/metricMeta'

type Timeframe = 'day' | 'week' | 'month' | 'custom'

const CHARTS: Array<{
  dataType: string
  title: string
  unit: string
  chartType: 'line' | 'bar'
  seriesSlot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}> = [
  { dataType: 'heart-rate', title: 'Heart rate', unit: 'bpm', chartType: 'line', seriesSlot: 1 },
  { dataType: 'steps', title: 'Steps', unit: 'steps', chartType: 'bar', seriesSlot: 2 },
  { dataType: 'distance', title: 'Distance', unit: 'm', chartType: 'bar', seriesSlot: 3 },
  { dataType: 'active-energy-burned', title: 'Calories burned', unit: 'kcal', chartType: 'bar', seriesSlot: 4 },
  { dataType: 'active-minutes', title: 'Active minutes', unit: 'min', chartType: 'bar', seriesSlot: 5 },
  { dataType: 'heart-rate-variability', title: 'Heart rate variability', unit: 'ms', chartType: 'line', seriesSlot: 6 },
  { dataType: 'oxygen-saturation', title: 'Blood oxygen (SpO2)', unit: '%', chartType: 'line', seriesSlot: 7 },
  { dataType: 'daily-resting-heart-rate', title: 'Resting heart rate', unit: 'bpm', chartType: 'line', seriesSlot: 8 },
  { dataType: 'sleep', title: 'Sleep (minutes asleep)', unit: 'min', chartType: 'bar', seriesSlot: 1 },
]

function hoursFor(timeframe: Timeframe): number {
  if (timeframe === 'day') return 24
  if (timeframe === 'week') return 24 * 7
  return 24 * 30
}

function resolveRange(
  timeframe: Timeframe,
  dataType: string,
  custom: { since: string; until: string }
): RangeConfig {
  if (RAW_ALWAYS_TYPES.has(dataType)) {
    if (timeframe === 'custom') return { since: custom.since, until: custom.until, bucket: 'none' }
    return { hours: hoursFor(timeframe), bucket: 'none' }
  }

  const isSum = ['steps', 'distance', 'active-energy-burned', 'active-minutes'].includes(dataType)

  let spanDays: number
  if (timeframe === 'custom') {
    spanDays = (new Date(custom.until).getTime() - new Date(custom.since).getTime()) / 86_400_000
  } else {
    spanDays = timeframe === 'day' ? 1 : timeframe === 'week' ? 7 : 30
  }

  let bucket: RangeConfig['bucket']
  if (spanDays <= 1) bucket = isSum ? 'hour' : 'none'
  else if (spanDays <= 10) bucket = isSum ? 'day' : 'hour'
  else bucket = 'day'

  if (timeframe === 'custom') return { since: custom.since, until: custom.until, bucket }
  return { hours: hoursFor(timeframe), bucket }
}

function todayInputValue(daysAgo = 0) {
  const d = new Date(Date.now() - daysAgo * 86_400_000)
  return d.toISOString().slice(0, 10)
}

export default function TrendsSection() {
  const [timeframe, setTimeframe] = useState<Timeframe>('day')
  const [customSince, setCustomSince] = useState(todayInputValue(7))
  const [customUntil, setCustomUntil] = useState(todayInputValue(0))

  const custom = {
    since: new Date(customSince + 'T00:00:00.000Z').toISOString(),
    until: new Date(customUntil + 'T23:59:59.999Z').toISOString(),
  }

  return (
    <>
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
            <input type="date" value={customSince} onChange={(e) => setCustomSince(e.target.value)} />
            <span className="muted">to</span>
            <input type="date" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} />
          </span>
        )}
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
            range={resolveRange(timeframe, c.dataType, custom)}
          />
        ))}
      </div>
    </>
  )
}
