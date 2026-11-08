'use client'

// Runs each "good" flavor end-to-end in the browser, one runStepAction call
// per step — the same per-step server action the ops page uses, so prompts,
// variable resolution (corpus sampling, student brain), and models behave
// identically. No ops_runs archiving here: this is the throwaway prototype of
// the daily-jokes loop.

import { useMemo, useState } from 'react'
import Link from 'next/link'

import { runStepAction } from '../humor-flavor/[humorFlavorId]/chiltrix/actions'
import {
  finalCaptions,
  quickStudyRows,
} from '../humor-flavor/[humorFlavorId]/ops/export-format'
import type {
  OpsImage,
  OpsImageSet,
  OpsStep,
} from '../humor-flavor/[humorFlavorId]/ops/ops-client'

// How this flavor's captions rated in one study they appeared in. Votes and
// voters are counted over this flavor's captions only — a study can mix
// flavors, and the other flavors' votes shouldn't launder this one's record.
export type StudyStat = {
  id: number
  slug: string | null
  date: string | null
  captionCount: number
  up: number
  down: number
  voterCount: number
}

export type CardFlavor = {
  id: number
  kind: 'forward' | 'reverse'
  slug: string
  description: string | null
  why: string
  steps: OpsStep[]
  captionCount: number | null
  lastCaptionAt: string | null
  studies: StudyStat[]
  statsError: string | null
}

type StepRun = {
  orderBy: number
  title: string
  status: 'idle' | 'running' | 'done' | 'error'
  output?: string
  error?: string
  durationMs?: number
}

type FlavorRun = {
  status: 'idle' | 'running' | 'done' | 'error'
  image?: OpsImage
  steps: StepRun[]
  captions: string[]
  warning: string | null
}

const stepTitle = (s: OpsStep): string => {
  const desc = s.description.trim().split('\n')[0]
  return `S${s.orderBy}${desc ? ` · ${desc.slice(0, 60)}` : ''}`
}

const pickRandom = <T,>(list: T[]): T =>
  list[Math.floor(Math.random() * list.length)]

const shortDate = (iso: string | null): string | null => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DailyJokesClient({
  userId,
  flavors,
  imageSets,
  adminHost,
  statsHost,
}: {
  userId: string
  flavors: CardFlavor[]
  imageSets: OpsImageSet[]
  adminHost: string
  statsHost: string
}) {
  const [setId, setSetId] = useState<number | null>(imageSets[0]?.id ?? null)
  const [runs, setRuns] = useState<Record<number, FlavorRun>>({})
  const [busy, setBusy] = useState(false)
  const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({})
  const [openInfo, setOpenInfo] = useState<Record<number, boolean>>({})

  const currentSet = useMemo(
    () => imageSets.find((s) => s.id === setId) ?? null,
    [imageSets, setId]
  )
  const runnable = useMemo(() => flavors.filter((f) => f.kind === 'forward'), [flavors])

  const patchRun = (flavorId: number, patch: Partial<FlavorRun>) =>
    setRuns((prev) => ({
      ...prev,
      [flavorId]: { ...(prev[flavorId] as FlavorRun), ...patch },
    }))

  const patchStep = (flavorId: number, orderBy: number, patch: Partial<StepRun>) =>
    setRuns((prev) => {
      const run = prev[flavorId]
      if (!run) return prev
      return {
        ...prev,
        [flavorId]: {
          ...run,
          steps: run.steps.map((s) =>
            s.orderBy === orderBy ? { ...s, ...patch } : s
          ),
        },
      }
    })

  const runFlavor = async (flavor: CardFlavor) => {
    if (!currentSet || currentSet.images.length === 0) return
    // Fresh image per run — the "fresh context" part of the daily loop, v0.
    const image = pickRandom(currentSet.images)
    const visibleSteps = flavor.steps
      .filter((s) => !s.isHidden)
      .sort((a, b) => a.orderBy - b.orderBy)

    setRuns((prev) => ({
      ...prev,
      [flavor.id]: {
        status: 'running',
        image,
        steps: visibleSteps.map((s) => ({
          orderBy: s.orderBy,
          title: stepTitle(s),
          status: 'idle',
        })),
        captions: [],
        warning: null,
      },
    }))

    const prior: Record<string, string> = {}
    let lastOutput: string | null = null

    for (const step of visibleSteps) {
      if (!step.providerModelId) {
        patchStep(flavor.id, step.orderBy, {
          status: 'error',
          error: 'No model configured for this step.',
        })
        patchRun(flavor.id, { status: 'error' })
        return
      }
      patchStep(flavor.id, step.orderBy, { status: 'running' })
      const startedAt = Date.now()
      const result = await runStepAction({
        imageId: image.id,
        systemPrompt: step.systemPrompt,
        userPrompt: step.userPrompt,
        providerModelId: step.providerModelId,
        temperature: step.isTemperatureSupported ? step.temperature ?? 0.7 : null,
        includeImage: step.includeImage,
        isTemperatureSupported: step.isTemperatureSupported,
        priorOutputs: {
          ...prior,
          // Image field + run-context constants the server resolver doesn't
          // know — same names the ops runner injects.
          celebrityRecognition: image.celebrityRecognition ?? '',
          imageUrl: image.url,
          flavorId: String(flavor.id),
          flavorName: flavor.slug,
          userId,
        },
      })
      const durationMs = Date.now() - startedAt
      if (!result.ok || !result.text) {
        patchStep(flavor.id, step.orderBy, {
          status: 'error',
          error: result.error ?? 'Run failed.',
          durationMs,
        })
        patchRun(flavor.id, { status: 'error' })
        return
      }
      prior[`step${step.orderBy}Output`] = result.text
      lastOutput = result.text
      patchStep(flavor.id, step.orderBy, {
        status: 'done',
        output: result.text,
        durationMs,
      })
    }

    const final = finalCaptions(lastOutput)
    patchRun(flavor.id, {
      status: 'done',
      captions: final.captions,
      warning: final.warning,
    })
  }

  const runAll = async () => {
    setBusy(true)
    try {
      // Sequential on purpose: parallel flavors would multiply concurrent LLM
      // calls and trip provider rate limits.
      for (const flavor of runnable) {
        await runFlavor(flavor)
      }
    } finally {
      setBusy(false)
    }
  }

  const runOne = async (flavor: CardFlavor) => {
    setBusy(true)
    try {
      await runFlavor(flavor)
    } finally {
      setBusy(false)
    }
  }

  const copyQuickStudy = (flavor: CardFlavor, run: FlavorRun) => {
    if (!run.image) return
    const rows = quickStudyRows(run.captions, {
      imageUrl: run.image.url,
      flavorId: flavor.id,
      flavorName: flavor.slug,
      userId,
    })
    void navigator.clipboard.writeText(JSON.stringify(rows, null, 2))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-[rgb(var(--muted))]">
          Image pool:{' '}
          <select
            className="rounded-md border border-[rgb(var(--gloss)/0.6)] bg-transparent px-2 py-1 text-sm dark:border-[rgb(var(--gloss)/0.15)]"
            value={setId ?? ''}
            onChange={(e) => setSetId(Number(e.target.value))}
            disabled={busy}
          >
            {imageSets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.slug} ({s.images.length})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={runAll}
          disabled={busy || !currentSet}
          className="rounded-md bg-[rgb(var(--accent-strong))] px-4 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          title="Run every good forward flavor, each on a random image from the pool"
        >
          {busy ? 'Running…' : '▶ Run all good flavors'}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {flavors.map((flavor) => {
          const run = runs[flavor.id]
          return (
            <div
              key={flavor.id}
              className="flex flex-col gap-3 rounded-xl border border-[rgb(var(--gloss)/0.6)] p-4 dark:border-[rgb(var(--gloss)/0.15)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link
                    href={
                      flavor.kind === 'reverse'
                        ? `/humor-flavor/${flavor.id}/reverse`
                        : `/humor-flavor/${flavor.id}/ops`
                    }
                    className="font-semibold text-[rgb(var(--accent-strong))] hover:brightness-110"
                  >
                    {flavor.slug} · #{flavor.id}
                  </Link>
                  <p className="mt-1 text-xs text-[rgb(var(--muted))]">{flavor.why}</p>
                </div>
                {flavor.kind === 'forward' ? (
                  <button
                    type="button"
                    onClick={() => runOne(flavor)}
                    disabled={busy || !currentSet}
                    className="shrink-0 rounded-md border border-[rgb(var(--gloss)/0.6)] px-3 py-1 text-xs font-semibold text-[rgb(var(--accent-strong))] transition hover:brightness-110 disabled:opacity-50 dark:border-[rgb(var(--gloss)/0.15)]"
                  >
                    Run
                  </button>
                ) : (
                  <Link
                    href={`/humor-flavor/${flavor.id}/reverse`}
                    className="shrink-0 rounded-md border border-[rgb(var(--gloss)/0.6)] px-3 py-1 text-xs font-semibold text-[rgb(var(--accent-strong))] transition hover:brightness-110 dark:border-[rgb(var(--gloss)/0.15)]"
                  >
                    Open ↗
                  </Link>
                )}
              </div>

              {/* ---- Track record: pipeline shape, output volume, ratings ---- */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[rgb(var(--muted))]">
                {flavor.kind === 'forward' && (
                  <span>{flavor.steps.filter((s) => !s.isHidden).length} steps</span>
                )}
                <Link
                  href={`/humor-flavor/${flavor.id}/captions`}
                  className="underline decoration-dotted hover:text-[rgb(var(--accent-strong))]"
                >
                  {flavor.captionCount ?? '?'} captions
                </Link>
                {flavor.lastCaptionAt && (
                  <span>latest {shortDate(flavor.lastCaptionAt)}</span>
                )}
              </div>

              {flavor.description && (
                <div className="text-xs text-[rgb(var(--muted))]">
                  <button
                    type="button"
                    className="font-semibold underline decoration-dotted"
                    onClick={() =>
                      setOpenInfo((p) => ({ ...p, [flavor.id]: !p[flavor.id] }))
                    }
                  >
                    {openInfo[flavor.id] ? 'Hide description' : 'Flavor description'}
                  </button>
                  {openInfo[flavor.id] && (
                    <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">
                      {flavor.description}
                    </p>
                  )}
                </div>
              )}

              {flavor.statsError && (
                <p className="text-[11px] text-amber-600">
                  Ratings unavailable: {flavor.statsError}
                </p>
              )}

              {flavor.studies.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                    Studies with this flavor&rsquo;s captions
                  </p>
                  <ul className="space-y-1 text-xs">
                    {flavor.studies.slice(0, 5).map((study) => (
                      <li
                        key={study.id}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                      >
                        <a
                          href={`${adminHost}/study/${study.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-[rgb(var(--accent-strong))] hover:brightness-110"
                          title="Open the study in the admin app (results + votes)"
                        >
                          {study.slug ?? `study ${study.id}`}
                        </a>
                        <span className="text-[rgb(var(--muted))]">
                          {shortDate(study.date) ?? ''} · {study.captionCount} captions
                          {study.up + study.down > 0
                            ? ` · ${study.up} liked / ${study.down} disliked`
                            : ' · no votes yet'}
                          {study.voterCount > 0 && ` by ${study.voterCount} voters`}
                        </span>
                        <a
                          href={`${statsHost}/study/${study.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] font-semibold text-[rgb(var(--accent-strong))] hover:brightness-110"
                          title="Open this study in The LOL Report (stats dashboard)"
                        >
                          stats ↗
                        </a>
                      </li>
                    ))}
                    {flavor.studies.length > 5 && (
                      <li className="text-[11px] text-[rgb(var(--muted))]">
                        …and {flavor.studies.length - 5} older{' '}
                        {flavor.studies.length - 5 === 1 ? 'study' : 'studies'}
                      </li>
                    )}
                  </ul>
                </div>
              )}
              {!flavor.statsError && flavor.studies.length === 0 && (
                <p className="text-[11px] text-[rgb(var(--muted))]">
                  No studies include this flavor&rsquo;s captions yet.
                </p>
              )}

              {/* ---- Live run ---- */}
              {run?.image && (
                <div className="flex items-center gap-3 border-t border-[rgb(var(--gloss)/0.4)] pt-3 dark:border-[rgb(var(--gloss)/0.15)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={run.image.url}
                    alt=""
                    className="h-14 w-14 rounded-md object-cover"
                  />
                  <span className="text-xs text-[rgb(var(--muted))]">
                    random image from the pool
                  </span>
                </div>
              )}

              {run && (
                <ul className="space-y-1 text-xs">
                  {run.steps.map((s) => {
                    const key = `${flavor.id}:${s.orderBy}`
                    return (
                      <li key={s.orderBy}>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 text-left"
                          onClick={() =>
                            setOpenSteps((p) => ({ ...p, [key]: !p[key] }))
                          }
                        >
                          <span className="w-4 text-center">
                            {s.status === 'done'
                              ? '✓'
                              : s.status === 'running'
                                ? '…'
                                : s.status === 'error'
                                  ? '✗'
                                  : '·'}
                          </span>
                          <span
                            className={
                              s.status === 'error'
                                ? 'text-red-500'
                                : s.status === 'done'
                                  ? ''
                                  : 'text-[rgb(var(--muted))]'
                            }
                          >
                            {s.title}
                          </span>
                          {s.durationMs != null && (
                            <span className="text-[rgb(var(--muted))]">
                              {(s.durationMs / 1000).toFixed(1)}s
                            </span>
                          )}
                        </button>
                        {s.error && (
                          <p className="ml-6 text-red-500">{s.error}</p>
                        )}
                        {openSteps[key] && s.output && (
                          <pre className="ml-6 mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[rgb(var(--gloss)/0.15)] p-2 text-[10px]">
                            {s.output}
                          </pre>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {run?.status === 'done' && (
                <div className="space-y-2 border-t border-[rgb(var(--gloss)/0.4)] pt-3 dark:border-[rgb(var(--gloss)/0.15)]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">
                      {run.captions.length} joke{run.captions.length === 1 ? '' : 's'}
                    </span>
                    {run.captions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => copyQuickStudy(flavor, run)}
                        className="text-xs font-semibold text-[rgb(var(--accent-strong))] hover:brightness-110"
                        title="Copy Quick Study JSON (image URL + captions) to the clipboard"
                      >
                        Copy Quick Study JSON
                      </button>
                    )}
                  </div>
                  {run.warning && (
                    <p className="text-xs text-amber-600">{run.warning}</p>
                  )}
                  <ul className="space-y-1.5">
                    {run.captions.map((caption, i) => (
                      <li key={i} className="rounded-md bg-[rgb(var(--gloss)/0.15)] px-3 py-2 text-sm">
                        {caption}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
