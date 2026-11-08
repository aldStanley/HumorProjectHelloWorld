'use client'

import { useState } from 'react'

// One ranked answer for a moment: the caption plus the image it was written
// for. Batch runs archive full rows (rank/entity/url); single-moment runs
// only archive {image_key, caption}, so every field past caption is
// best-effort.
export type AnswerResult = {
  rank: number
  caption: string
  entity: string | null
  emotionalAlignment: number | null
  imageId: string | null
  imageUrl: string | null
}

export type AnswerMoment = {
  id: string
  position: number
  moment: string | null
  status: string
  error: string | null
  noFit: boolean
  modelCalls: number
  results: AnswerResult[]
}

export type AnswersRun = {
  id: string
  label: string | null
  momentCount: number
  captionCount: number
  exportJson: unknown
}

const panel =
  'rounded-xl border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.85)] p-4 dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.5)]'
const btn =
  'rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]'

// One card per CONTEXT: the moment text is the card's title, and each answer
// underneath is the picked image next to the caption written for it.
function MomentCard({ moment }: { moment: AnswerMoment }) {
  return (
    <div className={panel}>
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-[rgb(var(--muted))]">
          {moment.position + 1}
        </span>
        <p className="text-[15px] font-semibold leading-snug">
          {moment.moment ?? '(moment text missing)'}
        </p>
      </div>
      <p className="mt-0.5 pl-5 text-[11px] text-[rgb(var(--muted))]">
        {moment.results.length} answer
        {moment.results.length === 1 ? '' : 's'} · {moment.modelCalls} model
        call{moment.modelCalls === 1 ? '' : 's'}
        {moment.status !== 'done' ? (
          <span className="ml-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            {moment.status}
          </span>
        ) : null}
      </p>
      {moment.error ? (
        <p className="mt-1 pl-5 text-[12px] text-rose-600 dark:text-rose-400">
          {moment.error}
        </p>
      ) : null}
      {moment.noFit ? (
        <p className="mt-1 pl-5 text-[12px] italic text-[rgb(var(--muted))]">
          No image in the set fit this moment.
        </p>
      ) : null}
      {moment.results.length ? (
        <ul className="mt-3 space-y-2 pl-5">
          {moment.results.map((r, i) => (
            <li key={i} className="flex items-center gap-3">
              {r.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.imageUrl}
                  alt=""
                  className="h-20 w-20 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-[rgb(var(--gloss)/0.5)] text-[10px] text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.2)]">
                  no image
                </span>
              )}
              <div className="min-w-0">
                <p className="text-[14px] leading-snug">{r.caption}</p>
                <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">
                  #{r.rank}
                  {r.entity ? ` · ${r.entity}` : ''}
                  {r.emotionalAlignment != null
                    ? ` · alignment ${r.emotionalAlignment}`
                    : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default function ReverseRunAnswers({
  run,
  moments,
}: {
  run: AnswersRun
  moments: AnswerMoment[]
}) {
  const [copied, setCopied] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const exportText = JSON.stringify(run.exportJson ?? [], null, 2)

  const copy = async () => {
    await navigator.clipboard.writeText(exportText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const download = () => {
    const blob = new Blob([exportText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${run.label ?? run.id}-reverse-answers.json`.replace(
      /[^\w.-]+/g,
      '-'
    )
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-[rgb(var(--muted))]">
          {run.captionCount} answer{run.captionCount === 1 ? '' : 's'} across{' '}
          {run.momentCount} moment{run.momentCount === 1 ? '' : 's'}
        </span>
        <button type="button" onClick={copy} className={`${btn} ml-auto`}>
          {copied ? '✓ Copied' : 'Copy JSON'}
        </button>
        <button type="button" onClick={download} className={btn}>
          ⤓ Download
        </button>
        <button
          type="button"
          onClick={() => setShowJson((s) => !s)}
          className={btn}
        >
          {showJson ? 'Hide' : 'Show'} JSON
        </button>
      </div>
      {showJson ? (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-[rgb(var(--gloss)/0.4)] bg-[rgb(var(--panel)/0.6)] p-2 text-[11px] dark:border-[rgb(var(--gloss)/0.12)]">
          {exportText}
        </pre>
      ) : null}

      {moments.map((m) => (
        <MomentCard key={m.id} moment={m} />
      ))}
    </div>
  )
}
