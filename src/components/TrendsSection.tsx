'use client'

import { useState } from 'react'
import TrendChart from './TrendChart'
import SummaryStats from './SummaryStats'

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
  const [customSince, setCustomSince] = useState(todayInputValue(7) + 'T00:00:00.000Z')
  const [customUntil, setCustomUntil] = useState(todayInputValue(0) + 'T23:59:59.999Z')

  const since = timeframe === 'custom' ? customSince : new Date(Date.now() - hoursFor(timeframe) * 3_600_000).toISOString()
  const until = timeframe === 'custom' ? customUntil : new Date().toISOString()
  // Changing this string is what tells every chart "the picked period moved,
  // drop your local zoom and go back to the full base window."
  const resetKey = `${timeframe}|${since}|${until}`

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
        <span className="muted range-hint">
          Scroll or drag on a chart to zoom into it — each one zooms independently.
        </span>
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
