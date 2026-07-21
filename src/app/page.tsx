import { prisma } from '@/lib/prisma'
import DashboardClient from '@/components/DashboardClient'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const account = await prisma.googleAccount.findFirst({ orderBy: { createdAt: 'desc' } })

  return (
    <main className="page">
      {!account && (
        <>
          <div className="status-row">
            <h1 style={{ fontSize: 20, margin: 0 }}>Health Tracker</h1>
            <a className="btn" href="/api/auth/connect">Connect Google account</a>
          </div>
          <p className="muted">
            Connect your Google account (linked to your Fitbit Air) to start pulling heart rate and
            other health data.
          </p>
        </>
      )}

      {account && <DashboardClient />}
    </main>
  )
}
