import { createHmac, timingSafeEqual } from 'crypto'

export const AUTH_COOKIE = 'ht_auth'
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60 // 30 days

// Both must be set (APP_PASSWORD is the shared password, SESSION_SECRET signs
// the cookie) — checked up front so a missing env var fails closed with a
// clear message instead of throwing mid-request on every page load.
export function isAuthConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD && process.env.SESSION_SECRET)
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set')
  return secret
}

// A deterministic HMAC of a fixed label, not a random per-login token — this
// is a single shared-password gate (one owner, no per-user accounts), so
// there's no session state to look up. Anyone who steals the cookie value
// can replay it until it's rotated by changing SESSION_SECRET.
export function makeSessionToken() {
  return createHmac('sha256', sessionSecret()).update('authenticated').digest('hex')
}

export function isValidSessionToken(token: string | undefined): boolean {
  if (!token) return false
  const expected = Buffer.from(makeSessionToken())
  const actual = Buffer.from(token)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function isValidPassword(candidate: string): boolean {
  const expected = process.env.APP_PASSWORD
  if (!expected) return false
  const expectedHash = createHmac('sha256', sessionSecret()).update(expected).digest()
  const candidateHash = createHmac('sha256', sessionSecret()).update(candidate).digest()
  return timingSafeEqual(expectedHash, candidateHash)
}

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: COOKIE_MAX_AGE_SECONDS,
}
