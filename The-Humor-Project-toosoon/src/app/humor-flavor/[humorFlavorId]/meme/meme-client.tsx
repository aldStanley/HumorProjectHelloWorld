'use client'

// The forward meme surface: reaction images in, captioned memes out. Runs the
// flavor's steps in order_by order per image, feeding each step's output to
// the next as the legacy number-keyed priorOutputs (${stepNOutput}). Steps
// whose type is celebrity-recognition or image-description reuse the cached
// per-image value instead of an LLM call, matching the chiltrix prefill.
// The final meme captions are pulled from the LAST step whose output parses
// into caption entries, so an analyst/validator step after the caption writer
// does not hide the captions.
/* eslint-disable @next/next/no-img-element */
import { useMemo, useState } from 'react'

import { runStepAction } from '../chiltrix/actions'
import { updateMemeStepPromptsAction } from './actions'

export type MemeStep = {
  id: number
  orderBy: number
  description: string
  stepTypeSlug: string | null
  systemPrompt: string
  userPrompt: string
  providerModelId: string
  isTemperatureSupported: boolean
  temperature: number | null
  includeImage: boolean
}

export type MemeImage = {
  id: string
  url: string
  additionalContext: string | null
  imageDescription: string | null
  celebrityRecognition: string | null
}

export type MemeImageSet = {
  id: number
  slug: string
  images: MemeImage[]
}

const resultPre =
  'overflow-auto whitespace-pre-wrap rounded-md bg-[rgb(var(--panel)/0.6)] p-2 font-mono text-[11px] leading-snug text-[rgb(var(--ink))] dark:bg-[rgb(var(--panel)/0.2)]'
const outLabel =
  'text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]'
const sectionCard =
  'rounded-xl border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.85)] p-4 dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.5)]'
const runButton =
  'rounded-md bg-[rgb(var(--primary))] px-2.5 py-1 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40'
const ghostButton =
  'rounded-md border border-[rgb(var(--gloss)/0.6)] px-2.5 py-1 text-xs font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] disabled:opacity-40 dark:border-[rgb(var(--gloss)/0.2)]'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseJsonLoose = (value: string): any => {
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tryParse = (s: string): any => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }
  let out = tryParse(cleaned)
  if (out !== undefined) return out
  const start = cleaned.search(/[[{]/)
  const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'))
  const sub = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
  out = tryParse(sub)
  return out === undefined ? null : out
}

type Joke = { caption: string; reason: string }

// Tolerant caption extraction across recipe output shapes: 1517-style
// [{jokes: [{caption, reason}]}], {captions: [...]}, or a bare array of
// caption entries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extractJokes = (parsed: any): Joke[] => {
  const fromArr = (arr: unknown): Joke[] =>
    Array.isArray(arr)
      ? arr
          .filter((j) => typeof (j as Joke)?.caption === 'string')
          .map((j) => ({
            caption: String((j as Record<string, unknown>).caption),
            reason: String(
              (j as Record<string, unknown>).reason ??
                (j as Record<string, unknown>).fit_reason ??
                (j as Record<string, unknown>).explanation ??
                ''
            ),
          }))
      : []
  if (Array.isArray(parsed)) {
    const nested = parsed.flatMap((p) =>
      fromArr((p as Record<string, unknown>)?.jokes)
    )
    return nested.length ? nested : fromArr(parsed)
  }
  if (parsed && typeof parsed === 'object') {
    const captions = fromArr(parsed.captions)
    return captions.length ? captions : fromArr(parsed.jokes)
  }
  return []
}

// Run tasks with a small concurrency cap; collect per-task errors rather than
// aborting the batch.
const runPool = async <T,>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> => {
  const queue = [...items]
  const lanes = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      if (item === undefined) break
      await worker(item)
    }
  })
  await Promise.all(lanes)
}

type ImageRun = {
  status: 'idle' | 'running' | 'done' | 'error'
  stepLabel?: string
  outputs: Record<string, string>
  jokes?: Joke[]
  jokesStepOrder?: number
  error?: string
}

// Edits one prompt field of a flavor step, saving straight to the DB step —
// same behavior as the reverse page's editor.
function StepPromptEditor({
  stepId,
  flavorId,
  field,
  initial,
  onSaved,
}: {
  stepId: number
  flavorId: number
  field: 'systemPrompt' | 'userPrompt'
  initial: string
  onSaved: (value: string) => void
}) {
  const [draft, setDraft] = useState(initial)
  const [baseline, setBaseline] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = draft !== baseline
  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setSaved(false)
          setError(null)
        }}
        rows={12}
        spellCheck={false}
        className={`${resultPre} block w-full resize-y focus:border-[rgb(var(--primary))] focus:outline-none`}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            setSaving(true)
            setError(null)
            const res = await updateMemeStepPromptsAction({
              stepId,
              flavorId,
              [field]: draft,
            })
            setSaving(false)
            if (res.ok) {
              setBaseline(draft)
              setSaved(true)
              onSaved(draft)
            } else {
              setError(res.error ?? 'Save failed.')
            }
          }}
          disabled={!dirty || saving}
          className={runButton}
        >
          {saving ? 'Saving…' : 'Save to flavor'}
        </button>
        {error ? (
          <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">
            {error}
          </span>
        ) : saved && !dirty ? (
          <span className="text-[11px] font-semibold text-[rgb(var(--primary))]">
            Saved ✓
          </span>
        ) : dirty ? (
          <span className="text-[11px] text-[rgb(var(--muted))]">
            unsaved changes
          </span>
        ) : null}
      </div>
    </div>
  )
}

export default function MemeClient({
  flavorId,
  steps: initialSteps,
  imageSets,
}: {
  flavorId: number
  steps: MemeStep[]
  imageSets: MemeImageSet[]
}) {
  // Steps live in state so a saved prompt edit applies to the next run.
  const [steps, setSteps] = useState(initialSteps)
  const orderedSteps = useMemo(
    () => [...steps].sort((a, b) => a.orderBy - b.orderBy),
    [steps]
  )

  const [setId, setSetId] = useState<number | ''>(imageSets[0]?.id ?? '')
  const selectedSet = imageSets.find((s) => s.id === setId) ?? null
  const setImages = selectedSet?.images ?? []

  const [runs, setRuns] = useState<Record<string, ImageRun>>({})
  const [runningAll, setRunningAll] = useState(false)
  const [expandedImageId, setExpandedImageId] = useState<string | null>(null)
  const [openStepId, setOpenStepId] = useState<number | null>(null)

  // The cached per-image value a step of this type reuses instead of an LLM
  // call — the same prefill the chiltrix applies.
  const prefillFor = (step: MemeStep, image: MemeImage): string | null => {
    if (step.stepTypeSlug === 'celebrity-recognition') {
      return image.celebrityRecognition?.trim() ? image.celebrityRecognition : null
    }
    if (step.stepTypeSlug === 'image-description') {
      return image.imageDescription?.trim() ? image.imageDescription : null
    }
    return null
  }

  const runImage = async (image: MemeImage): Promise<void> => {
    setRuns((prev) => ({
      ...prev,
      [image.id]: { status: 'running', outputs: {} },
    }))
    const outputs: Record<string, string> = {}
    try {
      for (const step of orderedSteps) {
        setRuns((prev) => ({
          ...prev,
          [image.id]: {
            ...(prev[image.id] as ImageRun),
            stepLabel: `S${step.orderBy}`,
          },
        }))
        const prefill = prefillFor(step, image)
        if (prefill !== null) {
          outputs[String(step.orderBy)] = prefill
        } else {
          const res = await runStepAction({
            imageId: image.id,
            systemPrompt: step.systemPrompt,
            userPrompt: step.userPrompt,
            providerModelId: step.providerModelId,
            temperature: step.temperature,
            includeImage: step.includeImage,
            isTemperatureSupported: step.isTemperatureSupported,
            priorOutputs: {
              ...outputs,
              celebrityRecognition: image.celebrityRecognition ?? '',
            },
          })
          if (!res.ok || !res.text) {
            throw new Error(
              `S${step.orderBy}: ${res.error ?? 'The step returned no output.'}`
            )
          }
          outputs[String(step.orderBy)] = res.text
        }
        setRuns((prev) => ({
          ...prev,
          [image.id]: {
            ...(prev[image.id] as ImageRun),
            outputs: { ...outputs },
          },
        }))
      }
      // The captions live in the last step whose output parses into caption
      // entries — walk backward so a trailing analyst step doesn't hide them.
      let jokes: Joke[] = []
      let jokesStepOrder: number | undefined
      for (const step of [...orderedSteps].reverse()) {
        jokes = extractJokes(parseJsonLoose(outputs[String(step.orderBy)] ?? ''))
        if (jokes.length) {
          jokesStepOrder = step.orderBy
          break
        }
      }
      setRuns((prev) => ({
        ...prev,
        [image.id]: {
          status: 'done',
          outputs,
          jokes,
          jokesStepOrder,
          error: jokes.length
            ? undefined
            : 'No step output parsed into captions — inspect the raw outputs.',
        },
      }))
    } catch (err) {
      setRuns((prev) => ({
        ...prev,
        [image.id]: {
          ...(prev[image.id] as ImageRun),
          status: 'error',
          error: err instanceof Error ? err.message : 'The run failed.',
        },
      }))
    }
  }

  const runMany = async (images: MemeImage[]): Promise<void> => {
    if (!images.length || runningAll) return
    setRunningAll(true)
    try {
      await runPool(images, 2, runImage)
    } finally {
      setRunningAll(false)
    }
  }

  const notRunYet = setImages.filter(
    (img) => !runs[img.id] || runs[img.id].status === 'error'
  )
  const doneCount = setImages.filter(
    (img) => runs[img.id]?.status === 'done'
  ).length

  const memes = setImages.flatMap((img) => {
    const run = runs[img.id]
    if (run?.status !== 'done' || !run.jokes?.length) return []
    return run.jokes.map((joke, index) => ({ image: img, joke, index }))
  })

  const exportMemesJson = () => {
    const pairs = memes.map((m) => ({
      image_id: m.image.id,
      image_url: m.image.url,
      caption: m.joke.caption,
      reason: m.joke.reason,
    }))
    const blob = new Blob([JSON.stringify(pairs, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `meme-flavor-${flavorId}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const statusChip = (run: ImageRun | undefined) =>
    !run || run.status === 'idle' ? (
      <span className="rounded-full bg-[rgb(var(--gloss)/0.3)] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--muted))]">
        not run
      </span>
    ) : run.status === 'running' ? (
      <span className="text-[10px] font-semibold text-[rgb(var(--primary))]">
        {run.stepLabel ?? 'running'}…
      </span>
    ) : run.status === 'error' ? (
      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
        error
      </span>
    ) : (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
        {run.jokes?.length ?? 0} captions
      </span>
    )

  return (
    <div className="flex flex-col gap-6">
      {/* 1 · Image library */}
      <section className={sectionCard}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">
              1 · Image library ({selectedSet?.slug ?? 'no set'})
            </h2>
            <p className="mt-1 text-xs text-[rgb(var(--muted))]">
              {doneCount} of {setImages.length} images captioned. Click an
              image to inspect its step-by-step outputs.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={setId}
              onChange={(e) => setSetId(Number(e.target.value))}
              className="rounded-md border border-[rgb(var(--gloss)/0.6)] bg-transparent px-2 py-1.5 text-xs dark:border-[rgb(var(--gloss)/0.2)]"
            >
              {imageSets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id} · {s.slug} ({s.images.length} images)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => runMany(notRunYet)}
              disabled={runningAll || !notRunYet.length}
              className={runButton}
            >
              {runningAll
                ? 'Running…'
                : `Run ${notRunYet.length} remaining`}
            </button>
            <button
              type="button"
              onClick={() => runMany(setImages)}
              disabled={runningAll || !setImages.length}
              className={ghostButton}
            >
              Re-run all
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {setImages.map((img) => {
            const run = runs[img.id]
            const expanded = expandedImageId === img.id
            return (
              <div
                key={img.id}
                className={`rounded-lg border p-1.5 ${
                  expanded
                    ? 'border-[rgb(var(--primary))]'
                    : 'border-[rgb(var(--gloss)/0.4)] dark:border-[rgb(var(--gloss)/0.12)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedImageId(expanded ? null : img.id)}
                  className="block w-full"
                >
                  <img
                    src={img.url}
                    alt=""
                    className="aspect-square w-full rounded-md object-cover"
                  />
                </button>
                <div className="mt-1 flex items-center justify-between gap-1">
                  {statusChip(run)}
                  <button
                    type="button"
                    onClick={() => runImage(img)}
                    disabled={run?.status === 'running'}
                    className="text-[10px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] disabled:opacity-40"
                  >
                    {run?.status === 'done' ? 'Re-run' : 'Run'}
                  </button>
                </div>
                {run?.status === 'error' ? (
                  <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                    {run.error}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>

        {expandedImageId ? (
          Object.keys(runs[expandedImageId]?.outputs ?? {}).length ? (
            <div className="mt-3 space-y-2 rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
              <p className={outLabel}>Step outputs</p>
              {orderedSteps.map((step) => (
                <div key={step.id}>
                  <p className="text-[11px] font-semibold">
                    S{step.orderBy}
                    {step.description ? ` — ${step.description}` : ''}
                    {runs[expandedImageId]?.jokesStepOrder === step.orderBy ? (
                      <span className="ml-1 text-[rgb(var(--primary))]">
                        · captions came from here
                      </span>
                    ) : null}
                  </p>
                  <pre className={`${resultPre} mt-1 max-h-64`}>
                    {runs[expandedImageId]?.outputs[String(step.orderBy)] ??
                      '(no output)'}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-[rgb(var(--muted))]">
              No run yet for this image — run the pipeline to inspect its
              step outputs.
            </p>
          )
        ) : null}
      </section>

      {/* 2 · Memes */}
      <section className={sectionCard}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">2 · Memes</h2>
            <p className="mt-1 text-xs text-[rgb(var(--muted))]">
              Every caption the pipeline produced, on its image.
            </p>
          </div>
          <button
            type="button"
            onClick={exportMemesJson}
            disabled={!memes.length}
            className={ghostButton}
            title="Flat [{image_id, image_url, caption, reason}] array across every captioned image"
          >
            Export JSON
          </button>
        </div>
        {memes.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {memes.map((m) => (
              <figure
                key={`${m.image.id}-${m.index}`}
                className="rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.12)]"
              >
                <figcaption className="text-sm font-medium">
                  {m.joke.caption}
                </figcaption>
                <img
                  src={m.image.url}
                  alt=""
                  className="mt-2 w-full rounded-md object-cover"
                />
                {m.joke.reason ? (
                  <p className="mt-1 text-[11px] text-[rgb(var(--muted))]">
                    {m.joke.reason}
                  </p>
                ) : null}
              </figure>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[rgb(var(--muted))]">
            No memes yet — run the pipeline on some images above.
          </p>
        )}
      </section>

      {/* 3 · Steps & prompts */}
      <section className={sectionCard}>
        <h2 className="text-sm font-semibold">3 · Steps &amp; prompts</h2>
        <p className="mt-1 text-xs text-[rgb(var(--muted))]">
          Every step of this flavor, editable. Saving updates the
          flavor&rsquo;s DB step — the next run uses the new prompt.
        </p>
        <div className="mt-3 space-y-2">
          {orderedSteps.map((step) => {
            const open = openStepId === step.id
            return (
              <div
                key={step.id}
                className="rounded-lg border border-[rgb(var(--gloss)/0.4)] dark:border-[rgb(var(--gloss)/0.12)]"
              >
                <button
                  type="button"
                  onClick={() => setOpenStepId(open ? null : step.id)}
                  className="flex w-full items-center justify-between gap-2 p-2 text-left"
                >
                  <span className="text-[13px] font-semibold">
                    {step.description || `Step ${step.orderBy}`}
                  </span>
                  <span className="text-[10px] text-[rgb(var(--muted))]">
                    {step.providerModelId}
                    {step.temperature != null ? ` · temp ${step.temperature}` : ''}
                    {step.includeImage ? ' · image' : ''}
                  </span>
                </button>
                {open ? (
                  <div className="space-y-3 border-t border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.12)]">
                    <div>
                      <p className={outLabel}>System prompt</p>
                      <StepPromptEditor
                        stepId={step.id}
                        flavorId={flavorId}
                        field="systemPrompt"
                        initial={step.systemPrompt}
                        onSaved={(value) =>
                          setSteps((prev) =>
                            prev.map((s) =>
                              s.id === step.id ? { ...s, systemPrompt: value } : s
                            )
                          )
                        }
                      />
                    </div>
                    <div>
                      <p className={outLabel}>User prompt</p>
                      <StepPromptEditor
                        stepId={step.id}
                        flavorId={flavorId}
                        field="userPrompt"
                        initial={step.userPrompt}
                        onSaved={(value) =>
                          setSteps((prev) =>
                            prev.map((s) =>
                              s.id === step.id ? { ...s, userPrompt: value } : s
                            )
                          )
                        }
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
