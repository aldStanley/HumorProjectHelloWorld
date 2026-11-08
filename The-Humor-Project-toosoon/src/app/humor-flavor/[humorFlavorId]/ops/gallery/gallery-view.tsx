'use client'

import { useState } from 'react'

import type { GalleryItem, QuickStudyRow } from '../export-format'

export const panel =
  'rounded-xl border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.85)] p-3 dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.5)]'
export const btn =
  'rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]'

// Rows arrive flat (one per caption, keyed by image URL). Group them back into
// one card per image, keeping the order they were produced in. Only used for
// hand-pasted exports: rows can't show an image that made no captions.
export const groupByImage = (rows: QuickStudyRow[]): GalleryItem[] => {
  const order: string[] = []
  const byUrl = new Map<string, string[]>()
  rows.forEach((r) => {
    if (!byUrl.has(r.image_id)) {
      byUrl.set(r.image_id, [])
      order.push(r.image_id)
    }
    byUrl.get(r.image_id)!.push(r.caption)
  })
  return order.map((url) => ({
    imageId: url,
    imageUrl: url,
    captions: byUrl.get(url) ?? [],
    problem: null,
  }))
}

function ImageCard({ item, index }: { item: GalleryItem; index: number }) {
  const { imageUrl: url, captions, problem } = item
  const [copied, setCopied] = useState<number | null>(null)
  const copy = async (caption: string, i: number) => {
    await navigator.clipboard.writeText(caption)
    setCopied(i)
    setTimeout(() => setCopied(null), 1200)
  }

  const empty = captions.length === 0

  return (
    <div
      className={
        empty
          ? `${panel} border-rose-500/50 bg-rose-500/5 dark:border-rose-500/40`
          : panel
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            className="h-56 w-56 rounded-lg object-cover sm:h-64 sm:w-64"
          />
          <p className="mt-1 text-[10px] text-[rgb(var(--muted))]">
            {index + 1} ·{' '}
            {empty ? (
              <span className="font-semibold text-rose-600 dark:text-rose-400">
                no captions
              </span>
            ) : (
              `${captions.length} caption${captions.length === 1 ? '' : 's'}`
            )}
          </p>
        </div>
        <ol className="min-w-0 flex-1 space-y-1">
          {captions.map((c, i) => (
            <li
              key={i}
              className="group flex items-start gap-2 rounded border border-transparent px-1.5 py-1 text-[13px] leading-snug hover:border-[rgb(var(--gloss)/0.5)] hover:bg-[rgb(var(--panel)/0.6)]"
            >
              <span className="mt-0.5 shrink-0 font-mono text-[10px] text-[rgb(var(--muted))]">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">{c}</span>
              <button
                type="button"
                onClick={() => copy(c, i)}
                className="shrink-0 rounded px-1 text-[10px] font-semibold text-[rgb(var(--muted))] opacity-0 transition hover:text-[rgb(var(--accent-strong))] group-hover:opacity-100"
              >
                {copied === i ? '✓' : 'copy'}
              </button>
            </li>
          ))}
          {empty ? (
            <li className="space-y-1">
              <p className="text-[13px] font-semibold text-rose-600 dark:text-rose-400">
                This image produced no captions.
              </p>
              {problem ? (
                <p className="text-[12px] text-[rgb(var(--muted))]">{problem}</p>
              ) : null}
            </li>
          ) : null}
        </ol>
      </div>
    </div>
  )
}

// The images-and-captions view itself, shared by the saved-run gallery (fed
// from the database) and the last-batch gallery (fed from localStorage).
export default function GalleryView({
  items,
  rows,
  subtitle,
  downloadName,
  children,
  footer,
}: {
  items: GalleryItem[]
  // The Quick Study export for Copy/Download. Derived from `items` when absent.
  rows?: QuickStudyRow[]
  subtitle?: string | null
  downloadName?: string
  // Extra controls for the header bar (e.g. "Load other JSON").
  children?: React.ReactNode
  footer?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const captionCount = items.reduce((n, i) => n + i.captions.length, 0)
  const emptyCount = items.filter((i) => !i.captions.length).length
  const exportText = JSON.stringify(rows ?? [], null, 2)

  const copyAll = async () => {
    await navigator.clipboard.writeText(exportText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const download = () => {
    const blob = new Blob([exportText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${downloadName ?? 'quick-study'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className={`${panel} flex flex-wrap items-center gap-2`}>
        <span className="text-[12px] font-semibold">
          {captionCount} caption{captionCount === 1 ? '' : 's'} · {items.length} image
          {items.length === 1 ? '' : 's'}
        </span>
        {emptyCount ? (
          <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
            {emptyCount} with no captions
          </span>
        ) : null}
        {subtitle ? (
          <span className="text-[11px] text-[rgb(var(--muted))]">{subtitle}</span>
        ) : null}
        <button type="button" onClick={copyAll} className={`${btn} ml-auto`}>
          {copied ? '✓ Copied' : 'Copy JSON'}
        </button>
        <button type="button" onClick={download} className={btn}>
          ⤓ Download
        </button>
        {children}
      </div>

      {items.map((item, i) => (
        <ImageCard key={item.imageId || item.imageUrl || i} item={item} index={i} />
      ))}

      {footer}
    </div>
  )
}
