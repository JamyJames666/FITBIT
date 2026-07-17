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
    refresh_token: string
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

// Returns a valid access token for the single stored Google account,
// refreshing and persisting it first if it's expired or about to expire.
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

// The `filter` query language's field path/format is data-type-specific —
// confirmed against the live API rather than assumed, since the docs
// undersell how much this varies per type:
//   - Daily: `{type}.date`, plain YYYY-MM-DD, both bounds
//   - Interval (most Interval-record types): `{type}.interval.start_time`,
//     physical (UTC, "Z"-suffixed) time, both bounds
//   - Civil session (sleep/exercise/hydration-log): same field name but
//     `civil_start_time`, a LOCAL (no "Z") timestamp — using UTC-as-naive
//     here is an approximation, good enough for windowing
//   - ECG: only a lower bound is accepted at all ("filtering by end time is
//     not supported"), so it gets a single-clause filter
//   - Sample (point-in-time measurements): `{type}.sample_time.physical_time`
// A few types (floors, calories-in-heart-rate-zone, total-calories) don't
// support `list` at all — Google says to use `rollup`/`dailyRollup`
// instead — so they're expected to error here until that's implemented.
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
    // sleep filters by when the session ENDS (the morning it's attributed
    // to), not when it starts — confirmed against the live API.
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
    pageSize: '1000',
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
  if (!byLevel) return undefined
  return byLevel.reduce((sum, x) => sum + Number(x.activeMinutes ?? 0), 0)
}

const num = (v: unknown) => (v == null ? undefined : Number(v))

// Per-type value/unit extraction — confirmed against real payloads returned
// by the live API (field names are not consistent across types: e.g.
// distance uses `millimeters` but height uses `heightMillimeters`). Types
// without a confirmed shape (no data yet to inspect, e.g. weight/body-fat)
// fall through to the generic guess below.
const VALUE_EXTRACTORS: Partial<Record<DataType, (body: any) => { value?: number; unit?: string }>> = {
  'heart-rate': (b) => ({ value: num(b.beatsPerMinute), unit: 'bpm' }),
  'daily-resting-heart-rate': (b) => ({ value: num(b.beatsPerMinute), unit: 'bpm' }),
  'heart-rate-variability': (b) => ({ value: b.rootMeanSquareOfSuccessiveDifferencesMilliseconds, unit: 'ms' }),
  'daily-heart-rate-variability': (b) => ({ value: b.rootMeanSquareOfSuccessiveDifferencesMilliseconds, unit: 'ms' }),
  'oxygen-saturation': (b) => ({ value: b.percentage, unit: '%' }),
  'daily-oxygen-saturation': (b) => ({ value: b.percentage, unit: '%' }),
  steps: (b) => ({ value: num(b.count), unit: 'steps' }),
  distance: (b) => ({ value: b.millimeters != null ? num(b.millimeters)! / 1000 : undefined, unit: 'm' }),
  height: (b) => ({ value: b.heightMillimeters != null ? num(b.heightMillimeters)! / 1000 : undefined, unit: 'm' }),
  weight: (b) => ({ value: num(b.weightKilograms ?? b.kilograms), unit: 'kg' }),
  'body-fat': (b) => ({ value: b.percentage, unit: '%' }),
  'active-energy-burned': (b) => ({ value: b.kcal, unit: 'kcal' }),
  'active-minutes': (b) => ({ value: sumActiveMinutes(b.activeMinutesByActivityLevel), unit: 'min' }),
  'active-zone-minutes': (b) => ({ value: num(b.activeZoneMinutes), unit: 'min' }),
  'sedentary-period': (b) => ({ value: durationMinutes(b.interval), unit: 'min' }),
  'time-in-heart-rate-zone': (b) => ({ value: durationMinutes(b.interval), unit: 'min' }),
  'swim-lengths-data': (b) => ({ value: num(b.strokeCount), unit: 'strokes' }),
  sleep: (b) => ({ value: num(b.summary?.minutesAsleep), unit: 'min' }),
  exercise: (b) => ({ value: b.metricsSummary?.caloriesKcal, unit: 'kcal' }),
}

function extractValue(dataType: DataType, body: Record<string, any>) {
  const known = VALUE_EXTRACTORS[dataType]?.(body)
  if (known?.value != null) return known

  // Generic fallback guess for types with no confirmed shape yet.
  if (typeof body.beatsPerMinute === 'string' || typeof body.beatsPerMinute === 'number') {
    return { value: num(body.beatsPerMinute), unit: 'bpm' }
  }
  if (body.count != null) return { value: num(body.count), unit: 'count' }
  if (body.kilograms != null) return { value: num(body.kilograms), unit: 'kg' }
  if (body.percentage != null) return { value: num(body.percentage), unit: '%' }
  if (body.meters != null) return { value: num(body.meters), unit: 'm' }
  return { value: undefined, unit: undefined }
}

// Best-effort extraction so every data type is chartable without a bespoke
// mapping for each of the 38 shapes. Falls back to the raw payload only.
function extractFields(dataType: DataType, point: Record<string, any>) {
  const body = point[toCamelCase(dataType)] ?? {}

  const startTimeRaw: string | Date | undefined =
    body.interval?.startTime ??
    body.sampleTime?.physicalTime ??
    dateFromParts(body.date) ??
    point.interval?.startTime ??
    point.startTime

  const endTimeRaw: string | Date | undefined = body.interval?.endTime ?? point.interval?.endTime ?? point.endTime

  const { value, unit } = extractValue(dataType, body)

  return {
    startTime: startTimeRaw ? new Date(startTimeRaw) : new Date(),
    endTime: endTimeRaw ? new Date(endTimeRaw) : undefined,
    value,
    unit,
    source: point.dataSource?.platform,
  }
}

// Syncs one data type across [since, now) in <=14-day chunks, paginating
// each chunk, and upserts every point into the DataPoint table.
export async function syncDataType(dataType: DataType, since: Date) {
  const accessToken = await getValidAccessToken()
  const now = new Date()
  let windowStart = since
  let total = 0

  while (windowStart < now) {
    const windowEnd = new Date(
      Math.min(windowStart.getTime() + MAX_QUERY_DAYS * 86_400_000, now.getTime())
    )

    let pageToken: string | undefined
    do {
      const page = await fetchDataPointsPage(accessToken, dataType, windowStart, windowEnd, pageToken)
      for (const point of page.dataPoints ?? []) {
        const fields = extractFields(dataType, point)
        await prisma.dataPoint.upsert({
          where: {
            dataType_startTime_source: {
              dataType,
              startTime: fields.startTime,
              source: fields.source ?? '',
            },
          },
          create: { dataType, ...fields, source: fields.source ?? null, raw: point },
          update: { ...fields, source: fields.source ?? null, raw: point },
        })
        total++
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

  return total
}

export async function syncAllDataTypes(defaultSince: Date) {
  const results: Record<string, number | { error: string }> = {}
  for (const dataType of DATA_TYPES) {
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
