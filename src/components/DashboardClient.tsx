'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Brief from './Brief'
import DataExplorer from './DataExplorer'
import Icon from './Icon'
import DeepPanels from './DeepPanels'
import ModelPanels from './ModelPanels'
import SyncButton from './SyncButton'
import ThemeToggle from './ThemeToggle'
import TrendsSection from './TrendsSection'

const SYNC_INTERVAL_MS = 5 * 60_000

interface SyncState {
  status: 'idle' | 'syncing' | 'done' | 'error'
  lastSyncedAt: Date | null
  refreshToken: number
  runSync: () => Promise<void>
}

const SyncCtx = createContext<SyncState | null>(null)

export function useSync() {
  const ctx = useContext(SyncCtx)
  if (!ctx) throw new Error('useSync must be used inside DashboardClient')
  return ctx
}

export default function DashboardClient({ connected = true }: { connected?: boolean }) {
  const [status, setStatus] = useState<SyncState['status']>('idle')
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const inFlight = useRef(false)

  const runSync = useCallback(async () => {
    if (!connected || inFlight.current) return
    inFlight.current = true
    setStatus('syncing')
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `Sync failed with ${res.status}`)
      setStatus('done')
      setLastSyncedAt(new Date())
      // A skipped run means another tab is already syncing, so there is
      // nothing new to redraw and bumping the token would refetch for nothing.
      if (!body?.skipped) setRefreshToken((t) => t + 1)
    } catch {
      setStatus('error')
    } finally {
      inFlight.current = false
    }
  }, [connected])

  useEffect(() => {
    if (!connected) return
    runSync()
    // A failed attempt needs no retry path of its own, the next tick covers it.
    const id = setInterval(runSync, SYNC_INTERVAL_MS)
    return () => clearInterval(id)
  }, [connected, runSync])

  return (
    <SyncCtx.Provider value={{ status, lastSyncedAt, refreshToken, runSync }}>
      <div className="shell">
        <header className="masthead">
          <h1 className="wordmark">
            Pulse Engine
            <span className="wordmark-tag">health signals in, decisions out</span>
          </h1>
          <div className="masthead-actions">
            {connected ? (
              <SyncButton />
            ) : (
              <a className="chip" href="/api/auth/connect">
                Connect Google account
              </a>
            )}
            <ThemeToggle />
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="chip" aria-label="Log out" style={{ display: 'inline-flex', padding: '6px 9px' }}>
                <Icon name="exit" />
              </button>
            </form>
          </div>
        </header>

        <Brief />

        <hr className="workbench-rule" />

        <main className="workbench">
          <TrendsSection />

          <div className="section-head">
            <h2 className="section-label">Models</h2>
          </div>
          <ModelPanels />

          <div className="section-head">
            <h2 className="section-label">The heavier models</h2>
            <p className="section-blurb">
              Everything above scores a day against your own baseline. These fit a model to the
              whole window instead, and each says what it found and how sure it is.
            </p>
          </div>
          <DeepPanels />

          <div className="section-head">
            <h2 className="section-label">Raw data</h2>
          </div>
          <DataExplorer />
        </main>
      </div>
    </SyncCtx.Provider>
  )
}
