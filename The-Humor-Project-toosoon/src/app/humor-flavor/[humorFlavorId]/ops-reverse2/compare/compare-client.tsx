'use client'

/* eslint-disable react/no-danger */
// compare client: two run pickers + the before/after board. Read-only; the
// per-step traces live on the Reverse Flavor Inspector (ops-reverse2).
import { useRouter } from 'next/navigation'

import { OPS2_CSS } from '../../ops2/trace-lib'
import { isAltResult, povFunnelOf, type RevResult } from '../reverse-trace-lib'

type MomentRow = {
  runImageId: string
  position: number
  status: string
  error: string | null
  moment: string
  outputs: Record<string, unknown>
}

type Props = {
  runs: { id: string; label: string }[]
  aId: string | null
  bId: string | null
  aMoments: MomentRow[]
  bMoments: MomentRow[]
}

// One run's ranked outputs for one moment — a cell of the board.
function ResultsCell({ row }: { row: MomentRow | null }) {
  if (!row)
    return (
      <div className="rounded border p-2 text-sm" style={{ borderColor: 'var(--line)', color: 'var(--dim)' }}>
        no matching moment in this run
      </div>
    )
  const results = (Array.isArray((row.outputs as Record<string, unknown>)?.results)
    ? (row.outputs as Record<string, unknown>).results
    : []) as RevResult[]
  const f = povFunnelOf(row.outputs)
  return (
    <div className="rounded border p-2" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="mb-1 font-mono text-xs" style={{ color: f.ranked.alt ? 'var(--accent)' : 'var(--dim)' }}>
        {f.ranked.alt}/{f.ranked.total} alt-POV
      </div>
      {results.length ? (
        results.map((r, i) => (
          <div
            key={i}
            className="flex items-start gap-2 py-1.5"
            style={{ borderTop: i ? '1px solid var(--line)' : 'none' }}
          >
            {r.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.imageUrl} alt={r.imageKey} style={{ width: 48, borderRadius: 6 }} />
            ) : null}
            <div className="min-w-0 text-sm">
              “{r.caption}”
              <div className="text-xs" style={{ color: 'var(--dim)' }}>
                {isAltResult(row.outputs, r) ? (
                  <b style={{ color: 'var(--accent)' }}>ALT</b>
                ) : (
                  'Me'
                )}{' '}
                · {r.entity || '—'} · {Number(r.emotionalAlignment).toFixed(2)}
              </div>
            </div>
          </div>
        ))
      ) : (
        <div className="text-sm" style={{ color: 'var(--dim)' }}>
          {(row.outputs as Record<string, unknown>)?.noFit
            ? 'no fit — R2 selected no images'
            : row.status !== 'done'
              ? `status: ${row.status}${row.error ? ` — ${row.error}` : ''}`
              : 'no results archived'}
        </div>
      )}
    </div>
  )
}

export default function CompareClient({ runs, aId, bId, aMoments, bMoments }: Props) {
  const router = useRouter()
  const setParam = (key: 'a' | 'b', value: string) => {
    const q = new URLSearchParams(window.location.search)
    if (value) q.set(key, value)
    else q.delete(key)
    router.push(`?${q.toString()}`)
  }
  const inputStyle = { background: 'var(--panel)', borderColor: 'var(--line)' }
  const aLabel = runs.find((r) => r.id === aId)?.label ?? '—'
  const bLabel = runs.find((r) => r.id === bId)?.label ?? '—'

  return (
    <div className="ops2root -mx-6 mt-4 px-6 py-2">
      <style
        dangerouslySetInnerHTML={{ __html: OPS2_CSS + '.ops2root{--bg:rgb(var(--canvas))}' }}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block pb-1 text-xs" style={{ color: 'var(--dim)' }}>
            run A — left column
          </label>
          <select
            className="w-full rounded border px-2 py-1 text-sm"
            style={inputStyle}
            value={aId ?? ''}
            onChange={(e) => setParam('a', e.target.value)}
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block pb-1 text-xs" style={{ color: 'var(--dim)' }}>
            run B — right column
          </label>
          <select
            className="w-full rounded border px-2 py-1 text-sm"
            style={inputStyle}
            value={bId ?? ''}
            onChange={(e) => setParam('b', e.target.value)}
          >
            <option value="">— pick the run to compare against —</option>
            {runs
              .filter((r) => r.id !== aId)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
          </select>
        </div>
      </div>

      {bId ? (
        <section className="py-4">
          <h2>
            Outputs, A → B{' '}
            <span className="dim small">
              left: {aLabel} · right: {bLabel} — matched by moment text
            </span>
          </h2>
          {aMoments.map((m) => {
            const other = bMoments.find((v) => v.moment.trim() === m.moment.trim()) ?? null
            return (
              <div key={m.runImageId} className="mb-5">
                <div className="py-1 text-sm font-semibold">{m.moment}</div>
                <div className="grid grid-cols-2 gap-3">
                  <ResultsCell row={m} />
                  <ResultsCell row={other} />
                </div>
              </div>
            )
          })}
          {(() => {
            const matched = new Set(aMoments.map((m) => m.moment.trim()))
            const extra = bMoments.filter((v) => !matched.has(v.moment.trim()))
            return extra.length ? (
              <p className="text-sm" style={{ color: 'var(--dim)' }}>
                {extra.length} moment{extra.length === 1 ? '' : 's'} in run B had no match in run
                A: {extra.map((v) => `“${v.moment.slice(0, 60)}…”`).join(' · ')}
              </p>
            ) : null
          })()}
        </section>
      ) : (
        <p className="py-6 text-sm" style={{ color: 'var(--dim)' }}>
          pick a run B above to see the two runs&apos; outputs side by side
        </p>
      )}
    </div>
  )
}
