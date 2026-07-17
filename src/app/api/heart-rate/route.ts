import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const hours = Number(req.nextUrl.searchParams.get('hours') ?? '24')
  const since = new Date(Date.now() - hours * 60 * 60 * 1000)

  const points = await prisma.dataPoint.findMany({
    where: { dataType: 'heart-rate', startTime: { gte: since } },
    orderBy: { startTime: 'asc' },
    select: { startTime: true, value: true },
  })

  return NextResponse.json({
    points: points.map((p) => ({ time: p.startTime.toISOString(), bpm: p.value })),
  })
}
