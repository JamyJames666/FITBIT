import { NextRequest, NextResponse } from 'next/server'
import {
  AUTH_COOKIE,
  AUTH_COOKIE_OPTIONS,
  absoluteUrl,
  clientKey,
  isAuthConfigured,
  isValidPassword,
  makeSessionToken,
  rateLimit,
} from '@/lib/auth'

function backToLogin(next: string, error?: string) {
  const params: Record<string, string> = { next }
  if (error) params.error = error
  return NextResponse.redirect(absoluteUrl('/login', params), { status: 303 })
}

export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) return backToLogin('/')

  const form = await req.formData()
  const password = String(form.get('password') ?? '')
  const next = String(form.get('next') ?? '/')

  // Anything that is not a single-slash relative path is discarded, so the
  // redirect cannot be pointed at another origin.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'

  const limit = rateLimit(clientKey(req.headers))
  if (!limit.allowed) return backToLogin(safeNext, 'rate')

  if (!(await isValidPassword(password))) return backToLogin(safeNext, '1')

  const res = NextResponse.redirect(absoluteUrl(safeNext), { status: 303 })
  res.cookies.set(AUTH_COOKIE, await makeSessionToken(), AUTH_COOKIE_OPTIONS)
  return res
}
