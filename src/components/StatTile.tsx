import type { CSSProperties } from 'react'

function formatValue(value: number, unit: string) {
  if (unit === 'min') {
    const h = Math.floor(value / 60)
    const m = Math.round(value % 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1)
}

export default function StatTile({
  label,
  value,
  unit,
  accent,
}: {
  label: string
  value: number | null
  unit: string
  accent?: string
}) {
  return (
    <div className="stat-tile" style={accent ? ({ '--tile-accent': accent } as CSSProperties) : undefined}>
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-value">
        {value == null ? (
          <span className="stat-tile-empty">—</span>
        ) : (
          <>
            {formatValue(value, unit)}
            {unit !== 'min' && <span className="unit">{unit}</span>}
          </>
        )}
      </div>
    </div>
  )
}
