import { prisma } from '@/lib/prisma'
import SyncButton from '@/components/SyncButton'
import SummaryStats from '@/components/SummaryStats'
import TrendChart from '@/components/TrendChart'
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
          <div className="chart-grid">
            <TrendChart dataType="heart-rate" title="Heart rate" unit="bpm" hours={24} chartType="line" seriesSlot={1} />
            <TrendChart dataType="steps" title="Steps" unit="steps" hours={24} chartType="bar" seriesSlot={2} />
            <TrendChart dataType="distance" title="Distance" unit="m" hours={24} chartType="bar" seriesSlot={3} />
            <TrendChart
              dataType="active-energy-burned"
              title="Calories burned"
              unit="kcal"
              hours={24}
              chartType="bar"
              seriesSlot={4}
            />
            <TrendChart
              dataType="active-minutes"
              title="Active minutes"
              unit="min"
              hours={72}
              chartType="bar"
              seriesSlot={5}
            />
            <TrendChart
              dataType="heart-rate-variability"
              title="Heart rate variability"
              unit="ms"
              hours={168}
              chartType="line"
              seriesSlot={6}
            />
            <TrendChart
              dataType="oxygen-saturation"
              title="Blood oxygen (SpO2)"
              unit="%"
              hours={72}
              chartType="line"
              seriesSlot={7}
            />
            <TrendChart
              dataType="daily-resting-heart-rate"
              title="Resting heart rate"
              unit="bpm"
              hours={720}
              chartType="line"
              seriesSlot={8}
            />
            <TrendChart dataType="sleep" title="Sleep (minutes asleep)" unit="min" hours={336} chartType="bar" seriesSlot={1} />
          </div>

          <h2 className="section-title">Explore raw data</h2>
          <DataExplorer />
        </>
      )}
    </main>
  )
}
