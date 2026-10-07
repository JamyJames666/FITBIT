import { prisma } from '@/lib/prisma'
import DashboardClient from '@/components/DashboardClient'
import ThemeToggle from '@/components/ThemeToggle'

export const dynamic = 'force-dynamic'

const ERROR_COPY: Record<string, string> = {
  state_mismatch: 'That sign-in did not start here, so it was rejected. Try connecting again.',
  no_refresh_token: 'Google did not return a refresh token. Revoke the app in your Google account and connect again.',
  missing_code: 'Google sent you back without an authorisation code. Try connecting again.',
  access_denied: 'You declined the permissions, so nothing was connected.',
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  // Seeded demo data has no Google account behind it, and a database with
  // readings in it should show them rather than a connect prompt.
  const [account, points] = await Promise.all([
    prisma.googleAccount.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.dataPoint.count(),
  ])

  if (account || points > 0) return <DashboardClient connected={Boolean(account)} />

  const error = searchParams.error
  const message = error ? (ERROR_COPY[error] ?? `Connecting failed: ${error}`) : null

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="wordmark">
          Pulse Engine
          <span className="wordmark-tag">health signals in, decisions out</span>
        </h1>
        <div className="masthead-actions">
          <ThemeToggle />
        </div>
      </header>

      <main className="connect">
        <h2 className="connect-title">Nothing is connected yet.</h2>
        <p className="connect-body">
          Link the Google account your wearable syncs to. Pulse Engine reads it, keeps every reading
          permanently, and runs its models over whatever history builds up.
        </p>
        {message && <p className="card-error" style={{ marginBottom: 20 }}>{message}</p>}
        <a className="btn" href="/api/auth/connect">
          Connect Google account
        </a>
      </main>
    </div>
  )
}
