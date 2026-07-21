import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, isAuthConfigured, isValidSessionToken } from '@/lib/auth'

export async function middleware(req: NextRequest) {
  // Fail closed (never serve real content) but without crashing — the login
  // page itself explains that APP_PASSWORD/SESSION_SECRET need setting.
  if (!isAuthConfigured()) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (await isValidSessionToken(token)) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  url.searchParams.set('next', req.nextUrl.pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!login|api/auth/login|_next/static|_next/image|favicon.ico).*)'],
}
