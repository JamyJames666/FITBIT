import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolvePreferredSource } from '@/lib/sourcePreference'
import { startOfToday } from '@/lib/time'

export const dynamic = 'force-dynamic'

interface Metric {
  key: string
  dataType: string
  label: string
  mode: 'sum' | 'latest'
  unit: string
}

const METRICS: Metric[] = [
  { key: 'steps', dataType: 'steps', label: 'Steps', mode: 'sum', unit: 'steps' },
  { key: 'distance', dataType: 'distance', label: 'Distance', mode: 'sum', unit: 'km' },
  { key: 'calories', dataType: 'active-energy-burned', label: 'Calories burned', mode: 'sum', unit: 'kcal' },
  { key: 'activeMinutes', dataType: 'active-minutes', label: 'Active minutes', mode: 'sum', unit: 'min' },
  { key: 'heartRate', dataType: 'heart-rate', label: 'Heart rate', mode: 'latest', unit: 'bpm' },
  { key: 'restingHeartRate', dataType: 'daily-resting-heart-rate', label: 'Resting heart rate', mode: 'latest', unit: 'bpm' },
  { key: 'hrv', dataType: 'heart-rate-variability', label: 'Heart rate variability', mode: 'latest', unit: 'ms' },
  { key: 'spo2', dataType: 'oxygen-saturation', label: 'Blood oxygen', mode: 'latest', unit: '%' },
  { key: 'sleep', dataType: 'sleep', label: 'Sleep', mode: 'latest', unit: 'min' },
  { key: 'weight', dataType: 'weight', label: 'Weight', mode: 'latest', unit: 'kg' },
]

const METRES_PER_KM = 1000

function parseDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

export async function GET(req: NextRequest) {
  // Today means the local calendar day in a named time zone, not a rolling 24
  // hours and not a fixed offset. A rolling window double counts across
  // midnight and a fixed offset is wrong for half the year.
  const until = parseDate(req.nextUrl.searchParams.get('until'), new Date())
  const since = parseDate(req.nextUrl.searchParams.get('since'), startOfToday())

  const entries = await Promise.all(
    METRICS.map(async (m) => {
      const source = await resolvePreferredSource(m.dataType, since, until)
      const where = {
        dataType: m.dataType,
        startTime: { gte: since, lt: until },
        ...(source ? { source } : {}),
      }

      if (m.mode === 'sum') {
        const agg = await prisma.dataPoint.aggregate({ where, _sum: { value: true } })
        let value = agg._sum.value
        if (value != null && m.key === 'distance') value = value / METRES_PER_KM
        return [m.key, { label: m.label, value, unit: m.unit, at: null as string | null }]
      }

      // The most recent reading inside the selected period, so a past custom
      // range shows that period's last value rather than today's.
      const point = await prisma.dataPoint.findFirst({
        where,
        orderBy: { startTime: 'desc' },
        select: { value: true, startTime: true },
      })
      return [
        m.key,
        { label: m.label, value: point?.value ?? null, unit: m.unit, at: point?.startTime.toISOString() ?? null },
      ]
    })
  )

  return NextResponse.json({ metrics: Object.fromEntries(entries) })
}
