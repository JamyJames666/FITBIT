'use client'

import { useEffect, useState } from 'react'
import { DATA_TYPES } from '@/lib/dataTypes'
import Icon from './Icon'

const PAGE_SIZE = 25

interface Row {
  startTime: string
  endTime: string | null
  value: number | null
  unit: string | null
  source: string | null
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function DataExplorer() {
  const [dataType, setDataType] = useState('heart-rate')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPage(0)
  }, [dataType])

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setError(null)

    fetch(`/api/data-points?dataType=${dataType}&limit=${PAGE_SIZE}&page=${page}`)
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.error ?? `Request failed with ${r.status}`)
        return body
      })
      .then((d) => {
        if (cancelled) return
        setRows(d.points)
        setTotal(d.total)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setRows([])
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
    }
  }, [dataType, page])

  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  return (
    <div className="card">
      <h3 className="card-title">Every row, as stored</h3>
      <p className="card-note">
        The parsed value for each reading. The original API payload is kept alongside it in the
        database whether or not the parser recognised a value.
      </p>

      <div className="control-row" style={{ marginBottom: 14 }}>
        <select
          className="field"
          value={dataType}
          aria-label="Data type"
          onChange={(e) => setDataType(e.target.value)}
        >
          {DATA_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="hint">{total.toLocaleString('en-GB')} rows</span>
      </div>

      {!rows ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : error ? (
        <div className="card-empty card-error">Could not load this data type: {error}</div>
      ) : rows.length === 0 ? (
        <div className="card-empty">Nothing synced for this data type yet.</div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Start</th>
                  <th scope="col">End</th>
                  <th scope="col">Value</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.startTime}-${r.source}`}>
                    <td>{formatTime(r.startTime)}</td>
                    <td>{r.endTime ? formatTime(r.endTime) : 'None'}</td>
                    <td>
                      {r.value != null ? r.value.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : 'Unparsed'}
                    </td>
                    <td>{r.unit ?? 'None'}</td>
                    <td>{r.source ?? 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              type="button"
              className="chip"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <Icon name="left" size={13} />
              Previous
            </button>
            <span>
              Page {page + 1} of {maxPage + 1}
            </span>
            <button
              type="button"
              className="chip"
              disabled={page >= maxPage}
              onClick={() => setPage((p) => p + 1)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              Next
              <Icon name="right" size={13} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
