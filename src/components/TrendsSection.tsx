'use client'

import { useState } from 'react'
import SummaryStats from './SummaryStats'
import TrendChart from './TrendChart'
import { localDateKey, startOfLocalDate } from '@/lib/time'

type Timeframe = 'day' | 'week' | 'month' | 'custom'

const SPO2_ARTIFACT_BELOW = 70
const minutesToHours = (v: number) => v / 60

const CHARTS: Array<{
  dataType: string
  title: string
  unit: string
  chartType: 'line' | 'bar'
  transform?: (v: number) => number
  artifactBelow?: number
}> = [
  { dataType: 'heart-rate', title: 'Heart rate', unit: 'bpm', chartType: 'line' },
  { dataType: 'steps', title: 'Steps', unit: 'steps', chartType: 'bar' },
  { dataType: 'distance', title: 'Distance', unit: 'm', chartType: 'bar' },
  { dataType: 'active-energy-burned', title: 'Calories burned', unit: 'kcal', chartType: 'bar' },
  { dataType: 'active-minutes', title: 'Active minutes', unit: 'min', chartType: 'bar' },
  { dataType: 'heart-rate-variability', title: 'Heart rate variability', unit: 'ms', chartType: 'line' },
  {
    dataType: 'oxygen-saturation',
    title: 'Blood oxygen',
    unit: '%',
    chartType: 'line',
    artifactBelow: SPO2_ARTIFACT_BELOW,
  },
  { dataType: 'daily-resting-heart-rate', title: 'Resting heart rate', unit: 'bpm', chartType: 'line' },
  { dataType: 'sleep', title: 'Sleep', unit: 'hrs', chartType: 'bar', transform: minutesToHours },
]

const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  day: 'Last 24 hours',
  week: 'Last 7 days',
  month: 'Last 30 days',
  custom: 'Selected range',
}

function hoursFor(timeframe: Timeframe): number {
  if (timeframe === 'day') return 24
  if (timeframe === 'week') return 24 * 7
  return 24 * 30
}

function dateInputValue(daysAgo = 0): string {
  return localDateKey(new Date(Date.now() - daysAgo * 86_400_000))
}

export default function TrendsSection() {
  const [timeframe, setTimeframe] = useState<Timeframe>('day')
  const [customFrom, setCustomFrom] = useState(dateInputValue(7))
  const [customTo, setCustomTo] = useState(dateInputValue(0))

  // A date picked in the browser is a local calendar date. Treating its
  // YYYY-MM-DD as a UTC instant shifts every custom range by the offset.
  const since =
    timeframe === 'custom'
      ? startOfLocalDate(customFrom).toISOString()
      : new Date(Date.now() - hoursFor(timeframe) * 3_600_000).toISOString()

  const until =
    timeframe === 'custom'
      ? new Date(startOfLocalDate(customTo).getTime() + 86_400_000).toISOString()
      : new Date().toISOString()

  // Changing this string is what tells every chart that the picked period moved
  // and its own zoom should go back to the full window.
  const resetKey = `${timeframe}|${since}|${until}`

  return (
    <>
      <div className="section-head">
        <h2 className="section-label">{TIMEFRAME_LABEL[timeframe]}</h2>
        <div className="control-row">
          {(['day', 'week', 'month'] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              type="button"
              className="chip"
              aria-pressed={timeframe === tf}
              onClick={() => setTimeframe(tf)}
            >
              {tf === 'day' ? 'Day' : tf === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
          <button
            type="button"
            className="chip"
            aria-pressed={timeframe === 'custom'}
            onClick={() => setTimeframe('custom')}
          >
            Custom
          </button>
          {timeframe === 'custom' && (
            <>
              <input
                type="date"
                className="field"
                value={customFrom}
                max={customTo}
                aria-label="Range start"
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <span className="hint">to</span>
              <input
                type="date"
                className="field"
                value={customTo}
                min={customFrom}
                aria-label="Range end"
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </>
          )}
        </div>
      </div>

      <SummaryStats since={since} until={until} />

      <p className="hint">Scroll or drag on any chart to zoom it. Each one zooms on its own.</p>

      <div className="chart-grid">
        {CHARTS.map((c) => (
          <TrendChart
            key={c.dataType}
            dataType={c.dataType}
            title={c.title}
            unit={c.unit}
            chartType={c.chartType}
            baseSince={since}
            baseUntil={until}
            resetKey={resetKey}
            transform={c.transform}
            artifactBelow={c.artifactBelow}
          />
        ))}
      </div>
    </>
  )
}
