import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { buildAuthUrl } from '@/lib/googleHealth'
import { OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_OPTIONS } from '@/lib/auth'

export async function GET() {
  const base = process.env.NEXT_PUBLIC_BASE_URL
  if (!base) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_BASE_URL is not set' }, { status: 500 })
  }

  // The state is held in an httpOnly cookie and compared on the way back, so
  // a callback that did not start here is rejected. Generating it and never
  // checking it leaves the callback open to anyone who can make the browser
  // follow a link.
  const state = randomBytes(32).toString('hex')
  const res = NextResponse.redirect(buildAuthUrl(`${base}/api/oauth2callback`, state))
  res.cookies.set(OAUTH_STATE_COOKIE, state, OAUTH_STATE_COOKIE_OPTIONS)
  return res
}
