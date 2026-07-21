import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, isValidSessionToken } from '@/lib/auth'

export function middleware(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (isValidSessionToken(token)) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  url.searchParams.set('next', req.nextUrl.pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!login|api/auth/login|_next/static|_next/image|favicon.ico).*)'],
}
