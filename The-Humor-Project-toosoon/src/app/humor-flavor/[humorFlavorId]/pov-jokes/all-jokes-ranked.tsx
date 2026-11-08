'use client'

// Section 3 used to show jokes only inside the block of the point of view
// that wrote them, so comparing across points of view meant scrolling and
// remembering. This is the fan-in the sad-girl flavors have as a "Rank all
// jokes" step: every caption from every run, in ONE list, best first, each
// score visible. It is drawn from the per-run outputs already on the page —
// no model call — and it sits above the per-point-of-view blocks because it
// is the answer; the blocks are the working-out.
import { useState } from 'react'

import { SMALL_BUTTON } from './pov-jokes-ui'

export type RankedJokeRow = {
  // The caption id the rest of the page uses for saving and jobs.
  id: string
  caption: string
  // The point of view (or persona) that wrote it, and the anchor of its block.
  povLabel: string
  povAnchorId: string
  // The angle name (persona-roster step 2) or the premise (premise-first step 2).
  angle: string
  total: number
  max: number
  // Breaks ties when `total` is a minimum-of-checks (many captions share a 4).
  tiebreak?: number
  // The GIF emotion step 2 had in mind, for the pairing step.
  gifNote?: string
  scores: { label: string; value: number }[]
  // Step 2 named this caption its best for that point of view.
  pickedAsBest: boolean
  saved: boolean
  onToggleSave: () => void
}

const SHOW_FIRST = 10

export function AllJokesRanked({ rows, unit }: { rows: RankedJokeRow[]; unit: 'point of view' | 'persona' }) {
  const [showAll, setShowAll] = useState(false)
  if (!rows.length) return null

  const sorted = [...rows].sort((a, b) => {
    // Totals are on different scales when the two step-2 shapes are mixed on
    // one page, so compare the fraction of the maximum, not the raw sum.
    const fa = a.max ? a.total / a.max : 0
    const fb = b.max ? b.total / b.max : 0
    if (fb !== fa) return fb - fa
    const ta = a.tiebreak ?? 0
    const tb = b.tiebreak ?? 0
    if (tb !== ta) return tb - ta
    if (a.pickedAsBest !== b.pickedAsBest) return a.pickedAsBest ? -1 : 1
    return 0
  })
  const visible = showAll ? sorted : sorted.slice(0, SHOW_FIRST)
  const povCount = new Set(rows.map((r) => r.povAnchorId)).size
  const units = unit === 'persona' ? 'personas' : 'points of view'

  return (
    <div id="all-jokes-ranked" className="max-w-3xl scroll-mt-6">
      <h3 className="text-2xl font-semibold">
        Every joke from every {unit}, ranked by its step-2 score
      </h3>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-relaxed text-[rgb(var(--muted))]">
        <li>
          <span className="font-semibold text-[rgb(var(--ink))]">{rows.length} captions</span> from{' '}
          {povCount} {povCount === 1 ? unit : units} you have run so far, best first. Nothing here is a new model call.
        </li>
        <li>
          The scores are step 2&rsquo;s own, given in separate calls, one per {unit} — so a 24 from one{' '}
          {unit} and a 24 from another were not judged side by side. Treat the order as a shortlist to read, not a verdict.
        </li>
        <li>Save any caption here, or jump to the {unit} that wrote it to see its reasoning.</li>
      </ul>

      <ol className="mt-8 space-y-9">
        {visible.map((row, i) => (
          <li key={row.id} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3">
            <span className="text-3xl font-semibold leading-none tabular-nums text-[rgb(var(--muted))]">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                {row.povLabel} · {row.angle}
                {row.pickedAsBest ? ' · picked as best by its ' + unit : ''}
                {row.saved ? <span className="text-[rgb(var(--ink))]"> · saved</span> : null}
              </p>
              <p className="mt-2 text-xl font-semibold leading-snug">&ldquo;{row.caption}&rdquo;</p>
              <p className="mt-3 text-xs text-[rgb(var(--muted))]">
                <span className="text-base font-bold tabular-nums text-[rgb(var(--ink))]">{row.total}</span>
                <span className="font-semibold"> / {row.max}</span>
                {row.max === 5 ? ' as its weakest check' : ''}
                {'  '}
                {row.scores.map((s) => `${s.label} ${s.value}`).join(' · ')}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" className={SMALL_BUTTON} onClick={row.onToggleSave}>
                  {row.saved ? 'Remove this caption from the saved ones' : 'Save this caption'}
                </button>
                <a
                  href={`#${row.povAnchorId}`}
                  className="text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                >
                  Go to the {unit} that wrote it →
                </a>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {sorted.length > SHOW_FIRST ? (
        <button type="button" className={`${SMALL_BUTTON} mt-8`} onClick={() => setShowAll((v) => !v)}>
          {showAll
            ? `Show only the top ${SHOW_FIRST}`
            : `Show all ${sorted.length} captions, not just the top ${SHOW_FIRST}`}
        </button>
      ) : null}
    </div>
  )
}
