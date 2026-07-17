import { prisma } from '@/lib/prisma'
import SyncButton from '@/components/SyncButton'
import SummaryStats from '@/components/SummaryStats'
import TrendsSection from '@/components/TrendsSection'
import DataExplorer from '@/components/DataExplorer'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const account = await prisma.googleAccount.findFirst({ orderBy: { createdAt: 'desc' } })

  return (
    <main className="page">
      <div className="status-row">
        <h1 style={{ fontSize: 20, margin: 0 }}>Health Tracker</h1>
        {account ? <SyncButton /> : <a className="btn" href="/api/auth/connect">Connect Google account</a>}
      </div>

      {!account && (
        <p className="muted">
          Connect your Google account (linked to your Fitbit Air) to start pulling heart rate and
          other health data.
        </p>
      )}

      {account && (
        <>
          <h2 className="section-title">Today</h2>
          <SummaryStats />

          <h2 className="section-title">Trends</h2>
          <TrendsSection />

          <h2 className="section-title">Explore raw data</h2>
          <DataExplorer />
        </>
      )}
    </main>
  )
}
