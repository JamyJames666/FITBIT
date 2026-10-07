function formatValue(value: number, unit: string): string {
  if (unit === 'min') {
    const h = Math.floor(value / 60)
    const m = Math.round(value % 60)
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
  }
  if (value >= 1000) return value.toLocaleString('en-GB', { maximumFractionDigits: 0 })
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1)
}

export default function StatTile({
  label,
  value,
  unit,
}: {
  label: string
  value: number | null
  unit: string
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        {value == null ? (
          <span className="stat-empty">No data</span>
        ) : (
          <>
            {formatValue(value, unit)}
            {unit !== 'min' && <span className="stat-unit">{unit}</span>}
          </>
        )}
      </div>
    </div>
  )
}
