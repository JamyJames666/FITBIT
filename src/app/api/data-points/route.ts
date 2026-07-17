import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Generic per-data-type reader: powers the trend charts, the data explorer
// table, and (with ?raw=1) inspection of the exact payload Google sends for
// a given data type.
export async function GET(req: NextRequest) {
  const dataType = req.nextUrl.searchParams.get('dataType')
  if (!dataType) {
    return NextResponse.json({ error: 'dataType is required' }, { status: 400 })
  }

  const hours = req.nextUrl.searchParams.get('hours')
  const limit = Number(req.nextUrl.searchParams.get('limit') ?? '100')
  const includeRaw = req.nextUrl.searchParams.get('raw') === '1'
  const page = Number(req.nextUrl.searchParams.get('page') ?? '0')

  const where = {
    dataType,
    ...(hours ? { startTime: { gte: new Date(Date.now() - Number(hours) * 3_600_000) } } : {}),
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
