'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import type { GalleryItem, QuickStudyRow } from '../export-format'

import GalleryView, { btn, groupByImage, panel } from './gallery-view'

type Saved = {
  savedAt: string
  flavorSlug: string
  setSlug: string | null
  rows: QuickStudyRow[]
  // One per image attempted, including the ones that produced nothing. Absent
  // on hand-pasted JSON and on exports saved before this existed — those fall
  // back to grouping the rows, which can only show images that made captions.
  items?: GalleryItem[]
}

// Accepts the exported Quick Study JSON — either the array itself or a
// { rows: [...] } wrapper — and keeps only rows that can actually be drawn.
const parseRows = (text: string): { rows?: QuickStudyRow[]; error?: string } => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    return { error: 'That is not valid JSON.' }
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { rows?: unknown })?.rows
  if (!Array.isArray(list)) return { error: 'Expected a JSON array of rows.' }
  const rows = list.filter(
    (r): r is QuickStudyRow =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as QuickStudyRow).image_id === 'string' &&
      typeof (r as QuickStudyRow).caption === 'string'
  )
  if (!rows.length)
    return { error: 'No rows with both an image_id and a caption in that JSON.' }
  return { rows }
}

// Load an export by hand: the run that produced it may predate this page, or
// have happened in another browser.
function ImportPanel({ onLoad }: { onLoad: (rows: QuickStudyRow[]) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = (raw: string) => {
    const { rows, error: err } = parseRows(raw)
    if (rows) {
      setError(null)
      onLoad(rows)
    } else {
      setError(err ?? 'Could not read that JSON.')
    }
  }

  const readFile = async (file: File | null | undefined) => {
    if (!file) return
    load(await file.text())
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void readFile(e.dataTransfer.files?.[0])
      }}
      className="space-y-2"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='Paste the exported JSON here — [{"image_id": "https://…", "caption": "…"}, …] — or drop the downloaded .json file anywhere in this box.'
        rows={5}
        className="w-full rounded-md border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] p-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.2)]"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => load(text)} disabled={!text.trim()} className={`${btn} disabled:opacity-40`}>
          Show these
        </button>
        <label className={`${btn} cursor-pointer`}>
          Choose a .json file
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
        </label>
        {error ? (
          <span className="text-[11px] text-rose-600 dark:text-rose-400">{error}</span>
        ) : null}
      </div>
    </div>
  )
}

// The unsaved view: whatever this browser last ran, plus hand-pasted exports.
// Saved runs have their own URL — /ops/gallery/[runId] — and read the database.
export default function GalleryClient({ flavorId }: { flavorId: number }) {
  // localStorage is browser-only, so the first render is always the loading
  // state — reading it in useEffect keeps the server and client markup equal.
  const [saved, setSaved] = useState<Saved | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [importing, setImporting] = useState(false)

  const importRows = (rows: QuickStudyRow[]) => {
    const next: Saved = {
      savedAt: new Date().toISOString(),
      flavorSlug: rows[0]?.flavor_name || String(flavorId),
      setSlug: null,
      rows,
    }
    setSaved(next)
    setImporting(false)
    // Keep it, so a reload doesn't lose the paste.
    try {
      window.localStorage.setItem(`ops-gallery:${flavorId}`, JSON.stringify(next))
    } catch {
      // Quota — it still renders for this visit.
    }
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`ops-gallery:${flavorId}`)
      if (raw) {
        const parsed = JSON.parse(raw) as Saved
        if (Array.isArray(parsed?.rows)) setSaved(parsed)
      }
    } catch {
      // Corrupt or unreadable — fall through to the empty state.
    }
    setLoaded(true)
  }, [flavorId])

  const allRuns = (
    <Link href={`/humor-flavor/${flavorId}/ops/runs`} className={btn}>
      All saved runs →
    </Link>
  )

  if (!loaded) {
    return <p className="text-[12px] text-[rgb(var(--muted))]">Loading…</p>
  }

  if (!saved || !saved.rows.length) {
    return (
      <div className={panel}>
        <p className="text-[13px] font-semibold">Nothing to show yet.</p>
        <p className="mt-1 text-[12px] text-[rgb(var(--muted))]">
          Tick some images on the ops page and hit <strong>Run batch</strong> — the
          captions appear here as each image finishes. Already have the export
          JSON from an earlier run? Paste or drop it below. Runs that were saved
          to the database have their own page: {allRuns}
        </p>
        <div className="mt-3">
          <ImportPanel onLoad={importRows} />
        </div>
      </div>
    )
  }

  // Prefer the per-image record: it includes the images that made nothing.
  const items = saved.items?.length ? saved.items : groupByImage(saved.rows)

  return (
    <GalleryView
      items={items}
      rows={saved.rows}
      subtitle={`${saved.setSlug ? `${saved.setSlug} · ` : ''}${new Date(saved.savedAt).toLocaleString()}`}
      downloadName={`${saved.flavorSlug}-${saved.setSlug ?? 'set'}-quick-study`}
      footer={
        !saved.items ? (
          <p className="text-[11px] text-[rgb(var(--muted))]">
            This export only lists captions, so images that produced none
            aren&rsquo;t shown. Run or archive a batch to get the full picture.
          </p>
        ) : null
      }
    >
      <button type="button" onClick={() => setImporting((v) => !v)} className={btn}>
        {importing ? 'Cancel' : 'Load other JSON'}
      </button>
      {allRuns}
      {importing ? (
        <div className={`${panel} w-full`}>
          <ImportPanel onLoad={importRows} />
        </div>
      ) : null}
    </GalleryView>
  )
}
