'use client'

import { useSync } from './DashboardClient'

function timeAgo(date: Date) {
  const secs = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  return `${mins}m ago`
}

export default function SyncButton() {
  const { status, lastSyncedAt, runSync } = useSync()

  return (
    <div className="sync-row">
      {lastSyncedAt && status !== 'syncing' && (
        <span className="muted sync-hint">
          {status === 'error' ? 'Last sync failed — retrying every 60s' : `Synced ${timeAgo(lastSyncedAt)}`}
        </span>
      )}
      <button className="btn" onClick={runSync} disabled={status === 'syncing'}>
        {status === 'syncing' ? 'Syncing…' : status === 'error' ? 'Sync failed — retry now' : 'Sync now'}
      </button>
    </div>
  )
}
