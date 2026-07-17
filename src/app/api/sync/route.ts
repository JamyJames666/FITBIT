import { NextRequest, NextResponse } from 'next/server'
import { syncAllDataTypes, syncDataType, DataType, DATA_TYPES } from '@/lib/googleHealth'
import { prisma } from '@/lib/prisma'

// Default backfill window for a data type we've never synced before.
const DEFAULT_SINCE_DAYS = 30

export async function POST(req: NextRequest) {
  const since = new Date(Date.now() - DEFAULT_SINCE_DAYS * 86_400_000)
  const only = req.nextUrl.searchParams.get('dataType') as DataType | null

  try {
    if (only) {
      if (!DATA_TYPES.includes(only)) {
        return NextResponse.json({ ok: false, error: `Unknown dataType: ${only}` }, { status: 400 })
      }
      const state = await prisma.syncState.findUnique({ where: { dataType: only } })
      const count = await syncDataType(only, state?.lastSyncedAt ?? since)
      return NextResponse.json({ ok: true, results: { [only]: count } })
    }

    const results = await syncAllDataTypes(since)
    return NextResponse.json({ ok: true, results })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
