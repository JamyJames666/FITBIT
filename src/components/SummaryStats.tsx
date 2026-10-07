'use client'

import { useEffect, useState } from 'react'
import StatTile from './StatTile'
import { useSync } from './DashboardClient'

interface Metric {
  label: string
  value: number | null
  unit: string
}

const TILE_COUNT = 10

export default function SummaryStats({ since, until }: { since: string; until: string }) {
  const [metrics, setMetrics] = useState<Record<string, Metric> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { refreshToken } = useSync()

  useEffect(() => {
    let cancelled = false
    setError(null)

    fetch(`/api/summary?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`)
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error ?? `Request failed with ${r.status}`)
        return body
      })
      .then((d) => {
        if (!cancelled) setMetrics(d.metrics)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [since, until, refreshToken])

  if (error) {
    return <p className="card-error">Could not load the summary: {error}</p>
  }

  if (!metrics) {
    return (
      <div className="stat-grid">
        {Array.from({ length: TILE_COUNT }).map((_, i) => (
          <div key={i} className="stat">
            <div className="skeleton" style={{ height: 42 }} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="stat-grid">
      {Object.entries(metrics).map(([key, m]) => (
        <StatTile key={key} label={m.label} value={m.value} unit={m.unit} />
      ))}
    </div>
  )
}
