import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DATA_TYPES } from '@/lib/dataTypes'
import { aggMode, RAW_ALWAYS_TYPES } from '@/lib/metricMeta'
import { resolvePreferredSource } from '@/lib/sourcePreference'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 20_000
const DEFAULT_LIMIT = 100
const MAX_PAGE = 10_000

const KNOWN_TYPES = new Set<string>(DATA_TYPES)

// Every numeric parameter is clamped rather than passed through. Prisma throws
// on a NaN take and an unbounded limit turns one query string into a way to
// pull the whole table.
function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  if (raw == null || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

function dateParam(raw: string | null): Date | null {
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

// Reads one data type, and powers the trend charts, the explorer table and
// raw payload inspection.
//
// bucket=hour|day aggregates into time buckets, summing cumulative types such
// as steps and averaging point-in-time ones such as heart rate. Without it a
// month of per-minute data renders as a solid block.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const dataType = params.get('dataType')

  if (!dataType) {
    return NextResponse.json({ error: 'dataType is required' }, { status: 400 })
  }
  if (!KNOWN_TYPES.has(dataType)) {
    return NextResponse.json({ error: `Unknown dataType: ${dataType}` }, { status: 400 })
  }

  const limit = intParam(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT)
  const page = intParam(params.get('page'), 0, 0, MAX_PAGE)
  const includeRaw = params.get('raw') === '1'
  const dedupe = params.get('dedupe') === '1'
  const bucketParam = params.get('bucket')
  const bucket = bucketParam === 'hour' || bucketParam === 'day' ? bucketParam : 'none'

  const until = dateParam(params.get('until')) ?? new Date()
  const hours = params.get('hours') ? intParam(params.get('hours'), 24, 1, 24 * 365 * 5) : null
  const since = dateParam(params.get('since')) ?? (hours ? new Date(until.getTime() - hours * 3_600_000) : null)

  const source = dedupe ? await resolvePreferredSource(dataType, since, until) : undefined

  if (bucket !== 'none' && !RAW_ALWAYS_TYPES.has(dataType) && since) {
    // bucket and the aggregate function are both chosen from a fixed set
    // above, never taken from the request, so neither reaches SQL as
    // caller-controlled text.
    const aggFn = aggMode(dataType) === 'sum' ? 'SUM' : 'AVG'
    const sql = `SELECT date_trunc('${bucket}', "startTime") AS bucket, ${aggFn}("value")::float AS agg
       FROM "DataPoint"
       WHERE "dataType" = $1 AND "startTime" >= $2 AND "startTime" < $3${source ? ' AND "source" = $4' : ''}
       GROUP BY bucket ORDER BY bucket ASC`

    const rows = source
      ? await prisma.$queryRawUnsafe<Array<{ bucket: Date; agg: number | null }>>(sql, dataType, since, until, source)
      : await prisma.$queryRawUnsafe<Array<{ bucket: Date; agg: number | null }>>(sql, dataType, since, until)

    return NextResponse.json({
      total: rows.length,
      bucket,
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

  return NextResponse.json({ total, bucket: 'none', points })
}
