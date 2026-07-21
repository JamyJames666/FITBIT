import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, absoluteUrl, isAuthConfigured, isValidSessionToken } from '@/lib/auth'

export async function middleware(req: NextRequest) {
  // Fail closed (never serve real content) but without crashing — the login
  // page itself explains that APP_PASSWORD/SESSION_SECRET need setting.
  if (!isAuthConfigured()) {
    return NextResponse.redirect(absoluteUrl('/login'))
  }

  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (await isValidSessionToken(token)) return NextResponse.next()

  return NextResponse.redirect(absoluteUrl('/login', { next: req.nextUrl.pathname }))
}

export const config = {
  matcher: ['/((?!login|api/auth/login|_next/static|_next/image|favicon.ico).*)'],
}
