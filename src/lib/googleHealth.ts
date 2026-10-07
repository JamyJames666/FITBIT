import { prisma } from './prisma'
import { DATA_TYPES, DataType } from './dataTypes'

export { DATA_TYPES }
export type { DataType }

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const API_BASE = 'https://health.googleapis.com/v4'

const SCOPE_CATEGORIES = [
  'activity_and_fitness',
  'health_metrics_and_measurements',
  'sleep',
  'nutrition',
  'ecg',
  'irn',
] as const

export const SCOPES = SCOPE_CATEGORIES.map(
  (c) => `https://www.googleapis.com/auth/googlehealth.${c}.readonly`
)

const MAX_QUERY_DAYS = 14
const PAGE_SIZE = 1000
const WRITE_BATCH = 500

// Google's unique key for a reading is its type, its timestamp and the device
// that recorded it. Postgres treats every NULL as distinct under a unique
// constraint, so a null source defeats that key and lets the same reading
// insert again on every sync. Every write goes through this placeholder.
const UNKNOWN_SOURCE = 'unknown'

export function buildAuthUrl(redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: SCOPES.join(' '),
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<{
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
  }>
}

async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`)
  }
  return res.json() as Promise<{ access_token: string; expires_in: number }>
}

// Refreshes and persists first if the stored token has expired or is close to
// it. Called before every query window rather than once per data type, so a
// long backfill cannot outlive its own token.
export async function getValidAccessToken(): Promise<string> {
  const account = await prisma.googleAccount.findFirst({
    orderBy: { createdAt: 'desc' },
  })
  if (!account) throw new Error('No connected Google account')

  const expiresSoon = account.expiresAt.getTime() - Date.now() < 60_000
  if (!expiresSoon) return account.accessToken

  const refreshed = await refreshAccessToken(account.refreshToken)
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000)
  await prisma.googleAccount.update({
    where: { id: account.id },
    data: { accessToken: refreshed.access_token, expiresAt },
  })
  return refreshed.access_token
}

interface DataPointsResponse {
  dataPoints?: Array<Record<string, any>>
  nextPageToken?: string
}

// The filter query language varies by data type. Each line below was confirmed
// against the live API rather than taken from the docs.
//   Daily          {type}.date, plain YYYY-MM-DD, both bounds
//   Interval       {type}.interval.start_time, UTC with a Z suffix
//   Civil session  same field, civil_start_time, local with no Z
//   ECG            lower bound only, the API rejects an end time
//   Sample         {type}.sample_time.physical_time
const DAILY_TYPES = new Set([
  'daily-heart-rate-variability',
  'daily-heart-rate-zones',
  'daily-oxygen-saturation',
  'daily-respiratory-rate',
  'daily-resting-heart-rate',
  'daily-sleep-temperature-derivations',
  'daily-vo2-max',
])

const INTERVAL_TYPES = new Set([
  'active-energy-burned',
  'active-minutes',
  'active-zone-minutes',
  'activity-level',
  'altitude',
  'distance',
  'sedentary-period',
  'steps',
  'swim-lengths-data',
  'time-in-heart-rate-zone',
  'irregular-rhythm-notification',
])

const CIVIL_SESSION_TYPES = new Set(['sleep', 'exercise', 'hydration-log'])

// These have no list endpoint. Google directs you to the rollup API, which is
// not implemented here, so calling them spends a request to get the same error
// every sync.
const NO_LIST_ENDPOINT = new Set(['floors', 'calories-in-heart-rate-zone', 'total-calories'])

export const SYNCABLE_DATA_TYPES = DATA_TYPES.filter((t) => !NO_LIST_ENDPOINT.has(t))

function buildFilter(dataType: DataType, start: Date, end: Date) {
  const snake = dataType.replace(/-/g, '_')

  if (DAILY_TYPES.has(dataType)) {
    const field = `${snake}.date`
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    return `${field} >= "${fmt(start)}" AND ${field} < "${fmt(end)}"`
  }

  if (dataType === 'electrocardiogram') {
    return `${snake}.interval.start_time >= "${start.toISOString()}"`
  }

  if (CIVIL_SESSION_TYPES.has(dataType)) {
    // Sleep filters on when the session ends, the morning it belongs to, not
    // when it starts. Confirmed against the live API.
    const member = dataType === 'sleep' ? 'civil_end_time' : 'civil_start_time'
    const field = `${snake}.interval.${member}`
    const fmt = (d: Date) => d.toISOString().slice(0, 19)
    return `${field} >= "${fmt(start)}" AND ${field} < "${fmt(end)}"`
  }

  const field = INTERVAL_TYPES.has(dataType)
    ? `${snake}.interval.start_time`
    : `${snake}.sample_time.physical_time`
  return `${field} >= "${start.toISOString()}" AND ${field} < "${end.toISOString()}"`
}

async function fetchDataPointsPage(
  accessToken: string,
  dataType: DataType,
  startTime: Date,
  endTime: Date,
  pageToken?: string
): Promise<DataPointsResponse> {
  const params = new URLSearchParams({
    filter: buildFilter(dataType, startTime, endTime),
    pageSize: String(PAGE_SIZE),
  })
  if (pageToken) params.set('pageToken', pageToken)

  const res = await fetch(
    `${API_BASE}/users/me/dataTypes/${dataType}/dataPoints?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) {
    throw new Error(`Fetch ${dataType} failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

function toCamelCase(kebab: string) {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function dateFromParts(d?: { year: number; month: number; day: number }) {
  if (!d) return undefined
  return new Date(Date.UTC(d.year, d.month - 1, d.day))
}

function durationMinutes(interval?: { startTime?: string; endTime?: string }) {
  if (!interval?.startTime || !interval?.endTime) return undefined
  return (new Date(interval.endTime).getTime() - new Date(interval.startTime).getTime()) / 60_000
}

function sumActiveMinutes(byLevel?: Array<{ activeMinutes?: string }>) {
  if (!byLevel?.length) return undefined
  let sum = 0
  for (const entry of byLevel) {
    const n = Number(entry.activeMinutes ?? 0)
    if (!Number.isFinite(n)) return undefined
    sum += n
  }
  return sum
}

// Returns undefined rather than NaN for anything unparseable, so a bad field
// never reaches a Float column where it would poison every later average.
const num = (v: unknown) => {
  if (v == null) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// Field names are not consistent across types. Distance reports millimeters
// while height reports heightMillimeters. Each entry was read off a real
// payload. Types with no confirmed shape fall through to the guess below.
const VALUE_EXTRACTORS: Partial<Record<DataType, (body: any) => { value?: number; unit?: string }>> = {
  'heart-rate': (b) => ({ value: num(b.beatsPerMinute), unit: 'bpm' }),
  'daily-resting-heart-rate': (b) => ({ value: num(b.beatsPerMinute), unit: 'bpm' }),
  'heart-rate-variability': (b) => ({
    value: num(b.rootMeanSquareOfSuccessiveDifferencesMilliseconds),
    unit: 'ms',
  }),
  'daily-heart-rate-variability': (b) => ({
    value: num(b.rootMeanSquareOfSuccessiveDifferencesMilliseconds),
    unit: 'ms',
  }),
  'oxygen-saturation': (b) => ({ value: num(b.percentage), unit: '%' }),
  'daily-oxygen-saturation': (b) => ({ value: num(b.percentage), unit: '%' }),
  steps: (b) => ({ value: num(b.count), unit: 'steps' }),
  distance: (b) => {
    const mm = num(b.millimeters)
    return { value: mm == null ? undefined : mm / 1000, unit: 'm' }
  },
  height: (b) => {
    const mm = num(b.heightMillimeters)
    return { value: mm == null ? undefined : mm / 1000, unit: 'm' }
  },
  weight: (b) => ({ value: num(b.weightKilograms ?? b.kilograms), unit: 'kg' }),
  'body-fat': (b) => ({ value: num(b.percentage), unit: '%' }),
  'active-energy-burned': (b) => ({ value: num(b.kcal), unit: 'kcal' }),
  'active-minutes': (b) => ({ value: sumActiveMinutes(b.activeMinutesByActivityLevel), unit: 'min' }),
  'active-zone-minutes': (b) => ({ value: num(b.activeZoneMinutes), unit: 'min' }),
  'sedentary-period': (b) => ({ value: num(durationMinutes(b.interval)), unit: 'min' }),
  'time-in-heart-rate-zone': (b) => ({ value: num(durationMinutes(b.interval)), unit: 'min' }),
  'swim-lengths-data': (b) => ({ value: num(b.strokeCount), unit: 'strokes' }),
  sleep: (b) => ({ value: num(b.summary?.minutesAsleep), unit: 'min' }),
  exercise: (b) => ({ value: num(b.metricsSummary?.caloriesKcal), unit: 'kcal' }),
}

function extractValue(dataType: DataType, body: Record<string, any>) {
  const known = VALUE_EXTRACTORS[dataType]?.(body)
  if (known?.value != null) return known

  if (body.beatsPerMinute != null) return { value: num(body.beatsPerMinute), unit: 'bpm' }
  if (body.count != null) return { value: num(body.count), unit: 'count' }
  if (body.kilograms != null) return { value: num(body.kilograms), unit: 'kg' }
  if (body.percentage != null) return { value: num(body.percentage), unit: '%' }
  if (body.meters != null) return { value: num(body.meters), unit: 'm' }
  return { value: undefined, unit: undefined }
}

function validDate(input: string | Date | undefined): Date | undefined {
  if (!input) return undefined
  const d = input instanceof Date ? input : new Date(input)
  return Number.isNaN(d.getTime()) ? undefined : d
}

interface ExtractedPoint {
  dataType: string
  startTime: Date
  endTime: Date | null
  value: number | null
  unit: string | null
  source: string
  raw: Record<string, any>
}

// Returns null rather than a row stamped with the current time when a payload
// carries no usable timestamp. A fabricated timestamp lands in today's totals
// and is indistinguishable from a real reading afterwards.
function extractPoint(dataType: DataType, point: Record<string, any>): ExtractedPoint | null {
  const body = point[toCamelCase(dataType)] ?? {}

  const startTime = validDate(
    body.interval?.startTime ??
      body.sampleTime?.physicalTime ??
      dateFromParts(body.date) ??
      point.interval?.startTime ??
      point.startTime
  )
  if (!startTime) return null

  const endTime = validDate(body.interval?.endTime ?? point.interval?.endTime ?? point.endTime)
  const { value, unit } = extractValue(dataType, body)

  return {
    dataType,
    startTime,
    endTime: endTime ?? null,
    value: value != null && Number.isFinite(value) ? value : null,
    unit: unit ?? null,
    source: point.dataSource?.platform ?? UNKNOWN_SOURCE,
    raw: point,
  }
}

// Rows written before source was normalised carry NULL and are invisible to
// the unique constraint. One idempotent pass brings the history into line so
// the constraint covers old rows as well as new ones.
let legacyBackfillDone = false

async function backfillLegacySources() {
  if (legacyBackfillDone) return
  await prisma.$executeRawUnsafe(
    `UPDATE "DataPoint" SET "source" = $1 WHERE "source" IS NULL`,
    UNKNOWN_SOURCE
  )
  legacyBackfillDone = true
}

export interface SyncResult {
  written: number
  skipped: number
}

export async function syncDataType(dataType: DataType, since: Date): Promise<SyncResult> {
  if (NO_LIST_ENDPOINT.has(dataType)) {
    throw new Error(`${dataType} has no list endpoint, it needs the rollup API`)
  }

  await backfillLegacySources()

  const now = new Date()
  let windowStart = since
  let written = 0
  let skipped = 0

  while (windowStart < now) {
    const windowEnd = new Date(
      Math.min(windowStart.getTime() + MAX_QUERY_DAYS * 86_400_000, now.getTime())
    )
    const accessToken = await getValidAccessToken()

    let pageToken: string | undefined
    do {
      const page = await fetchDataPointsPage(accessToken, dataType, windowStart, windowEnd, pageToken)

      // Deduplicated on the unique key before writing, because a page can
      // carry the same reading twice and the batch insert would reject the
      // whole statement.
      const batch = new Map<string, ExtractedPoint>()
      for (const point of page.dataPoints ?? []) {
        const row = extractPoint(dataType, point)
        if (!row) {
          skipped++
          continue
        }
        batch.set(`${row.startTime.toISOString()}|${row.source}`, row)
      }

      const rows = Array.from(batch.values())
      for (let i = 0; i < rows.length; i += WRITE_BATCH) {
        const result = await prisma.dataPoint.createMany({
          data: rows.slice(i, i + WRITE_BATCH),
          skipDuplicates: true,
        })
        written += result.count
      }

      pageToken = page.nextPageToken || undefined
    } while (pageToken)

    windowStart = windowEnd
  }

  await prisma.syncState.upsert({
    where: { dataType },
    create: { dataType, lastSyncedAt: now },
    update: { lastSyncedAt: now },
  })

  return { written, skipped }
}

export type SyncReport = Record<string, SyncResult | { error: string }>

export async function syncAllDataTypes(defaultSince: Date): Promise<SyncReport> {
  const results: SyncReport = {}
  for (const dataType of SYNCABLE_DATA_TYPES) {
    const state = await prisma.syncState.findUnique({ where: { dataType } })
    const since = state?.lastSyncedAt ?? defaultSince
    try {
      results[dataType] = await syncDataType(dataType, since)
    } catch (err) {
      results[dataType] = { error: err instanceof Error ? err.message : String(err) }
    }
  }
  return results
}
