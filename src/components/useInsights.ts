'use client'

import { useEffect, useState } from 'react'
import type { Insights } from '@/lib/ml'
import { useSync } from './DashboardClient'

export type { Insights }

export interface InsightsState {
  data: Insights | null
  error: string | null
  loading: boolean
}

// One fetch per sync, shared by everything in the brief and by the model
// charts in the workbench, so a page with seven model-driven panels still
// runs the stack once.
export function useInsights(windowDays = 90): InsightsState {
  const [state, setState] = useState<InsightsState>({ data: null, error: null, loading: true })
  const { refreshToken } = useSync()

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))

    fetch(`/api/insights?days=${windowDays}`)
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error ?? `Request failed with ${r.status}`)
        return body as Insights
      })
      .then((data) => {
        if (!cancelled) setState({ data, error: null, loading: false })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({ data: null, error: err instanceof Error ? err.message : String(err), loading: false })
      })

    return () => {
      cancelled = true
    }
  }, [windowDays, refreshToken])

  return state
}
