import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// "Today" means the local calendar day, not a rolling 24h window — a
// rolling window double-counts across midnight and doesn't match what the
// Fitbit/Google Health app shows. Default +60min matches the utcOffset
// seen in this account's synced data; override via env if that changes.
const TZ_OFFSET_MINUTES = Number(process.env.TZ_OFFSET_MINUTES ?? '60')

function startOfLocalDay(offsetMinutes: number) {
  const localNow = new Date(Date.now() + offsetMinutes * 60_000)
  const localMidnightUtc = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate())
  return new Date(localMidnightUtc - offsetMinutes * 60_000)
}

interface Metric {
  key: string
  dataType: string
  label: string
  mode: 'sum' | 'latest'
  unit: string
}

const METRICS: Metric[] = [
  { key: 'steps', dataType: 'steps', label: 'Steps today', mode: 'sum', unit: 'steps' },
  { key: 'distance', dataType: 'distance', label: 'Distance today', mode: 'sum', unit: 'km' },
  { key: 'calories', dataType: 'active-energy-burned', label: 'Calories burned', mode: 'sum', unit: 'kcal' },
  { key: 'activeMinutes', dataType: 'active-minutes', label: 'Active minutes', mode: 'sum', unit: 'min' },
  { key: 'heartRate', dataType: 'heart-rate', label: 'Latest heart rate', mode: 'latest', unit: 'bpm' },
  { key: 'restingHeartRate', dataType: 'daily-resting-heart-rate', label: 'Resting heart rate', mode: 'latest', unit: 'bpm' },
  { key: 'hrv', dataType: 'heart-rate-variability', label: 'Heart rate variability', mode: 'latest', unit: 'ms' },
  { key: 'spo2', dataType: 'oxygen-saturation', label: 'Blood oxygen (SpO2)', mode: 'latest', unit: '%' },
  { key: 'sleep', dataType: 'sleep', label: 'Last sleep', mode: 'latest', unit: 'min' },
  { key: 'weight', dataType: 'weight', label: 'Weight', mode: 'latest', unit: 'kg' },
]

export async function GET() {
  const since = startOfLocalDay(TZ_OFFSET_MINUTES)

  const entries = await Promise.all(
    METRICS.map(async (m) => {
      if (m.mode === 'sum') {
        const agg = await prisma.dataPoint.aggregate({
          where: { dataType: m.dataType, startTime: { gte: since } },
          _sum: { value: true },
        })
        let value = agg._sum.value
        if (value != null && m.key === 'distance') value = value / 1000
        return [m.key, { label: m.label, value, unit: m.unit, at: null as string | null }]
      }

      const point = await prisma.dataPoint.findFirst({
        where: { dataType: m.dataType },
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
