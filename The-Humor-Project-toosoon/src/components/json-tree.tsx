'use client'

// Readable layout for a step's JSON output, shared by the Flavor Maker (ops)
// and the Reverse Flavor Maker (ops-reverse). Extracted verbatim from
// ops-client.tsx so both surfaces render the same structured view.
import { Fragment } from 'react'

// Readable layout for JSON outputs: keys become small labels, prose strings
// wrap in a normal font, arrays become numbered blocks. Same content as the
// raw JSON — only the layout changes. (The sidebar still shows the raw text.)
// Each step's main output field(s), bolded in the structured view: the scene
// reads' figure/entity, the moments' context, the metaphors' situation.
// Captions get the larger emphasize treatment instead.
const MAIN_OUTPUT_KEYS = new Set([
  'figure',
  'entity',
  'context',
  'moment',
  'situation',
])

// Keys whose bare name reads as something it isn't. `weakest_fit` looks like a
// rank ("#1 weakest") but is the LOWEST fit score in the ensemble, 0-1 — so 1
// is a perfect cast, not a bad one. A key listed here gets its question as a
// full-width title above the value instead of a narrow uppercase label.
const LABEL_TITLES: Record<string, string> = {
  weakest_fit:
    'Which SAD girl entity is the weakest fit for the image figure?',
  // `element_map` (the moments steps S6/S9/S12) is the cast of the metaphor's
  // elements onto the sad-girl moment — the bare key reads as a data structure,
  // not as the operation the reader is looking at.
  element_map: 'Map Metaphor to Moment',
  context_recovery:
    'Can the reader recover the moment from the caption alone?',
  referent_ledger:
    'Is every person in the caption grounded — canon, or named in the caption?',
  // The caption steps (S7/S10/S13) emit `image_configuration`: the physical
  // analog plus the cast that scores the caption against it. "image
  // configuration" names the data structure; the question names the judgment.
  image_configuration: 'How well does the caption fit the physical analog?',
  // The moments steps (S6/S9/S12) name the entity that loses something before
  // scoring how much the moment is at her expense — "who pays" and "expense
  // fit" are the field names; these are the questions they answer.
  who_pays: 'Who pays for this moment?',
  expense_fit: 'Is the joke at HER expense?',
  // `overall` is a floor, not a summary: the LOWEST of every check on the thing
  // being scored (a caption's context recovery, allusions, metaphor recovery,
  // casting, physical fit). Bare, it reads as an average, which invites reading
  // a low number as harsh rather than as one bad check.
  overall: 'Weakest score across all the checks',
}

export function JsonTree({
  data,
  emphasize = false,
  bold = false,
}: {
  data: unknown
  emphasize?: boolean
  bold?: boolean
}) {
  if (data == null)
    return <span className="text-[12px] text-[rgb(var(--muted))]">null</span>
  if (typeof data === 'string')
    return (
      <span
        className={`whitespace-pre-wrap font-sans leading-snug text-[rgb(var(--ink))] ${
          emphasize
            ? 'text-[15px] font-bold'
            : bold
              ? 'text-[12px] font-bold'
              : 'text-[12px]'
        }`}
      >
        {data}
      </span>
    )
  if (typeof data === 'number') {
    const isScore = data >= 0 && data <= 1
    const scoreClass = !isScore
      ? 'text-[rgb(var(--ink))]'
      : data >= 0.8
        ? 'font-bold text-emerald-600 dark:text-emerald-400'
        : data <= 0.4
          ? 'font-bold text-rose-600 dark:text-rose-400'
          : 'font-bold text-[rgb(var(--ink))]'
    return (
      <span className={`font-mono text-[12px] ${scoreClass}`}>{data}</span>
    )
  }
  if (typeof data === 'boolean')
    return (
      <span
        className={`font-mono text-[12px] font-bold ${
          data ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
        }`}
      >
        {String(data)}
      </span>
    )
  if (Array.isArray(data)) {
    if (!data.length)
      return <span className="text-[12px] text-[rgb(var(--muted))]">(empty list)</span>
    // Parallel objects (the two sides, the two jokes, the parties...) → a
    // comparison table: one column per item, one row per field. Items may
    // contain one level of nesting (a party's anchor objects render inside
    // their cells); deeply nested items (S4's context blocks) keep the
    // numbered-block layout instead.
    const depthOf = (v: unknown): number => {
      if (v == null || typeof v !== 'object') return 0
      const values = Array.isArray(v) ? v : Object.values(v)
      return 1 + values.reduce<number>((m, x) => Math.max(m, depthOf(x)), 0)
    }
    const isTableItem = (v: unknown): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v) && depthOf(v) <= 2
    // A one-item list takes the table layout too: S3's `ensemble` (often one
    // merged figure) and `secondary` (2-3 entities) are the same shape, and
    // splitting them across two layouts read as an inconsistency in the step.
    if (data.length >= 1 && data.length <= 4 && data.every(isTableItem)) {
      const keys: string[] = []
      data.forEach((item) =>
        Object.keys(item).forEach((k) => {
          if (!keys.includes(k)) keys.push(k)
        })
      )
      return (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-[12px]">
            <thead>
              <tr>
                {/* wide enough that the longest field name in the pipeline
                    ("possibilities") sits on one line instead of shedding its
                    last letter to a second row */}
                <th className="w-28" />
                {data.map((_, i) => (
                  <th
                    key={i}
                    className="border-l border-[rgb(var(--gloss)/0.45)] pb-1 pl-2 pr-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]"
                  >
                    {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr
                  key={k}
                  className="border-t border-[rgb(var(--gloss)/0.35)] align-top dark:border-[rgb(var(--gloss)/0.12)]"
                >
                  <td className="break-words pb-1 pr-2 pt-[5px] align-top font-mono text-[10px] font-medium uppercase tracking-[0.12em] leading-snug text-[rgb(var(--muted))]">
                    {k.replace(/_/g, ' ')}
                  </td>
                  {data.map((item, i) => (
                    <td
                      key={i}
                      className="border-l border-[rgb(var(--gloss)/0.45)] py-1 pl-2 pr-2 align-top dark:border-[rgb(var(--gloss)/0.15)]"
                    >
                      {k in item ? (
                        <JsonTree
                          data={item[k]}
                          emphasize={k === 'caption'}
                          bold={MAIN_OUTPUT_KEYS.has(k)}
                        />
                      ) : (
                        <span className="text-[rgb(var(--muted))]">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    // A list of plain strings (S5's `possibilities`, a caption list) needs no
    // separators and no breathing room — the pb-7/py-7 rhythm below is for rich
    // object blocks, and applied to three short phrases it reads as a gap with
    // text in it. Stack them tight instead.
    if (data.every((x) => x == null || typeof x !== 'object'))
      return (
        <div className="space-y-1">
          {data.map((item, i) => (
            <div key={i} className="text-[12px] leading-snug">
              <JsonTree data={item} />
            </div>
          ))}
        </div>
      )
    return (
      <div className="divide-y divide-[rgb(var(--ink)/0.18)] dark:divide-[rgb(var(--gloss)/0.3)]">
        {data.map((item, i) => (
          <div key={i} className={i === 0 ? 'pb-7' : 'py-7 last:pb-0'}>
            {typeof item === 'object' && item !== null ? (
              <>
                {/* A lone "1" over a single block numbers nothing — it just
                    reads as a stray misaligned digit above the first label. */}
                {data.length > 1 && (
                  <p className="mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--accent-strong))]">
                    {i + 1}
                  </p>
                )}
                <JsonTree data={item} />
              </>
            ) : (
              <JsonTree data={item} />
            )}
          </div>
        ))}
      </div>
    )
  }
  const record = data as Record<string, unknown>
  // A moments cell is an object with a `context` but no `caption` (the moments
  // steps S6/S9/S12). Its `register` row is step-level noise — every match
  // shares it — and its `context` field IS the sad-girl moment itself.
  const isMoment = 'context' in record && !('caption' in record)
  const entries = Object.entries(record).filter(
    ([k]) => !(k === 'register' && isMoment)
  )
  if (!entries.length)
    return <span className="text-[12px] text-[rgb(var(--muted))]">(empty)</span>
  // The extract step (S3) emits exactly {ensemble, secondary}. The scene reads
  // (S5/S8/S11) reuse `ensemble` for their cast and S2 uses `secondary` for
  // prose texture, so these titles must not leak to them — the sibling keys are
  // the only context JsonTree has, same as `isMoment` above.
  const isExtract =
    'ensemble' in record && 'secondary' in record && !('weakest_fit' in record)
  const titleFor = (k: string) => {
    if (isExtract && k === 'ensemble') return 'Image figures'
    if (isExtract && k === 'secondary') return 'Image entities (non-figure)'
    return LABEL_TITLES[k]
  }
  const labelFor = (k: string) =>
    k === 'context' && isMoment
      ? 'sad-girl moment'
      : (titleFor(k) ?? k.replace(/_/g, ' '))
  // Two-column grid: every scalar label shares one column, so values start on
  // a single vertical rule instead of each label pushing its value a different
  // distance right. Nested values (arrays/objects) take the full width under
  // their label.
  return (
    <div className="grid grid-cols-[minmax(4rem,max-content)_1fr] gap-x-3 gap-y-1.5">
      {entries.map(([k, v], entryIndex) => {
        const title = titleFor(k)
        const isScalar =
          v == null || ['string', 'number', 'boolean'].includes(typeof v)
        const inline = isScalar && !title
        const label = labelFor(k)
        // A titled scalar (S5's weakest_fit): the title spans both columns, but
        // the value still belongs in the value column — left at the grid's left
        // edge it sits on its own third margin, out of line with every
        // neighbouring row's value.
        if (title && isScalar)
          return (
            <Fragment key={k}>
              <p
                className={`col-span-2 text-[11px] font-semibold leading-snug text-[rgb(var(--ink))] ${
                  entryIndex > 0 ? 'mt-3' : ''
                }`}
              >
                {title}
              </p>
              <div />
              <div className="min-w-0 text-[12px] leading-snug">
                <JsonTree data={v} />
              </div>
            </Fragment>
          )
        return inline ? (
          <Fragment key={k}>
            <p className="max-w-[10rem] break-words pt-[2px] font-mono text-[10px] font-medium uppercase leading-snug tracking-[0.12em] text-[rgb(var(--muted))]">
              {label}
            </p>
            <div className="min-w-0 text-[12px] leading-snug">
              <JsonTree
                data={v}
                emphasize={k === 'caption'}
                bold={MAIN_OUTPUT_KEYS.has(k)}
              />
            </div>
          </Fragment>
        ) : (
          <Fragment key={k}>
            <p
              className={`col-span-2 text-[rgb(var(--muted))] ${
                title
                  ? 'text-[11px] font-semibold leading-snug text-[rgb(var(--ink))]'
                  : 'font-mono text-[10px] font-medium uppercase tracking-[0.12em]'
              } ${entryIndex > 0 ? 'mt-3' : ''}`}
            >
              {label}
            </p>
            <div className="col-span-2 min-w-0 pl-2">
              <JsonTree data={v} />
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
