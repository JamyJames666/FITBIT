'use client'

import { useEffect, useState } from 'react'
import { DATA_TYPES } from '@/lib/dataTypes'

const PAGE_SIZE = 25

interface Row {
  startTime: string
  endTime: string | null
  value: number | null
  unit: string | null
  source: string | null
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export default function DataExplorer() {
  const [dataType, setDataType] = useState<string>('heart-rate')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    setPage(0)
  }, [dataType])

  useEffect(() => {
    let cancelled = false
    setRows(null)
    fetch(`/api/data-points?dataType=${dataType}&limit=${PAGE_SIZE}&page=${page}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setRows(d.points)
        setTotal(d.total)
      })
    return () => {
      cancelled = true
    }
  }, [dataType, page])

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  return (
    <div className="card">
      <h3 className="card-title">Data explorer</h3>
      <div className="explorer-controls">
        <select value={dataType} onChange={(e) => setDataType(e.target.value)}>
          {DATA_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="muted">{total.toLocaleString()} rows</span>
      </div>

      {!rows ? (
        <div className="card-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card-empty">No data for this type yet.</div>
      ) : (
        <>
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Start</th>
                  <th>End</th>
                  <th>Value</th>
                  <th>Unit</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{formatTime(r.startTime)}</td>
                    <td>{r.endTime ? formatTime(r.endTime) : '—'}</td>
                    <td>{r.value != null ? r.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</td>
                    <td>{r.unit ?? '—'}</td>
                    <td>{r.source ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </button>
            <span>
              Page {page + 1} of {maxPage + 1}
            </span>
            <button disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  )
}
