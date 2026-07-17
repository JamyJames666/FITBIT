import { NextResponse } from 'next/server'
import { syncAllDataTypes } from '@/lib/googleHealth'

// Default backfill window for a data type we've never synced before.
const DEFAULT_SINCE_DAYS = 30

export async function POST() {
  const since = new Date(Date.now() - DEFAULT_SINCE_DAYS * 86_400_000)
  try {
    const results = await syncAllDataTypes(since)
    return NextResponse.json({ ok: true, results })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
