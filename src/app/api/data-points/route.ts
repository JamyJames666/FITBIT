import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { aggMode, RAW_ALWAYS_TYPES } from '@/lib/metricMeta'
import { resolvePreferredSource } from '@/lib/sourcePreference'

export const dynamic = 'force-dynamic'

// Generic per-data-type reader: powers the trend charts, the data explorer
// table, and (with ?raw=1) inspection of the exact payload Google sends for
// a given data type.
//
// ?bucket=hour|day aggregates into time buckets (SUM for cumulative types
// like steps, AVG for point-in-time measurements like heart rate) instead
// of returning every raw row — without this, a month of per-minute steps
// data renders as an unreadable solid block.
export async function GET(req: NextRequest) {
  const dataType = req.nextUrl.searchParams.get('dataType')
  if (!dataType) {
    return NextResponse.json({ error: 'dataType is required' }, { status: 400 })
  }

  const hoursParam = req.nextUrl.searchParams.get('hours')
  const sinceParam = req.nextUrl.searchParams.get('since')
  const untilParam = req.nextUrl.searchParams.get('until')
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '100')
  const includeRaw = req.nextUrl.searchParams.get('raw') === '1'
  const page = Number(req.nextUrl.searchParams.get('page') ?? '0')
  const bucketParam = req.nextUrl.searchParams.get('bucket')
  const bucket = bucketParam === 'hour' || bucketParam === 'day' ? bucketParam : 'none'
  const dedupe = req.nextUrl.searchParams.get('dedupe') === '1'

  const until = untilParam ? new Date(untilParam) : new Date()
  const since = sinceParam
    ? new Date(sinceParam)
    : hoursParam
      ? new Date(until.getTime() - Number(hoursParam) * 3_600_000)
      : null

  const source = dedupe ? await resolvePreferredSource(dataType, since, until) : undefined

  if (bucket !== 'none' && !RAW_ALWAYS_TYPES.has(dataType) && since) {
    const aggFn = aggMode(dataType) === 'sum' ? 'SUM' : 'AVG'
    const rows = source
      ? await prisma.$queryRawUnsafe<Array<{ bucket: Date; agg: number | null }>>(
          `SELECT date_trunc('${bucket}', "startTime") as bucket, ${aggFn}("value")::float as agg
           FROM "DataPoint"
           WHERE "dataType" = $1 AND "startTime" >= $2 AND "startTime" < $3 AND "source" = $4
           GROUP BY bucket ORDER BY bucket ASC`,
          dataType,
          since,
          until,
          source
        )
      : await prisma.$queryRawUnsafe<Array<{ bucket: Date; agg: number | null }>>(
          `SELECT date_trunc('${bucket}', "startTime") as bucket, ${aggFn}("value")::float as agg
           FROM "DataPoint"
           WHERE "dataType" = $1 AND "startTime" >= $2 AND "startTime" < $3
           GROUP BY bucket ORDER BY bucket ASC`,
          dataType,
          since,
          until
        )
    return NextResponse.json({
      total: rows.length,
      points: rows.map((r) => ({
        startTime: r.bucket.toISOString(),
        endTime: null,
        value: r.agg,
        unit: null,
        source: null,
      })),
    })
  }

  const where = {
    dataType,
    ...(since ? { startTime: { gte: since, lt: until } } : {}),
    ...(source ? { source } : {}),
  }

  const [points, total] = await Promise.all([
    prisma.dataPoint.findMany({
      where,
      orderBy: { startTime: 'desc' },
      skip: page * limit,
      take: limit,
      select: {
        startTime: true,
        endTime: true,
        value: true,
        unit: true,
        source: true,
        raw: includeRaw,
      },
    }),
    prisma.dataPoint.count({ where }),
  ])

  return NextResponse.json({ total, points })
}
