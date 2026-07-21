import { NextResponse } from 'next/server'
import { AUTH_COOKIE, absoluteUrl } from '@/lib/auth'

export async function POST() {
  const res = NextResponse.redirect(absoluteUrl('/login'))
  res.cookies.delete(AUTH_COOKIE)
  return res
}
