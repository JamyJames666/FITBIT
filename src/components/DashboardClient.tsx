'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import SyncButton from './SyncButton'
import TrendsSection from './TrendsSection'
import DataExplorer from './DataExplorer'

const SYNC_INTERVAL_MS = 60_000

interface SyncState {
  status: 'idle' | 'syncing' | 'done' | 'error'
  lastSyncedAt: Date | null
  refreshToken: number
  runSync: () => Promise<void>
}

const SyncCtx = createContext<SyncState | null>(null)

export function useSync() {
  const ctx = useContext(SyncCtx)
  if (!ctx) throw new Error('useSync must be used within DashboardClient')
  return ctx
}

export default function DashboardClient() {
  const [status, setStatus] = useState<SyncState['status']>('idle')
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const inFlight = useRef(false)

  const runSync = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setStatus('syncing')
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      setStatus('done')
      setLastSyncedAt(new Date())
      setRefreshToken((t) => t + 1)
    } catch {
      setStatus('error')
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    runSync()
    // Auto-retries every tick regardless of whether the last attempt failed —
    // no need for a dedicated retry path, the next 60s tick covers it.
    const id = setInterval(runSync, SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, [runSync])

  return (
    <SyncCtx.Provider value={{ status, lastSyncedAt, refreshToken, runSync }}>
      <div className="status-row">
        <h1 className="page-title">Health Tracker</h1>
        <div className="header-actions">
          <SyncButton />
          <form action="/api/auth/logout" method="POST">
            <button type="submit" className="range-btn">
              Log out
            </button>
          </form>
        </div>
      </div>
      <TrendsSection />
      <h2 className="section-title">Explore raw data</h2>
      <DataExplorer />
    </SyncCtx.Provider>
  )
}
