import { NextRequest, NextResponse } from 'next/server'
import { buildInsights } from '@/lib/ml'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEFAULT_WINDOW_DAYS = 90
const MIN_WINDOW_DAYS = 28
const MAX_WINDOW_DAYS = 730

// Every model runs server side on each request. The whole stack is a few
// passes over at most two years of daily rows, so there is nothing to cache
// yet. If the window ever grows past that, this is where a cache belongs.
export async function GET(req: NextRequest) {
  const raw = Number(req.nextUrl.searchParams.get('days'))
  const windowDays = Number.isFinite(raw)
    ? Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.trunc(raw)))
    : DEFAULT_WINDOW_DAYS

  try {
    return NextResponse.json(await buildInsights(windowDays))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
