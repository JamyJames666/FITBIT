'use client'

import { useEffect, useState } from 'react'
import StatTile from './StatTile'
import { useSync } from './DashboardClient'
import { METRIC_ACCENT } from '@/lib/metricMeta'

interface Metric {
  label: string
  value: number | null
  unit: string
}

export default function SummaryStats({ since, until }: { since: string; until: string }) {
  const [metrics, setMetrics] = useState<Record<string, Metric> | null>(null)
  const { refreshToken } = useSync()

  useEffect(() => {
    let cancelled = false
    fetch(`/api/summary?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setMetrics(d.metrics)
      })
    return () => {
      cancelled = true
    }
  }, [since, until, refreshToken])

  if (!metrics) {
    return (
      <div className="stat-grid">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="card-empty skeleton stat-tile-skeleton" />
        ))}
      </div>
    )
  }

  return (
    <div className="stat-grid">
      {Object.entries(metrics).map(([key, m]) => (
        <StatTile key={m.label} label={m.label} value={m.value} unit={m.unit} accent={METRIC_ACCENT[key]} />
      ))}
    </div>
  )
}
