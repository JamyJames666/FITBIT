import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, AUTH_COOKIE_OPTIONS, isAuthConfigured, isValidPassword, makeSessionToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  const form = await req.formData()
  const password = String(form.get('password') ?? '')
  const next = String(form.get('next') ?? '/')
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'

  if (!(await isValidPassword(password))) {
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
  res.cookies.set(AUTH_COOKIE, await makeSessionToken(), AUTH_COOKIE_OPTIONS)
  return res
}
