'use client'

import { useState } from 'react'

export type ReportStep = {
  id: string
  opKey: string
  opTitle: string | null
  position: number
  branchIndex: number | null
  branchLabel: string | null
  providerModelId: string | null
  temperature: number | null
  includeImage: boolean | null
  systemPrompt: string | null
  userPrompt: string | null
  priorOutputs: Record<string, unknown> | null
  output: string | null
  error: string | null
  durationMs: number | null
}

export type ReportImage = {
  id: string
  imageId: string | null
  imageUrl: string
  position: number
  status: string
  error: string | null
  captions: string[] | null
  finalOutput: string | null
  // Reverse runs archive a moment per row; forward runs leave this null.
  moment: string | null
  steps: ReportStep[]
}

export type ReportRun = {
  id: string
  label: string | null
  status: string
  imageCount: number
  captionCount: number
  exportWarning: string | null
  exportJson: unknown
  setSlug: string | null
  started: string
  finished: string | null
  spec: unknown
}

const panel =
  'rounded-xl border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.85)] p-3 dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.5)]'
const btn =
  'rounded-md border border-[rgb(var(--gloss)/0.6)] px-2 py-1 text-[11px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)]'

// A labelled block of prompt/output text. Long text scrolls inside the box so
// a 16-step report stays navigable.
function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
        {label}
      </p>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-[rgb(var(--gloss)/0.4)] bg-[rgb(var(--panel)/0.6)] p-2 text-[11px] leading-snug dark:border-[rgb(var(--gloss)/0.12)]">
        {text}
      </pre>
    </div>
  )
}

function StepCard({ step }: { step: ReportStep }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-[rgb(var(--gloss)/0.4)] dark:border-[rgb(var(--gloss)/0.12)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="text-[11px] text-[rgb(var(--muted))]">{open ? '▾' : '▸'}</span>
        <span className="text-[12px] font-semibold">
          {step.opTitle ?? step.opKey}
          {step.branchIndex != null ? (
            <span className="ml-1 font-normal text-[rgb(var(--muted))]">
              · branch {step.branchIndex + 1}
              {step.branchLabel ? ` (${step.branchLabel})` : ''}
            </span>
          ) : null}
        </span>
        {step.error ? (
          <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
            error
          </span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-[rgb(var(--muted))]">
          {step.providerModelId ?? '—'}
          {step.temperature != null ? ` · t=${step.temperature}` : ''}
          {step.durationMs != null ? ` · ${(step.durationMs / 1000).toFixed(1)}s` : ''}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-[rgb(var(--gloss)/0.3)] p-2 dark:border-[rgb(var(--gloss)/0.1)]">
          {step.error ? <TextBlock label="Error" text={step.error} /> : null}
          {step.output != null ? <TextBlock label="Output" text={step.output} /> : null}
          {step.systemPrompt ? (
            <TextBlock label="System prompt (as sent)" text={step.systemPrompt} />
          ) : null}
          {step.userPrompt ? (
            <TextBlock label="User prompt (as sent)" text={step.userPrompt} />
          ) : null}
          {step.priorOutputs && Object.keys(step.priorOutputs).length ? (
            <TextBlock
              label="Input values"
              text={JSON.stringify(step.priorOutputs, null, 2)}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ImageCard({ image }: { image: ReportImage }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={panel}>
      <div className="flex gap-3">
        {image.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.imageUrl}
            alt=""
            className="h-20 w-20 shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold">
              {image.moment != null
                ? `Moment ${image.position + 1}`
                : `Image ${image.position + 1}`}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                image.status === 'done'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
              }`}
            >
              {image.status}
            </span>
            <span className="text-[11px] text-[rgb(var(--muted))]">
              {image.captions?.length ?? 0} caption
              {(image.captions?.length ?? 0) === 1 ? '' : 's'} ·{' '}
              {image.steps.length} model call
              {image.steps.length === 1 ? '' : 's'}
            </span>
            <button type="button" onClick={() => setOpen((o) => !o)} className={`${btn} ml-auto`}>
              {open ? 'Hide steps' : 'Show steps'}
            </button>
          </div>
          {image.moment ? (
            <p className="mt-1 text-[12px] italic text-[rgb(var(--muted))]">
              &ldquo;{image.moment}&rdquo;
            </p>
          ) : null}
          {image.error ? (
            <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
              {image.error}
            </p>
          ) : null}
          {image.captions?.length ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12px]">
              {image.captions.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {open ? (
        <div className="mt-3 space-y-1.5">
          {image.steps.map((s) => (
            <StepCard key={s.id} step={s} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function RunReport({
  run,
  images,
}: {
  run: ReportRun
  images: ReportImage[]
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
    a.download = `${run.label ?? run.id}-quick-study.json`.replace(/[^\w.-]+/g, '-')
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className={panel}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold">Quick Study export</span>
          <span className="text-[11px] text-[rgb(var(--muted))]">
            {run.captionCount} caption{run.captionCount === 1 ? '' : 's'} from{' '}
            {run.imageCount} image{run.imageCount === 1 ? '' : 's'}
          </span>
          <button type="button" onClick={copy} className={`${btn} ml-auto`}>
            {copied ? '✓ Copied' : 'Copy JSON'}
          </button>
          <button type="button" onClick={download} className={btn}>
            ⤓ Download
          </button>
          <button type="button" onClick={() => setShowJson((s) => !s)} className={btn}>
            {showJson ? 'Hide' : 'Show'} JSON
          </button>
        </div>
        {run.exportWarning ? (
          <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
            <p className="font-semibold">⚠ Final-step output wasn&rsquo;t a clean caption list:</p>
            <pre className="mt-0.5 whitespace-pre-wrap">{run.exportWarning}</pre>
          </div>
        ) : null}
        {showJson ? (
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-[rgb(var(--gloss)/0.4)] bg-[rgb(var(--panel)/0.6)] p-2 text-[11px] dark:border-[rgb(var(--gloss)/0.12)]">
            {exportText}
          </pre>
        ) : null}
      </div>

      {images.map((img) => (
        <ImageCard key={img.id} image={img} />
      ))}

      <details className={panel}>
        <summary className="cursor-pointer text-[12px] font-semibold">
          Pipeline snapshot (everything needed to recreate this run)
        </summary>
        <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded border border-[rgb(var(--gloss)/0.4)] bg-[rgb(var(--panel)/0.6)] p-2 text-[11px] dark:border-[rgb(var(--gloss)/0.12)]">
          {JSON.stringify(run.spec ?? {}, null, 2)}
        </pre>
      </details>
    </div>
  )
}
