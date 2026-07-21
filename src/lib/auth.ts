// Middleware runs on the Edge Runtime by default, which does not support
// Node's 'crypto' module (confirmed by a real build warning when this used
// createHmac/timingSafeEqual from 'crypto') — only the standard Web Crypto
// API (globalThis.crypto.subtle) works in both Edge and Node, so everything
// here is built on that instead.

export const AUTH_COOKIE = 'ht_auth'
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60 // 30 days

// Both must be set (APP_PASSWORD is the shared password, SESSION_SECRET signs
// the cookie) — checked up front so a missing env var fails closed with a
// clear message instead of throwing mid-request on every page load.
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

// Constant-time comparison of two equal-length hex digests — there's no
// Web Crypto equivalent of Node's timingSafeEqual, so this does it by hand.
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// A deterministic HMAC of a fixed label, not a random per-login token — this
// is a single shared-password gate (one owner, no per-user accounts), so
// there's no session state to look up. Anyone who steals the cookie value
// can replay it until it's rotated by changing SESSION_SECRET.
export async function makeSessionToken(): Promise<string> {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is not set')
  return hmacHex(secret, 'authenticated')
}

export async function isValidSessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false
  const expected = await makeSessionToken()
  return timingSafeEqualStr(expected, token)
}

export async function isValidPassword(candidate: string): Promise<boolean> {
  const secret = process.env.SESSION_SECRET
  const expected = process.env.APP_PASSWORD
  if (!secret || !expected) return false
  const [expectedHash, candidateHash] = await Promise.all([hmacHex(secret, expected), hmacHex(secret, candidate)])
  return timingSafeEqualStr(expectedHash, candidateHash)
}

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: COOKIE_MAX_AGE_SECONDS,
}
