import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens } from '@/lib/googleHealth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const error = req.nextUrl.searchParams.get('error')
  const base = process.env.NEXT_PUBLIC_BASE_URL!

  if (error) {
    return NextResponse.redirect(`${base}/?error=${encodeURIComponent(error)}`)
  }
  if (!code) {
    return NextResponse.redirect(`${base}/?error=missing_code`)
  }

  const redirectUri = `${base}/api/oauth2callback`
  const tokens = await exchangeCodeForTokens(code, redirectUri)

  // Single-user app: wipe any previous account and store the new one.
  await prisma.googleAccount.deleteMany()
  await prisma.googleAccount.create({
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope,
    },
  })

  return NextResponse.redirect(`${base}/?connected=1`)
}
