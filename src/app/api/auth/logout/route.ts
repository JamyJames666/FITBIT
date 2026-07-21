import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  const res = NextResponse.redirect(url)
  res.cookies.delete(AUTH_COOKIE)
  return res
}
