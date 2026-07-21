import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, AUTH_COOKIE_OPTIONS, absoluteUrl, isAuthConfigured, isValidPassword, makeSessionToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.redirect(absoluteUrl('/login'))
  }

  const form = await req.formData()
  const password = String(form.get('password') ?? '')
  const next = String(form.get('next') ?? '/')
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'

  if (!(await isValidPassword(password))) {
    return NextResponse.redirect(absoluteUrl('/login', { next: safeNext, error: '1' }))
  }

  const res = NextResponse.redirect(absoluteUrl(safeNext))
  res.cookies.set(AUTH_COOKIE, await makeSessionToken(), AUTH_COOKIE_OPTIONS)
  return res
}
