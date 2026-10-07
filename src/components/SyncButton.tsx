'use client'

import { useEffect, useState } from 'react'
import Icon from './Icon'
import { useSync } from './DashboardClient'

function timeAgo(date: Date): string {
  const secs = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

export default function SyncButton() {
  const { status, lastSyncedAt, runSync } = useSync()

  // The label is derived at render, so without a ticker it would keep saying
  // "2m ago" an hour later.
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const label =
    status === 'syncing'
      ? 'Syncing'
      : status === 'error'
        ? 'Sync failed, retry'
        : lastSyncedAt
          ? `Synced ${timeAgo(lastSyncedAt)}`
          : 'Sync now'

  return (
    <button
      type="button"
      className="chip"
      onClick={runSync}
      disabled={status === 'syncing'}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
    >
      <Icon name={status === 'error' ? 'alert' : 'sync'} size={13} />
      {label}
    </button>
  )
}
