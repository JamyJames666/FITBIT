import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const SINCE_HOURS = 24

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
  const since = new Date(Date.now() - SINCE_HOURS * 3_600_000)

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
