import { prisma } from '@/lib/prisma'
import HeartRateChart from '@/components/HeartRateChart'
import SyncButton from '@/components/SyncButton'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const account = await prisma.googleAccount.findFirst({ orderBy: { createdAt: 'desc' } })

  const counts = account
    ? await prisma.dataPoint.groupBy({
        by: ['dataType'],
        _count: { _all: true },
        orderBy: { dataType: 'asc' },
      })
    : []

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
          <HeartRateChart hours={24} />

          <div className="card">
            <h3 className="card-title">Synced data points</h3>
            {counts.length === 0 ? (
              <p className="card-empty">No data synced yet — click &quot;Sync now&quot; above.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13 }}>
                {counts.map((c) => (
                  <li
                    key={c.dataType}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '4px 0',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span>{c.dataType}</span>
                    <span>{c._count._all}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </main>
  )
}
