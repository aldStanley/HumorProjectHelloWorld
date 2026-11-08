'use client'

// "Find Meme for Columbia Context" — the public tool. Compact on the home
// page (example chips + a link to the full page); on /find-meme it also gets
// the full browsable list of community contexts (click one to load it).
// Type or pick a moment, and it selects the 3 best-fitting meme templates and
// writes one caption per template, rendered ON the image.
import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'

import { findMemesAction, type FoundMeme } from '@/app/find-meme/actions'

type BatchItem = { key: string; text: string }
type BatchStatus = {
  stage: 'running' | 'done' | 'error'
  results?: FoundMeme[]
  error?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const EXAMPLES = [
  'SSOL registration: your timeslot hits, you blink once, and every class you need already has a waitlist.',
  'Butler during finals: people claim desks with a single laptop sticker and disappear for 6 hours.',
  'The first week back from winter break, when the wind on College Walk makes a Canada Goose feel useless.',
]

export default function FindMeme({
  contexts,
  showFullLink = false,
}: {
  // Full community-context list: shown as a browsable picker when provided.
  contexts?: string[]
  // Home-page variant: link out to the full page instead of the picker.
  showFullLink?: boolean
}) {
  const [context, setContext] = useState('')
  const [filter, setFilter] = useState('')
  const filteredContexts = useMemo(() => {
    if (!contexts) return []
    const q = filter.trim().toLowerCase()
    return q ? contexts.filter((c) => c.toLowerCase().includes(q)) : contexts
  }, [contexts, filter])
  const [results, setResults] = useState<FoundMeme[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Batch mode (full page only): paste a list of contexts, run the single
  // find-memes action once per context sequentially, export flat JSON pairs.
  const [batchDraft, setBatchDraft] = useState('')
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const [batchStatus, setBatchStatus] = useState<Record<string, BatchStatus>>({})
  const [batchRunning, setBatchRunning] = useState(false)

  // Same parsing rule as the reverse page's bulk-add: blank-line separated
  // when the paste contains a blank line (multi-line contexts), else per line.
  const parseBatchDraft = (draft: string): string[] =>
    (/\n\s*\n/.test(draft) ? draft.split(/\n\s*\n/) : draft.split('\n'))
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.length > 400 ? t.slice(0, 400) : t))

  const runBatch = async (): Promise<void> => {
    const texts = parseBatchDraft(batchDraft)
    if (!texts.length || batchRunning) return
    const items = texts.map((text, i) => ({ key: `${i}-${text.length}`, text }))
    setBatchItems(items)
    setBatchStatus({})
    setBatchRunning(true)
    try {
      for (const item of items) {
        setBatchStatus((prev) => ({ ...prev, [item.key]: { stage: 'running' } }))
        // The public action is rate limited (5/min per IP); sequential calls
        // mostly stay under it, but back off and retry when we do hit it.
        let res = await findMemesAction(item.text)
        for (let retry = 0; retry < 3 && res.ok === false && /Too many requests/i.test(res.error); retry++) {
          await sleep(20_000)
          res = await findMemesAction(item.text)
        }
        setBatchStatus((prev) => ({
          ...prev,
          [item.key]:
            res.ok === false
              ? { stage: 'error', error: res.error }
              : { stage: 'done', results: res.results },
        }))
      }
    } finally {
      setBatchRunning(false)
    }
  }

  const batchPairs = useMemo(
    () =>
      batchItems
        .flatMap((item) => batchStatus[item.key]?.results ?? [])
        .filter((r) => r.url && r.caption)
        .map((r) => ({ image_id: r.url, caption: r.caption })),
    [batchItems, batchStatus]
  )

  // Flat pair list with the image URL in the image_id field — the same shape
  // the reverse page exports, accepted by chucklesome's Quick Study importer.
  const exportBatchJson = () => {
    const blob = new Blob([JSON.stringify(batchPairs, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'find-meme-batch.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const submit = () => {
    const text = context.trim()
    if (!text || isPending) return
    setError(null)
    startTransition(async () => {
      const res = await findMemesAction(text)
      if (res.ok === false) {
        setError(res.error)
      } else {
        setResults(res.results)
      }
    })
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold sm:text-3xl">
        <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
          Find Meme for Columbia Context
        </span>
      </h2>
      <p className="mt-2 text-sm text-[rgb(var(--muted))]">
        Describe a Columbia/Barnard moment — we&rsquo;ll pick the 3 meme templates
        that fit it best and write the joke for each.
      </p>

      {contexts?.length ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
            Pick a Columbia context ({contexts.length}) — click one to load it
          </p>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter contexts…"
            className="mt-2 w-full rounded-lg border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-3 py-2 text-sm text-[rgb(var(--ink))] outline-none focus:ring-2 focus:ring-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.2)]"
          />
          <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.92)] dark:border-[rgb(var(--gloss)/0.18)] dark:bg-[rgb(var(--panel)/0.35)]">
            {filteredContexts.length ? (
              filteredContexts.map((c) => {
                const selected =
                  context === c || (c.length > 400 && context === c.slice(0, 400))
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setContext(c.length > 400 ? c.slice(0, 400) : c)}
                    className={`flex w-full items-start gap-3 border-b border-[rgb(var(--gloss)/0.55)] px-3.5 py-2.5 text-left text-[13px] leading-snug transition last:border-b-0 hover:bg-[rgb(var(--primary)/0.06)] dark:border-[rgb(var(--gloss)/0.12)] dark:hover:bg-[rgb(var(--primary)/0.12)] ${
                      selected
                        ? 'bg-[rgb(var(--primary)/0.1)] text-[rgb(var(--ink))]'
                        : 'text-[rgb(var(--ink)/0.85)]'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 transition ${
                        selected
                          ? 'border-[rgb(var(--primary))] bg-[rgb(var(--primary))] shadow-[inset_0_0_0_3px_rgb(var(--panel))]'
                          : 'border-[rgb(var(--muted)/0.55)] bg-transparent'
                      }`}
                    />
                    <span>{c}</span>
                  </button>
                )
              })
            ) : (
              <p className="px-3 py-2 text-xs text-[rgb(var(--muted))]">
                nothing matches that filter
              </p>
            )}
          </div>
        </div>
      ) : null}

      {contexts?.length ? (
        <p className="mt-3 text-sm text-[rgb(var(--muted))]">
          …or write your own — any moment works, and you can edit a picked one:
        </p>
      ) : null}
      <textarea
        value={context}
        onChange={(e) => setContext(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
        maxLength={400}
        rows={3}
        placeholder="e.g. The Ferris Hall printer jams for the fourth time while the essay is due in 10 minutes…"
        className="mt-4 w-full rounded-xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-4 py-3 text-sm text-[rgb(var(--ink))] outline-none transition focus:ring-2 focus:ring-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.2)]"
      />

      {!contexts?.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
            or try:
          </span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setContext(ex)}
              className="max-w-full truncate rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.6)] px-3 py-1 text-left text-[11px] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.2)]"
              title={ex}
            >
              {ex.length > 64 ? `${ex.slice(0, 64)}…` : ex}
            </button>
          ))}
        </div>
      ) : null}

      {showFullLink ? (
        <Link
          href="/find-meme"
          className="mt-4 inline-flex items-center gap-2 rounded-full border-2 border-[rgb(var(--primary)/0.55)] bg-[rgb(var(--panel)/0.75)] px-5 py-2.5 text-sm font-semibold text-[rgb(var(--accent-strong))] shadow-[0_14px_30px_-22px_rgb(var(--primary-deep)/0.7)] transition hover:-translate-y-0.5 hover:border-[rgb(var(--primary))] dark:bg-[rgb(var(--panel)/0.2)]"
        >
          Browse all the Columbia contexts
          <span aria-hidden>→</span>
        </Link>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={isPending || !context.trim()}
          className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-5 py-2.5 text-sm font-semibold text-[rgb(var(--on-primary))] shadow-[0_18px_35px_-24px_rgb(var(--primary-deep)/0.8)] transition hover:-translate-y-0.5 disabled:cursor-default disabled:opacity-50 disabled:hover:translate-y-0 dark:border-[rgb(var(--gloss)/0.1)]"
        >
          {isPending ? (
            <>
              <span
                aria-hidden
                className="h-4 w-4 animate-spin rounded-full border-2 border-[rgb(var(--on-primary)/0.35)] border-t-[rgb(var(--on-primary))]"
              />
              Finding memes…
            </>
          ) : (
            'Find my memes'
          )}
        </button>
        {isPending ? (
          <span className="text-xs text-[rgb(var(--muted))]">
            picking templates and writing jokes — ~20 seconds
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {results ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((r) => (
            <figure
              key={r.url}
              className="overflow-hidden rounded-2xl border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.85)] shadow-[0_20px_60px_-40px_rgb(var(--shadow))] dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.4)]"
            >
              {/* Caption ON the image, classic top-text meme style. */}
              <div className="relative bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt={r.name} className="max-h-80 w-full object-contain" />
                <figcaption className="absolute inset-x-0 top-0 px-3 py-2 text-center">
                  <span className="text-lg font-extrabold leading-tight text-white [text-shadow:0_2px_5px_rgba(0,0,0,0.95),0_0_10px_rgba(0,0,0,0.8)]">
                    {r.caption}
                  </span>
                </figcaption>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs font-semibold text-[rgb(var(--ink))]">{r.name}</p>
                <p className="mt-1 text-[11px] leading-snug text-[rgb(var(--muted))]">
                  {r.fit != null ? `fit ${r.fit.toFixed(2)} · ` : ''}
                  {r.reason}
                </p>
              </div>
            </figure>
          ))}
        </div>
      ) : null}

      {contexts?.length ? (
        <div className="mt-10 rounded-2xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.6)] p-5 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.2)]">
          <h3 className="text-lg font-semibold text-[rgb(var(--ink))]">
            Batch: a list of contexts → JSON of image + caption pairs
          </h3>
          <p className="mt-1 text-sm text-[rgb(var(--muted))]">
            Paste contexts below (one per line, or blank-line separated for
            multi-line contexts). Each runs through the same pipeline; when
            done, download a flat JSON list of {'{image_id: <image url>, caption}'} pairs.
          </p>
          <textarea
            value={batchDraft}
            onChange={(e) => setBatchDraft(e.target.value)}
            rows={6}
            placeholder={'SSOL registration: your timeslot hits…\nButler during finals: people claim desks…'}
            className="mt-3 w-full rounded-xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-4 py-3 text-sm text-[rgb(var(--ink))] outline-none transition focus:ring-2 focus:ring-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.2)]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                setBatchDraft(filteredContexts.join('\n\n'))
              }
              disabled={batchRunning || !filteredContexts.length}
              className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.6)] px-4 py-2 text-xs font-semibold text-[rgb(var(--accent-strong))] transition hover:-translate-y-0.5 disabled:cursor-default disabled:opacity-50 disabled:hover:translate-y-0 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.2)]"
            >
              Load all {filteredContexts.length} filtered contexts
            </button>
            <button
              type="button"
              onClick={runBatch}
              disabled={batchRunning || !parseBatchDraft(batchDraft).length}
              className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-5 py-2 text-sm font-semibold text-[rgb(var(--on-primary))] shadow-[0_18px_35px_-24px_rgb(var(--primary-deep)/0.8)] transition hover:-translate-y-0.5 disabled:cursor-default disabled:opacity-50 disabled:hover:translate-y-0 dark:border-[rgb(var(--gloss)/0.1)]"
            >
              {batchRunning ? (
                <>
                  <span
                    aria-hidden
                    className="h-4 w-4 animate-spin rounded-full border-2 border-[rgb(var(--on-primary)/0.35)] border-t-[rgb(var(--on-primary))]"
                  />
                  Running batch…
                </>
              ) : (
                `Run batch (${parseBatchDraft(batchDraft).length} contexts)`
              )}
            </button>
            {batchPairs.length ? (
              <button
                type="button"
                onClick={exportBatchJson}
                className="rounded-full border-2 border-[rgb(var(--primary)/0.55)] bg-[rgb(var(--panel)/0.75)] px-4 py-2 text-xs font-semibold text-[rgb(var(--accent-strong))] transition hover:-translate-y-0.5 hover:border-[rgb(var(--primary))] dark:bg-[rgb(var(--panel)/0.2)]"
              >
                Download JSON ({batchPairs.length} pairs)
              </button>
            ) : null}
            {batchRunning ? (
              <span className="text-xs text-[rgb(var(--muted))]">
                ~20s per context, run sequentially — leave this tab open
              </span>
            ) : null}
          </div>

          {batchItems.length ? (
            <ul className="mt-4 space-y-2">
              {batchItems.map((item) => {
                const st = batchStatus[item.key]
                return (
                  <li
                    key={item.key}
                    className="rounded-lg border border-[rgb(var(--gloss)/0.55)] bg-[rgb(var(--panel)/0.8)] px-3 py-2 text-[13px] leading-snug dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.3)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-[rgb(var(--ink)/0.85)]">
                        {item.text.length > 120 ? `${item.text.slice(0, 120)}…` : item.text}
                      </span>
                      <span
                        className={`shrink-0 text-xs font-semibold ${
                          st?.stage === 'done'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : st?.stage === 'error'
                              ? 'text-red-600 dark:text-red-400'
                              : st?.stage === 'running'
                                ? 'text-[rgb(var(--accent-strong))]'
                                : 'text-[rgb(var(--muted))]'
                        }`}
                      >
                        {st?.stage === 'done'
                          ? `${st.results?.length ?? 0} memes`
                          : st?.stage === 'error'
                            ? st.error ?? 'failed'
                            : st?.stage === 'running'
                              ? 'running…'
                              : 'queued'}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
