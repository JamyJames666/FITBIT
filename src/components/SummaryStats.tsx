'use client'

import { useEffect, useState } from 'react'
import StatTile from './StatTile'

interface Metric {
  label: string
  value: number | null
  unit: string
}

export default function SummaryStats() {
  const [metrics, setMetrics] = useState<Record<string, Metric> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/summary')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setMetrics(d.metrics)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!metrics) return <div className="card-empty">Loading…</div>

  return (
    <div className="stat-grid">
      {Object.values(metrics).map((m) => (
        <StatTile key={m.label} label={m.label} value={m.value} unit={m.unit} />
      ))}
    </div>
  )
}
