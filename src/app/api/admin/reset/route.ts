import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// TEMPORARY one-off migration endpoint: wipes DataPoint rows + SyncState
// for a data type so the next sync re-backfills it from scratch. Needed
// again because a type can partially succeed (some pages upserted) before
// a later page/window throws — leaving stale rows even though the overall
// sync call reported failure. Delete this route once used.
export async function POST(req: NextRequest) {
  const dataType = req.nextUrl.searchParams.get('dataType')
  if (!dataType) {
    return NextResponse.json({ error: 'dataType is required' }, { status: 400 })
  }

  const deleted = await prisma.dataPoint.deleteMany({ where: { dataType } })
  await prisma.syncState.deleteMany({ where: { dataType } })

  return NextResponse.json({ ok: true, deleted: deleted.count })
}
