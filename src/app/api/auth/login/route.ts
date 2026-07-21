import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, AUTH_COOKIE_OPTIONS, isValidPassword, makeSessionToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const password = String(form.get('password') ?? '')
  const next = String(form.get('next') ?? '/')
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'

  if (!isValidPassword(password)) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', safeNext)
    url.searchParams.set('error', '1')
    return NextResponse.redirect(url)
  }

  const url = req.nextUrl.clone()
  url.pathname = safeNext
  url.search = ''
  const res = NextResponse.redirect(url)
  res.cookies.set(AUTH_COOKIE, makeSessionToken(), AUTH_COOKIE_OPTIONS)
  return res
}
