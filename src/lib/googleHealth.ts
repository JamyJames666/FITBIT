import { prisma } from './prisma'

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

// Every Google Health API data type we pull. maxQueryDays caps how wide a
// single startTime/endTime window can be per request (Google enforces this
// server-side; heart-rate is documented at 14 days, everything else uses
// the same conservative default until proven otherwise).
export const DATA_TYPES = [
  'active-energy-burned',
  'active-minutes',
  'active-zone-minutes',
  'activity-level',
  'altitude',
  'blood-glucose',
  'body-fat',
  'calories-in-heart-rate-zone',
  'core-body-temperature',
  'daily-heart-rate-variability',
  'daily-heart-rate-zones',
  'daily-oxygen-saturation',
  'daily-respiratory-rate',
  'daily-resting-heart-rate',
  'daily-sleep-temperature-derivations',
  'daily-vo2-max',
  'distance',
  'electrocardiogram',
  'exercise',
  'floors',
  'food',
  'food-measurement-unit',
  'heart-rate',
  'heart-rate-variability',
  'height',
  'hydration-log',
  'irregular-rhythm-notification',
  'nutrition-log',
  'oxygen-saturation',
  'respiratory-rate-sleep-summary',
  'run-vo2-max',
  'sedentary-period',
  'sleep',
  'steps',
  'swim-lengths-data',
  'time-in-heart-rate-zone',
  'total-calories',
  'vo2-max',
  'weight',
] as const

export type DataType = (typeof DATA_TYPES)[number]

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

// The `filter` query language's field path depends on the data type's
// record type — Sample/Food use sample_time, Interval/Session use
// interval.start_time, Daily uses a plain date. Only >= and < are supported.
const DAILY_TYPES = new Set([
  'daily-heart-rate-variability',
  'daily-heart-rate-zones',
  'daily-oxygen-saturation',
  'daily-respiratory-rate',
  'daily-resting-heart-rate',
  'daily-sleep-temperature-derivations',
  'daily-vo2-max',
])

const INTERVAL_OR_SESSION_TYPES = new Set([
  'active-energy-burned',
  'active-minutes',
  'active-zone-minutes',
  'activity-level',
  'altitude',
  'calories-in-heart-rate-zone',
  'distance',
  'floors',
  'sedentary-period',
  'steps',
  'swim-lengths-data',
  'time-in-heart-rate-zone',
  'total-calories',
  'electrocardiogram',
  'exercise',
  'hydration-log',
  'irregular-rhythm-notification',
  'sleep',
])

function buildFilter(dataType: DataType, start: Date, end: Date) {
  const snake = dataType.replace(/-/g, '_')

  if (DAILY_TYPES.has(dataType)) {
    const field = `${snake}.date`
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    return `${field} >= "${fmt(start)}" AND ${field} < "${fmt(end)}"`
  }

  const field = INTERVAL_OR_SESSION_TYPES.has(dataType)
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

// Best-effort extraction so every data type is chartable without a bespoke
// mapping for each of the 38 shapes. Falls back to the raw payload only.
function extractFields(dataType: DataType, point: Record<string, any>) {
  const startTime: string | undefined =
    point.interval?.startTime ??
    point[toCamelCase(dataType)]?.sampleTime?.physicalTime ??
    point.startTime ??
    point.date

  const endTime: string | undefined = point.interval?.endTime ?? point.endTime

  const body = point[toCamelCase(dataType)] ?? {}
  let value: number | undefined
  let unit: string | undefined

  if (typeof body.beatsPerMinute === 'string' || typeof body.beatsPerMinute === 'number') {
    value = Number(body.beatsPerMinute)
    unit = 'bpm'
  } else if (body.count != null) {
    value = Number(body.count)
    unit = 'count'
  } else if (body.kilograms != null) {
    value = Number(body.kilograms)
    unit = 'kg'
  } else if (body.percentage != null) {
    value = Number(body.percentage)
    unit = 'percent'
  } else if (body.meters != null) {
    value = Number(body.meters)
    unit = 'm'
  }

  return {
    startTime: startTime ? new Date(startTime) : new Date(),
    endTime: endTime ? new Date(endTime) : undefined,
    value,
    unit,
    source: point.dataSource?.platform,
  }
}

function toCamelCase(kebab: string) {
  return kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
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
