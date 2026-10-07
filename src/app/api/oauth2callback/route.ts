import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens } from '@/lib/googleHealth'
import { prisma } from '@/lib/prisma'
import { OAUTH_STATE_COOKIE, constantTimeEquals } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const base = process.env.NEXT_PUBLIC_BASE_URL
  if (!base) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_BASE_URL is not set' }, { status: 500 })
  }

  const fail = (reason: string) => {
    const res = NextResponse.redirect(`${base}/?error=${encodeURIComponent(reason)}`)
    res.cookies.delete(OAUTH_STATE_COOKIE)
    return res
  }

  const error = req.nextUrl.searchParams.get('error')
  if (error) return fail(error)

  const code = req.nextUrl.searchParams.get('code')
  if (!code) return fail('missing_code')

  const returnedState = req.nextUrl.searchParams.get('state')
  const expectedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value
  if (!returnedState || !expectedState || !constantTimeEquals(returnedState, expectedState)) {
    return fail('state_mismatch')
  }

  const tokens = await exchangeCodeForTokens(code, `${base}/api/oauth2callback`)

  // Google only returns a refresh token on the first consent for a given
  // client. On a re-consent the field is absent, and writing undefined over
  // the stored one silently breaks every sync after the access token expires.
  const existing = await prisma.googleAccount.findFirst({ orderBy: { createdAt: 'desc' } })
  const refreshToken = tokens.refresh_token ?? existing?.refreshToken
  if (!refreshToken) return fail('no_refresh_token')

  await prisma.googleAccount.deleteMany()
  await prisma.googleAccount.create({
    data: {
      accessToken: tokens.access_token,
      refreshToken,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope,
    },
  })

  const res = NextResponse.redirect(`${base}/?connected=1`)
  res.cookies.delete(OAUTH_STATE_COOKIE)
  return res
}
