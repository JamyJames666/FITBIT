import { NextRequest, NextResponse } from 'next/server'
import { DATA_TYPES, DataType, syncAllDataTypes, syncDataType } from '@/lib/googleHealth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DEFAULT_SINCE_DAYS = 30

// A full sync walks every data type across every 14 day window and can run for
// minutes. Several browser tabs each firing their own timer would run it
// several times over, against an API with a quota. One run at a time per
// process, and a caller who arrives mid-run is told so rather than queued.
let syncInFlight = false

export async function POST(req: NextRequest) {
  const since = new Date(Date.now() - DEFAULT_SINCE_DAYS * 86_400_000)
  const only = req.nextUrl.searchParams.get('dataType') as DataType | null

  if (only && !DATA_TYPES.includes(only)) {
    return NextResponse.json({ ok: false, error: `Unknown dataType: ${only}` }, { status: 400 })
  }

  if (syncInFlight) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'A sync is already running' }, { status: 202 })
  }

  syncInFlight = true
  try {
    if (only) {
      const state = await prisma.syncState.findUnique({ where: { dataType: only } })
      const result = await syncDataType(only, state?.lastSyncedAt ?? since)
      return NextResponse.json({ ok: true, results: { [only]: result } })
    }
    return NextResponse.json({ ok: true, results: await syncAllDataTypes(since) })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  } finally {
    syncInFlight = false
  }
}
