import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { buildAuthUrl } from '@/lib/googleHealth'

export async function GET() {
  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/oauth2callback`
  const state = randomBytes(16).toString('hex')
  const url = buildAuthUrl(redirectUri, state)
  return NextResponse.redirect(url)
}
