'use client'

import { useState } from 'react'

export default function SyncButton() {
  const [status, setStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')

  async function runSync() {
    setStatus('syncing')
    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      setStatus('done')
      window.location.reload()
    } catch {
      setStatus('error')
    }
  }

  return (
    <button className="btn" onClick={runSync} disabled={status === 'syncing'}>
      {status === 'syncing' ? 'Syncing…' : status === 'error' ? 'Sync failed — retry' : 'Sync now'}
    </button>
  )
}
