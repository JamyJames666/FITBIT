// Middleware runs on the Edge runtime, which has no Node crypto module. Only
// the Web Crypto API works in both Edge and Node, so everything here is built
// on globalThis.crypto.subtle.

export const AUTH_COOKIE = 'pe_auth'
export const OAUTH_STATE_COOKIE = 'pe_oauth_state'

const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60

// Behind Dokploy's Traefik proxy, req.nextUrl and req.url resolve to the
// container's internal bind address rather than the public domain, and a
// redirect built from either sends the browser to https://0.0.0.0:3000/.
// Every absolute redirect is anchored to NEXT_PUBLIC_BASE_URL instead.
export function absoluteUrl(pathname: string, params?: Record<string, string>): URL {
  const url = new URL(pathname, process.env.NEXT_PUBLIC_BASE_URL)
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url
}

// APP_PASSWORD is the shared password and SESSION_SECRET signs the cookie.
// Checked up front so a missing variable fails closed with a clear message
// instead of throwing on every page load.
export function isAuthConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD && process.env.SESSION_SECRET)
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return toHex(sig)
}

// Web Crypto has no equivalent of Node's timingSafeEqual, so the comparison is
// done by hand over every character rather than bailing at the first mismatch.
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// A deterministic HMAC of a fixed label rather than a random per-login token.
// This is one shared password with no user accounts, so there is no session to
// look up. Anyone holding the cookie can replay it until SESSION_SECRET is
// rotated.
export async function makeSessionToken(): Promise<string> {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set')
  return hmacHex(secret, 'authenticated')
}

export async function isValidSessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false
  return constantTimeEquals(await makeSessionToken(), token)
}

export async function isValidPassword(candidate: string): Promise<boolean> {
  const secret = process.env.SESSION_SECRET
  const expected = process.env.APP_PASSWORD
  if (!secret || !expected) return false
  const [expectedHash, candidateHash] = await Promise.all([
    hmacHex(secret, expected),
    hmacHex(secret, candidate),
  ])
  return constantTimeEquals(expectedHash, candidateHash)
}

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: COOKIE_MAX_AGE_SECONDS,
}

export const OAUTH_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
}

// A fixed-window counter per client address. In-process, so a redeploy resets
// it and instances don't share it. That's the right trade for a single-user
// app, because it turns an unlimited guessing rate into roughly ten tries a
// minute without adding Redis to the stack.
const ATTEMPT_WINDOW_MS = 60_000
const MAX_ATTEMPTS = 10
const attempts = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now()
  const entry = attempts.get(key)

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS })
    return { allowed: true, retryAfterSeconds: 0 }
  }

  entry.count++
  if (entry.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

export function clientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return headers.get('x-real-ip') ?? 'unknown'
}
