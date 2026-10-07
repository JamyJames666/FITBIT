// Fills the database with synthetic but structurally realistic data, so the
// dashboard and the whole model stack can be run without a wearable. The
// generator builds in a weekly rhythm, a slow trend, a training block, a
// two-day illness and a travel week, because a model layer tested only
// against smooth noise looks like it works when it doesn't.
//
//   npm run seed:demo          120 days, replacing anything already seeded
//   npm run seed:demo -- 240   a longer history
//
// Every row it writes carries source 'DEMO', and it removes only those rows,
// so it can never touch real synced data.
import 'dotenv/config'
import type { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma'

const SOURCE = 'DEMO'
const DEFAULT_DAYS = 120
const WRITE_BATCH = 2000

// Deterministic, so two runs produce the same history and a change in model
// output is a change in the model rather than in the dice.
function makeRandom(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

const rand = makeRandom(20260407)

// Box-Muller, so the noise is normal rather than uniform. Uniform noise never
// produces the occasional extreme day that the anomaly detector exists for.
function gauss(mean: number, sd: number): number {
  const u = Math.max(rand(), 1e-9)
  const v = rand()
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

interface Row {
  dataType: string
  startTime: Date
  endTime: Date | null
  value: number | null
  unit: string | null
  source: string
  raw: Prisma.InputJsonValue
}

function row(dataType: string, at: Date, value: number, unit: string, minutes = 0): Row {
  return {
    dataType,
    startTime: at,
    endTime: minutes ? new Date(at.getTime() + minutes * 60_000) : null,
    value: Math.round(value * 100) / 100,
    unit,
    source: SOURCE,
    raw: { synthetic: true, dataType, value },
  }
}

interface DayShape {
  date: Date
  weekday: number
  steps: number
  activeMinutes: number
  calories: number
  sleepMinutes: number
  restingHeartRate: number
  hrv: number
  spo2: number
}

// Weekday multipliers for activity, so a commute on weekdays, a long walk on
// Saturday and a quiet Sunday. This is the seasonal term the decomposition is
// meant to recover.
const WEEKDAY_ACTIVITY = [1.05, 1.0, 1.02, 0.94, 1.08, 1.3, 0.72]
const WEEKDAY_SLEEP = [-18, -12, -10, -6, 4, 46, 38]

function buildDays(days: number): DayShape[] {
  const out: DayShape[] = []
  const midnightToday = new Date()
  midnightToday.setHours(0, 0, 0, 0)

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(midnightToday.getTime() - i * 86_400_000)
    const weekday = (date.getDay() + 6) % 7
    const age = days - i

    // A slow fitness trend across the whole window, plus a four week training
    // block near the end that the acute-to-chronic ratio should pick up.
    const trend = age / days
    const inTrainingBlock = i < 24 && i >= 6
    const blockBoost = inTrainingBlock ? 1.28 : 1

    // Two days of illness three weeks back, with resting heart rate up, heart
    // rate variability down and activity collapsing. This is what the anomaly
    // detector is there to find.
    const ill = i === 21 || i === 20

    // A week away with disrupted sleep, which should show up in the sleep
    // consistency component rather than in the duration alone.
    const travelling = i >= 54 && i <= 60

    const activity = WEEKDAY_ACTIVITY[weekday] * blockBoost * (ill ? 0.22 : 1)
    const steps = Math.max(400, gauss(8200 + 1800 * trend, 1900) * activity)
    const activeMinutes = Math.max(2, gauss(34 + 10 * trend, 11) * activity)
    const calories = Math.max(40, activeMinutes * gauss(8.4, 1.1))

    const sleepBase = 432 + WEEKDAY_SLEEP[weekday]
    const sleepMinutes = Math.max(
      150,
      gauss(sleepBase, travelling ? 96 : 34) - (inTrainingBlock ? 8 : 0) + (ill ? 52 : 0)
    )

    const restingHeartRate = gauss(55 - 3 * trend, 1.9) + (ill ? 9.5 : 0) + (inTrainingBlock ? 1.1 : 0)
    const hrv = Math.max(12, gauss(48 + 7 * trend, 6.5) - (ill ? 18 : 0) - (inTrainingBlock ? 3 : 0))
    const spo2 = Math.min(100, gauss(96.7, 0.9) - (ill ? 1.4 : 0))

    out.push({ date, weekday, steps, activeMinutes, calories, sleepMinutes, restingHeartRate, hrv, spo2 })
  }

  return out
}

function buildRows(shape: DayShape[]): Row[] {
  const rows: Row[] = []
  const lastIndex = shape.length - 1

  shape.forEach((day, index) => {
    const daysAgo = lastIndex - index

    // Step and calorie counters arrive as many small interval records through
    // the waking day, the same shape the real API returns, so the bucketing
    // and the double-count guard both get exercised.
    const buckets = 15
    for (let b = 0; b < buckets; b++) {
      const at = new Date(day.date.getTime() + (7 + b) * 3_600_000)
      if (at.getTime() > Date.now()) break
      // More movement late morning and early evening than mid afternoon.
      const shapeWeight = 0.6 + 0.9 * Math.exp(-(((b - 3) / 3) ** 2)) + 0.8 * Math.exp(-(((b - 11) / 2.4) ** 2))
      const share = shapeWeight / 14.2
      rows.push(row('steps', at, Math.max(0, day.steps * share * gauss(1, 0.22)), 'steps', 60))
      rows.push(row('distance', at, Math.max(0, day.steps * share * 0.72 * gauss(1, 0.2)), 'm', 60))
      rows.push(row('active-energy-burned', at, Math.max(0, day.calories * share * gauss(1, 0.25)), 'kcal', 60))
      rows.push(row('active-minutes', at, Math.max(0, day.activeMinutes * share * gauss(1, 0.3)), 'min', 60))
    }

    // Sleep is one session attributed to the morning it ends on.
    const wake = new Date(day.date.getTime() + 7 * 3_600_000)
    rows.push(row('sleep', new Date(wake.getTime() - day.sleepMinutes * 60_000), day.sleepMinutes, 'min', day.sleepMinutes))

    rows.push(row('daily-resting-heart-rate', new Date(day.date.getTime() + 4 * 3_600_000), day.restingHeartRate, 'bpm'))
    rows.push(row('heart-rate-variability', new Date(day.date.getTime() + 4 * 3_600_000), day.hrv, 'ms'))
    rows.push(row('oxygen-saturation', new Date(day.date.getTime() + 3 * 3_600_000), day.spo2, '%'))

    if (index % 7 === 0) {
      rows.push(row('weight', new Date(day.date.getTime() + 8 * 3_600_000), gauss(78.5 - 2.2 * (index / lastIndex), 0.4), 'kg'))
    }

    // Intraday heart rate at five minute resolution for the last fortnight and
    // half-hourly before that, so the day view has real density without
    // writing a hundred thousand rows.
    const stepMinutes = daysAgo <= 14 ? 5 : 30
    for (let minute = 0; minute < 1440; minute += stepMinutes) {
      const at = new Date(day.date.getTime() + minute * 60_000)
      if (at.getTime() > Date.now()) break
      const hour = minute / 60
      const asleep = hour < 6.5
      const base = asleep ? day.restingHeartRate - 3 : day.restingHeartRate + 18
      const exertion = !asleep ? 26 * Math.exp(-(((hour - 18) / 1.1) ** 2)) : 0
      rows.push(row('heart-rate', at, Math.max(38, gauss(base + exertion, asleep ? 2.4 : 7)), 'bpm'))
    }
  })

  return rows
}

async function main() {
  const days = Number(process.argv[2]) || DEFAULT_DAYS
  if (!Number.isFinite(days) || days < 30 || days > 1000) {
    throw new Error('Pass a day count between 30 and 1000')
  }

  console.log(`Generating ${days} days of demo data`)
  const rows = buildRows(buildDays(days))

  const removed = await prisma.dataPoint.deleteMany({ where: { source: SOURCE } })
  console.log(`Removed ${removed.count} previously seeded rows`)

  let written = 0
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const result = await prisma.dataPoint.createMany({
      data: rows.slice(i, i + WRITE_BATCH),
      skipDuplicates: true,
    })
    written += result.count
  }

  console.log(`Wrote ${written} rows across ${new Set(rows.map((r) => r.dataType)).size} data types`)
  console.log('Built in: a four week training block, two days of illness 3 weeks back, and a disrupted travel week.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
