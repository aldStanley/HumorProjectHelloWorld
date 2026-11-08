'use client'

// The reverse surface: ONE community moment in, ranked images + captions out.
// The flavor's steps split in two by description prefix:
//   P-steps ("P1: ...")  per-image preprocessing (any depth; last one is the
//                        search card), cached as reaction profiles
//                        (image_reaction_profiles) with a prompt hash
//   R-steps ("R1: ...")  per-moment pipeline: analyze moment → select images
//                        vs. the card catalog → write captions per selected
//                        image → rank across images
// LLM execution reuses runStepAction; every reverse variable (momentInput,
// momentAnalysis, imageCatalog, imageScenePack, ...) is passed as a named
// priorOutputs binding, which the server resolver honors before built-ins.
/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { promptHash } from '@/utils/prompt-hash'

import { setStepHiddenAction, updateStepPromptsAction } from '../actions'
import { runStepAction } from '../chiltrix/actions'
import {
  createOpsRunAction,
  finishOpsRunAction,
  finishOpsRunImageAction,
  saveOpsRunStepsAction,
  startOpsRunImageAction,
  type OpsRunStepRecord,
} from '../ops/run-actions'
import {
  saveProfileAction,
  saveStudyResultsAction,
  type ReverseProfile,
  type StudyResultInput,
} from './actions'
import {
  clusterEventsAction,
  listClusteringsAction,
  loadClusteringAction,
  saveClusteringAction,
  type SavedClusteringMeta,
} from '@/app/sidechat-topics/actions'
import type { EventCluster } from '@/app/sidechat-topics/event-clustering'
import {
  clusteringToMoments,
  groupMomentsByEvent,
  SIDECHAT_SINGLE_POST_MIN_UPVOTES,
  toStudyMoment,
} from '@/app/sidechat-topics/sidechat-moments'

export type ReverseStep = {
  id: number
  orderBy: number
  description: string
  systemPrompt: string
  userPrompt: string
  providerModelId: string
  isTemperatureSupported: boolean
  temperature: number | null
  includeImage: boolean
  isHidden: boolean
}

export type ReverseImage = {
  id: string
  url: string
  additionalContext: string | null
  celebrityRecognition: string | null
}

export type ReverseImageSet = {
  id: number
  slug: string
  images: ReverseImage[]
}

export type ReverseCommunityContext = { id: number; content: string }

// Steps split by description prefix: "P1:"... preprocess an image, "R1:"...
// run per moment (any depth — the scene recipe has 5 P-steps). Flavors
// without the prefixes fall back to first-4 / rest.
const PRE_STEP_FALLBACK = 4
// Page size when the image library is expanded to show everything.
const IMAGES_PER_PAGE = 50

// Per-flavor default moment, pre-filled in the moment box on /reverse and
// /ops-reverse.
export const DEFAULT_MOMENTS: Record<number, string> = {
  1548: "During Columbia's summer session, the campus becomes notably quiet and empty, leading many students to feel loneliness and isolation due to the reduced population and closed facilities. This subdued atmosphere contrasts sharply with the vibrant energy of the academic year, making social interactions scarce and the campus less lively. Amid this quietness, Uris Pool notifications unexpectedly gained prominence, becoming a humorous highlight and a rare source of engagement for students. The combination of campus quietness and the quirky focus on pool alerts captures the unique social experience of summer at Columbia, reflecting both the emotional challenges and lighthearted coping mechanisms during this off-peak period.",
}
const isPreStep = (s: ReverseStep) => /^P\d/i.test(s.description)
const isReverseStep = (s: ReverseStep) => /^R\d/i.test(s.description)

export const resultPre =
  'overflow-auto whitespace-pre-wrap rounded-md bg-[rgb(var(--panel)/0.6)] p-2 font-mono text-[11px] leading-snug text-[rgb(var(--ink))] dark:bg-[rgb(var(--panel)/0.2)]'
export const outLabel =
  'text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]'
export const sectionCard =
  'rounded-xl border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.85)] p-4 dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.5)]'
export const runButton =
  'rounded-md bg-[rgb(var(--primary))] px-2.5 py-1 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40'
export const ghostButton =
  'rounded-md border border-[rgb(var(--gloss)/0.6)] px-2.5 py-1 text-xs font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] disabled:opacity-40 dark:border-[rgb(var(--gloss)/0.2)]'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const parseJsonLoose = (value: string): any => {
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

// Run tasks with a small concurrency cap; collect per-task errors rather than
// aborting the batch.
export const runPool = async <T,>(
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

export type RunState = { status: 'idle' | 'loading' | 'done' | 'error'; error?: string }

type PreState = {
  status: 'idle' | 'running' | 'error'
  stepLabel?: string
  error?: string
}

export type R2Pick = {
  image_key: string
  // Unique per selection entry — image_key alone is not: POV-first flavors may
  // cast the same image for two POVs. All per-pick state keys on this.
  pickKey: string
  imageId: string
  entity: string
  is_default_pov: boolean
  emotional_alignment: number
  reason: string
  format_reason: string
  posture_anchor: string | null
  posture_reason: string | null
  reaction_anchor: string | null
  reaction_reason: string | null
  role_anchor: string | null
  role_reason: string | null
  // the selector's full entry, passed through to the caption step so each
  // recipe's R2 can hand its R3 whatever payload shape that R3 expects
  raw: Record<string, unknown>
}

export type Joke = { caption: string; reason: string }

// Tolerant caption extraction across recipe output shapes: 1517-style
// [{jokes: [{caption, reason}]}], 1528-style {captions: [{caption,
// fit_reason, ...}]}, or a bare array of caption entries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const extractJokes = (parsed: any): Joke[] => {
  const fromArr = (arr: unknown): Joke[] =>
    Array.isArray(arr)
      ? arr
          .filter((j) => typeof (j as Joke)?.caption === 'string')
          .map((j) => ({
            caption: String((j as Record<string, unknown>).caption),
            reason: String(
              (j as Record<string, unknown>).reason ??
                (j as Record<string, unknown>).fit_reason ??
                (j as Record<string, unknown>).focus_entity ??
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

export type R3State = {
  status: 'idle' | 'loading' | 'done' | 'error'
  raw?: string
  jokes?: Joke[]
  error?: string
}

// Hidden caption writer: caption-first flavors write captions upstream
// (image-free) and the casting step copies them verbatim into each
// selected_images entry's jokes field — lift them in CODE, no relay LLM call.
export const liftJokesFromPicks = (picks: R2Pick[]): Record<string, Joke[]> => {
  const out: Record<string, Joke[]> = {}
  for (const pick of picks) {
    const jokes = extractJokes(pick.raw)
    if (jokes.length) out[pick.pickKey] = jokes
  }
  return out
}

// Live runs key jokes by PICK (two POVs may share an image); the archive and
// the inspector's trace views key them by IMAGE. Merge back for archiving.
export const archiveJokesByImage = (
  picks: R2Pick[],
  jokesByPick: Record<string, Joke[]>
): Record<string, Joke[]> => {
  const out: Record<string, Joke[]> = {}
  for (const pick of picks) {
    for (const joke of jokesByPick[pick.pickKey] ?? []) {
      ;(out[pick.image_key] ??= []).push(joke)
    }
  }
  return out
}

export type RankedResult = { image_key: string; caption: string }

export type StudyMoment = {
  key: string
  text: string
  custom?: boolean
  // set on moments built from a Sidechat event clustering: the event title
  brainTitle?: string
}

// Which parts of a Sidechat clustering become moments, and their text, is
// the shared chunker in @/app/sidechat-topics/sidechat-moments.ts (one moment
// per reaction group inside an event; whole event when it has no groups).
const SIDECHAT_WINDOW_CHOICES = [3, 7, 14, 30] as const

export type BatchResult = {
  imageKey: string
  imageId: string
  imageUrl: string
  caption: string
  rank: number
  entity: string
  emotionalAlignment: number
}

export type BatchStatus = {
  stage: string
  noFit?: boolean
  error?: string
  saved?: number
  results?: BatchResult[]
}

// Edits one prompt field of a flavor step, saving straight to the DB step —
// same behavior as the ops detail panel.
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
            const res = await updateStepPromptsAction({
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

// The wiring of one step, shown Flavor-Maker style (ops): every ${variable}
// the prompt reads, what it means, and what it is bound to on this surface;
// plus the variable the step's output becomes for later steps.
export type StepIoInput = {
  slot: string
  description: string
  boundTo: string
  optional?: boolean
}
export type StepIo = {
  inputs: StepIoInput[]
  output: { name: string; description: string; isList?: boolean }
  // set when the step runs once per item of this variable (R3 per pick)
  fanOutOver?: string
}

const ioChip =
  'rounded bg-[rgb(var(--primary)/0.12)] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[rgb(var(--accent-strong))]'

// One ops-style step card: meta chips, the ${variables} the step reads,
// inline prompt editors, the resolved prompt actually sent on the last run,
// and the step's output area (children). With `io`, the card takes the full
// Flavor Maker layout: model/temp/takes-image meta on the right, an INPUTS
// wire list with "bound to" lines, an OUTPUT variable, and the run actions
// along the bottom. Without it (the /reverse page) the compact layout stays.
export function StepCard({
  step,
  flavorId,
  inputs,
  io,
  resolved,
  hidden,
  hideDisabled,
  onToggleHidden,
  onSavedPrompt,
  actions,
  children,
}: {
  step: ReverseStep
  flavorId: number
  inputs: string[]
  io?: StepIo
  resolved?: { system?: string; user?: string }
  hidden: boolean
  hideDisabled?: string
  onToggleHidden: () => void
  onSavedPrompt: (field: 'systemPrompt' | 'userPrompt', value: string) => void
  actions?: ReactNode
  children?: ReactNode
}) {
  const hideButton = (
    <button
      type="button"
      onClick={onToggleHidden}
      disabled={Boolean(hideDisabled)}
      title={
        hideDisabled ??
        (hidden
          ? 'Unhide — include this step in runs again (saved to the flavor)'
          : 'Hide — skip this step on every run, single and batch (saved to the flavor)')
      }
      className={ghostButton}
    >
      {hidden ? '👁 Unhide' : '🚫 Hide'}
    </button>
  )
  return (
    <div
      id={`step-card-${step.id}`}
      className={`scroll-mt-4 rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)] ${
        hidden ? 'opacity-60' : ''
      }`}
    >
      {io ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-tight">
              {step.description || `Step ${step.orderBy}`}
            </h3>
            <p className="mt-0.5 text-xs leading-snug text-[rgb(var(--muted))]">
              step {step.orderBy} of the flavor
              {io.fanOutOver ? ` · runs once per \${${io.fanOutOver}}` : ''}
            </p>
            {hidden ? (
              <span className="mt-1 inline-block rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                hidden — skipped on every run
              </span>
            ) : null}
          </div>
          <div className="flex items-start gap-2">
            <span className="text-right font-mono text-[10px] text-[rgb(var(--muted))]">
              {step.providerModelId}
              <br />
              temp:{' '}
              {step.isTemperatureSupported ? step.temperature ?? 0.7 : 'n/a'}
              {io.fanOutOver ? (
                <>
                  <br />
                  <span className="text-[rgb(var(--accent-strong))]">
                    ⑂ per ${`{${io.fanOutOver}}`}
                  </span>
                </>
              ) : null}
              {step.includeImage ? (
                <>
                  <br />
                  <span className="text-[rgb(var(--primary))]">takes image: yes</span>
                </>
              ) : null}
            </span>
            {hideButton}
          </div>
        </div>
      ) : (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[13px] font-semibold">
          {step.description || `Step ${step.orderBy}`}
          <span className="ml-2 text-[10px] font-normal text-[rgb(var(--muted))]">
            {step.providerModelId}
            {step.temperature != null ? ` · temp ${step.temperature}` : ''}
            {step.includeImage ? ' · sees image' : ''}
          </span>
          {hidden ? (
            <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400">
              hidden — skipped on every run
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={onToggleHidden}
            disabled={Boolean(hideDisabled)}
            title={
              hideDisabled ??
              (hidden
                ? 'Unhide — include this step in runs again (saved to the flavor)'
                : 'Hide — skip this step on every run, single and batch (saved to the flavor)')
            }
            className={ghostButton}
          >
            {hidden ? '👁 Unhide' : '🚫 Hide'}
          </button>
        </div>
      </div>
      )}
      {io ? (
        <>
          {/* INPUTS — the wire list, one row per ${variable} the prompt reads */}
          <div className="mt-2">
            <p className={outLabel}>Inputs</p>
            <div className="mt-1 space-y-1">
              {io.inputs.length === 0 ? (
                <p className="rounded-md bg-[rgb(var(--panel)/0.5)] px-2 py-1 text-xs text-[rgb(var(--muted))] dark:bg-[rgb(var(--panel)/0.2)]">
                  none — the prompt reads no ${'{variables}'}
                </p>
              ) : null}
              {io.inputs.map((inp) => (
                <div
                  key={inp.slot}
                  className="rounded-md bg-[rgb(var(--panel)/0.5)] px-2 py-1 dark:bg-[rgb(var(--panel)/0.2)]"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <code className={ioChip}>${`{${inp.slot}}`}</code>
                    {inp.optional ? (
                      <span className="rounded bg-[rgb(var(--panel)/0.7)] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.15em] text-[rgb(var(--muted))] dark:bg-[rgb(var(--panel)/0.3)]">
                        optional
                      </span>
                    ) : null}
                    <span className="text-xs text-[rgb(var(--muted))]">
                      {inp.description}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-1 text-xs">
                    <span className="shrink-0 text-[rgb(var(--muted))]">◀ bound to</span>
                    <span className="min-w-0 rounded bg-[rgb(var(--panel)/0.6)] px-2 py-1 text-[11px] text-[rgb(var(--ink))] dark:bg-[rgb(var(--panel)/0.25)]">
                      {inp.boundTo}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* OUTPUT — the variable this step's result becomes */}
          <div className="mt-2">
            <p className={outLabel}>Output</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <code className={ioChip}>${`{${io.output.name}}`}</code>
              {io.output.isList ? (
                <span className="rounded bg-[rgb(var(--accent-strong)/0.15)] px-1 py-0.5 font-mono text-[9px] font-semibold text-[rgb(var(--accent-strong))]">
                  list
                </span>
              ) : null}
              <span className="text-[rgb(var(--muted))]">{io.output.description}</span>
            </div>
          </div>
          {actions ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </>
      ) : inputs.length ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-[rgb(var(--muted))]">
          reads
          {inputs.map((v) => (
            <code
              key={v}
              className="rounded bg-[rgb(var(--panel)/0.6)] px-1 py-0.5 font-mono dark:bg-[rgb(var(--panel)/0.2)]"
            >
              {'${' + v + '}'}
            </code>
          ))}
        </p>
      ) : null}
      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] font-semibold text-[rgb(var(--accent-strong))]">
          prompts — edit &amp; save to flavor
        </summary>
        <div className="mt-2 space-y-3">
          <div>
            <p className={outLabel}>System prompt</p>
            <StepPromptEditor
              stepId={step.id}
              flavorId={flavorId}
              field="systemPrompt"
              initial={step.systemPrompt}
              onSaved={(value) => onSavedPrompt('systemPrompt', value)}
            />
          </div>
          <div>
            <p className={outLabel}>User prompt</p>
            <StepPromptEditor
              stepId={step.id}
              flavorId={flavorId}
              field="userPrompt"
              initial={step.userPrompt}
              onSaved={(value) => onSavedPrompt('userPrompt', value)}
            />
          </div>
        </div>
      </details>
      {resolved?.system || resolved?.user ? (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[11px] text-[rgb(var(--muted))]">
            resolved prompt actually sent (last run)
          </summary>
          {resolved.system ? (
            <>
              <p className={`${outLabel} mt-1.5`}>system</p>
              <pre className={`${resultPre} mt-1 max-h-56`}>{resolved.system}</pre>
            </>
          ) : null}
          {resolved.user ? (
            <>
              <p className={`${outLabel} mt-1.5`}>user</p>
              <pre className={`${resultPre} mt-1 max-h-72`}>{resolved.user}</pre>
            </>
          ) : null}
        </details>
      ) : null}
      {children}
    </div>
  )
}

export default function ReverseClient({
  flavorId,
  flavorSlug,
  steps: initialSteps,
  imageSets,
  contexts,
  initialProfiles,
  profilesTableMissing,
  initialSetId,
}: {
  flavorId: number
  flavorSlug: string
  steps: ReverseStep[]
  imageSets: ReverseImageSet[]
  contexts: ReverseCommunityContext[]
  initialProfiles: ReverseProfile[]
  profilesTableMissing: boolean
  initialSetId: number | null
}) {
  // Which surface is active: one moment step-by-step, or many moments
  // end-to-end. Chosen up top so both entry points are visible immediately.
  const [mode, setMode] = useState<'single' | 'batch'>('batch')
  // Steps live in state so a saved prompt edit applies to the next run.
  const [steps, setSteps] = useState(initialSteps)
  const preSteps = useMemo(() => {
    const tagged = steps.filter(isPreStep)
    const list = tagged.length
      ? tagged
      : steps.filter((s) => s.orderBy <= PRE_STEP_FALLBACK)
    return [...list].sort((a, b) => a.orderBy - b.orderBy)
  }, [steps])
  const reverseSteps = useMemo(() => {
    const tagged = steps.filter(isReverseStep)
    const list = tagged.length
      ? tagged
      : steps.filter((s) => s.orderBy > PRE_STEP_FALLBACK)
    return [...list].sort((a, b) => a.orderBy - b.orderBy)
  }, [steps])
  // Positional roles: the analyzer is FIRST; selector, caption fan-out, and
  // ranker are always the LAST THREE. Anything between them is a middle step
  // (e.g. the association lens step), run in order between R1 and R2 — the
  // last middle output binds as ${associationLenses} for R2.
  const r1Step = reverseSteps[0]
  const middleSteps = useMemo(
    () => reverseSteps.slice(1, Math.max(1, reverseSteps.length - 3)),
    [reverseSteps]
  )
  const [r2Step, r3Step, r4Step] = reverseSteps.slice(-3)

  // The preprocessing chain actually run: hidden P-steps are skipped, and the
  // LAST visible one produces the search card.
  const activePreSteps = useMemo(
    () => preSteps.filter((s) => !s.isHidden),
    [preSteps]
  )

  // Hash of the CURRENT preprocessing prompts (visible steps only); profiles
  // stamped with a different hash were generated by older prompts / a
  // different chain and show as stale.
  const currentHash = useMemo(
    () =>
      promptHash(activePreSteps.flatMap((s) => [s.systemPrompt, s.userPrompt])),
    [activePreSteps]
  )

  // Persist a step's hide toggle to the flavor (same is_hidden flag the ops
  // page uses); revert the optimistic update if the save fails.
  const toggleStepHidden = (step: ReverseStep) => {
    const nowHidden = !step.isHidden
    setSteps((prev) =>
      prev.map((s) => (s.id === step.id ? { ...s, isHidden: nowHidden } : s))
    )
    void setStepHiddenAction({
      stepId: step.id,
      flavorId,
      hidden: nowHidden,
    }).then((res) => {
      if (!res.ok) {
        setSteps((prev) =>
          prev.map((s) => (s.id === step.id ? { ...s, isHidden: !nowHidden } : s))
        )
      }
    })
  }

  // Steps whose hide toggle is off-limits, with the reason. The caption
  // writer CAN be hidden: caption-first flavors write captions upstream and
  // carry them in the casting step's output, from which the runners lift them
  // in code (see liftJokesFromPicks). Hiding it on a flavor whose casting
  // step carries no captions makes R4 fail with "no caption results to rank".
  const hideDisabledReason = (step: ReverseStep): string | undefined => {
    if (
      isPreStep(step) &&
      !step.isHidden &&
      activePreSteps.length === 1 &&
      activePreSteps[0]?.id === step.id
    ) {
      return 'At least one preprocessing step must stay visible — its output is the search card.'
    }
    return undefined
  }

  const [setId, setSetId] = useState<number | ''>(
    initialSetId ?? imageSets[0]?.id ?? ''
  )
  const selectedSet = imageSets.find((s) => s.id === setId) ?? null

  // Keep the selected set in the URL (?set=…) so the choice is linkable and
  // survives a reload. replaceState avoids a server round-trip.
  useEffect(() => {
    if (setId === '') return
    const url = new URL(window.location.href)
    if (url.searchParams.get('set') !== String(setId)) {
      url.searchParams.set('set', String(setId))
      window.history.replaceState(null, '', url)
    }
  }, [setId])

  const [moment, setMoment] = useState(DEFAULT_MOMENTS[flavorId] ?? '')
  const [profiles, setProfiles] = useState<Record<string, ReverseProfile>>(() =>
    Object.fromEntries(initialProfiles.map((p) => [p.imageId, p]))
  )
  const [preStates, setPreStates] = useState<Record<string, PreState>>({})
  const [preprocessingAll, setPreprocessingAll] = useState(false)
  const [expandedImageId, setExpandedImageId] = useState<string | null>(null)
  // Library display: a short scrollable strip by default, or paginated pages
  // of IMAGES_PER_PAGE when "show all" is on.
  const [showAllImages, setShowAllImages] = useState(false)
  const [imagePage, setImagePage] = useState(0)

  const [r1State, setR1State] = useState<RunState>({ status: 'idle' })
  const [r1Text, setR1Text] = useState<string | null>(null)
  // Middle-step (lens) run state, keyed by step id; lensText is the LAST
  // middle step's output — the ${associationLenses} binding for R2.
  const [middleStates, setMiddleStates] = useState<
    Record<number, RunState & { text?: string }>
  >({})
  const [lensText, setLensText] = useState<string | null>(null)
  // The entity the lens step builds on: picked from R1's prominent_entities
  // or typed; blank → the step's prompt falls back to the first one.
  const [focusEntity, setFocusEntity] = useState('')
  const [r2State, setR2State] = useState<RunState>({ status: 'idle' })
  const [r2Raw, setR2Raw] = useState<string | null>(null)
  const [r2Picks, setR2Picks] = useState<R2Pick[] | null>(null)
  const [r2Warning, setR2Warning] = useState<string | null>(null)
  const [r3States, setR3States] = useState<Record<string, R3State>>({})
  const [r4State, setR4State] = useState<RunState>({ status: 'idle' })
  const [r4Results, setR4Results] = useState<RankedResult[] | null>(null)
  const [runningAll, setRunningAll] = useState(false)

  // Study batch state: how many pairs to keep per moment (R4's ${topN}),
  // which moments are in the study, and per-moment run status.
  const [topN, setTopN] = useState(3)
  const [customMoments, setCustomMoments] = useState<StudyMoment[]>([])
  const [customDraft, setCustomDraft] = useState('')
  const [studySelected, setStudySelected] = useState<Record<string, boolean>>({})
  const [batch, setBatch] = useState<Record<string, BatchStatus>>({})
  const [batchRunning, setBatchRunning] = useState(false)
  // The ops_runs id of the current / most recent archived batch — the target
  // of the "Open in Flavor Inspector" link in the batch results header.
  const [archivedRunId, setArchivedRunId] = useState<string | null>(null)
  // Moments built from a Sidechat event clustering — recent posts grouped by
  // the specific happening behind each one (the same clustering as
  // /sidechat-events). A fresh fetch is archived automatically; archived
  // clusterings load instantly with no model calls.
  const [sidechatMoments, setSidechatMoments] = useState<StudyMoment[]>([])
  const [sidechatLoading, setSidechatLoading] = useState(false)
  const [sidechatError, setSidechatError] = useState<string | null>(null)
  const [sidechatDays, setSidechatDays] = useState<number>(7)
  const [sidechatArchive, setSidechatArchive] = useState<SavedClusteringMeta[]>([])
  const [sidechatArchiveId, setSidechatArchiveId] = useState<string>('')
  // What is currently loaded: the archive name plus the counts behind the rows.
  const [sidechatLoaded, setSidechatLoaded] = useState<{
    name: string
    postCount: number
    eventCount: number
    momentCount: number
  } | null>(null)
  const studyMoments: StudyMoment[] = useMemo(
    () => [
      ...customMoments,
      ...sidechatMoments,
      ...contexts.map((c) => ({ key: `ctx-${c.id}`, text: c.content })),
    ],
    [contexts, customMoments, sidechatMoments]
  )

  const refreshSidechatArchive = async (): Promise<void> => {
    try {
      const res = await listClusteringsAction()
      if (res.ok) {
        setSidechatArchive(res.clusterings)
        setSidechatArchiveId((prev) => prev || res.clusterings[0]?.id || '')
      }
    } catch {
      /* the archive list is best-effort — fetching still works without it */
    }
  }
  useEffect(() => {
    void refreshSidechatArchive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap the Sidechat rows for a clustering's events. Selections on the old
  // rows are cleared first so a stale check never carries over by key.
  const applySidechatClustering = (
    name: string,
    postCount: number,
    clusters: EventCluster[]
  ) => {
    setStudySelected((prev) => {
      const next = { ...prev }
      for (const m of sidechatMoments) delete next[m.key]
      return next
    })
    const moments = clusteringToMoments(clusters)
    setSidechatMoments(moments.map(toStudyMoment))
    setSidechatLoaded({ name, postCount, eventCount: groupMomentsByEvent(moments).length, momentCount: moments.length })
  }

  const fetchSidechatClustering = async (): Promise<void> => {
    setSidechatLoading(true)
    setSidechatError(null)
    try {
      const res = await clusterEventsAction(sidechatDays)
      if (res.ok === false) {
        setSidechatError(res.error)
        return
      }
      if (res.postCount === 0) {
        setSidechatError(
          `No Sidechat posts in the last ${sidechatDays} days (newest post: ${res.newestPostAt ?? 'unknown'}).`
        )
        return
      }
      let name = `fresh ${sidechatDays}-day run (not archived)`
      try {
        const saved = await saveClusteringAction({
          windowDays: sidechatDays,
          windowStart: res.windowStart,
          postCount: res.postCount,
          clusters: res.clusters,
          oneOffs: res.oneOffs,
          newestPostAt: res.newestPostAt,
        })
        if (saved.ok === true) {
          name = saved.saved.name
          setSidechatArchiveId(saved.saved.id)
          void refreshSidechatArchive()
        } else {
          setSidechatError(`Clustered, but not archived: ${saved.error}`)
        }
      } catch (err) {
        setSidechatError(
          `Clustered, but not archived: ${err instanceof Error ? err.message : String(err)}`
        )
      }
      applySidechatClustering(name, res.postCount, res.clusters)
    } catch (err) {
      setSidechatError(err instanceof Error ? err.message : 'Sidechat clustering failed.')
    } finally {
      setSidechatLoading(false)
    }
  }

  const loadSidechatArchived = async (): Promise<void> => {
    if (!sidechatArchiveId) return
    setSidechatLoading(true)
    setSidechatError(null)
    try {
      const res = await loadClusteringAction(sidechatArchiveId)
      if (res.ok === false) {
        setSidechatError(res.error)
        return
      }
      applySidechatClustering(res.name, res.postCount, res.clusters)
    } catch (err) {
      setSidechatError(err instanceof Error ? err.message : 'Archive load failed.')
    } finally {
      setSidechatLoading(false)
    }
  }

  const profileStatus = (imageId: string): 'missing' | 'stale' | 'fresh' => {
    const profile = profiles[imageId]
    if (!profile || !profile.searchCard) return 'missing'
    return profile.promptHash === currentHash ? 'fresh' : 'stale'
  }

  // The variable-substituted prompt text actually sent on each step's LAST
  // run, keyed by step id (for R3's fan-out that's the most recent pick).
  const [resolvedPrompts, setResolvedPrompts] = useState<
    Record<number, { system?: string; user?: string }>
  >({})

  // The active run archive while a batch is running. execStep consults it on
  // every model call, so EVERY call in an archived run leaves a step record —
  // rendered prompts, output, timing. Null outside batch runs (per-image
  // preprocessing pokes, which are cached as profiles instead).
  const archiveRef = useRef<{ push: (rec: OpsRunStepRecord) => void } | null>(
    null
  )

  const execStep = async (
    step: ReverseStep,
    imageId: string,
    priorOutputs: Record<string, string>
  ): Promise<string> => {
    const startedAt = Date.now()
    const res = await runStepAction({
      imageId,
      systemPrompt: step.systemPrompt,
      userPrompt: step.userPrompt,
      providerModelId: step.providerModelId,
      temperature: step.temperature,
      includeImage: step.includeImage,
      isTemperatureSupported: step.isTemperatureSupported,
      priorOutputs,
    })
    // Archive the call exactly as it went out (runStepAction returns the
    // prompts with ${vars} already substituted).
    archiveRef.current?.push({
      opKey: (step.description.trim().split(/[\s:—-]/)[0] || `s${step.orderBy}`).toUpperCase(),
      opTitle: step.description.trim().split('\n')[0].slice(0, 120) || null,
      position: step.orderBy,
      branchIndex: null,
      branchLabel: null,
      humorFlavorStepId: step.id,
      stepOrderBy: step.orderBy,
      providerModelId: step.providerModelId,
      temperature: step.temperature,
      includeImage: step.includeImage,
      systemPrompt: res.resolvedSystemPrompt ?? null,
      userPrompt: res.resolvedUserPrompt ?? null,
      priorOutputs,
      output: res.ok ? res.text ?? null : null,
      error: res.ok ? null : res.error ?? 'Run failed.',
      durationMs: Date.now() - startedAt,
    })
    if (res.resolvedSystemPrompt || res.resolvedUserPrompt) {
      setResolvedPrompts((prev) => ({
        ...prev,
        [step.id]: {
          system: res.resolvedSystemPrompt,
          user: res.resolvedUserPrompt,
        },
      }))
    }
    if (!res.ok || !res.text) {
      throw new Error(res.error ?? 'The step returned no output.')
    }
    return res.text
  }

  // ---- run archive (same ops_runs tables the ops-reverse page writes) ------
  // The archived unit is a MOMENT: one ops_run_images row per moment (image
  // fields null until the run finishes, then set to the top-ranked pick), with
  // the moment text in outputs.momentInput. spec.surface stays 'ops-reverse'
  // because that is what the Flavor Inspector (ops-reverse2) filters on; the
  // spec's origin field records which page actually ran it. Best-effort
  // throughout: a dead archive never blocks the run.
  const reverseRunSpec = () => ({
    surface: 'ops-reverse',
    origin: '/reverse',
    flavorId,
    flavorSlug,
    setId: selectedSet?.id ?? null,
    setSlug: selectedSet?.slug ?? null,
    topN,
    steps: steps.map((s) => ({
      id: s.id,
      orderBy: s.orderBy,
      description: s.description,
      systemPrompt: s.systemPrompt,
      userPrompt: s.userPrompt,
      providerModelId: s.providerModelId,
      temperature: s.temperature,
      includeImage: s.includeImage,
      isHidden: s.isHidden,
    })),
  })

  const startRunArchive = async (label: string, momentCount: number) => {
    const created = await createOpsRunAction({
      flavorId,
      flavorSlug,
      setId: selectedSet?.id ?? null,
      setSlug: selectedSet?.slug ?? null,
      label,
      imageCount: momentCount,
      spec: reverseRunSpec(),
    })
    if (!created.ok || !created.runId) return null
    const runId = created.runId
    let runImageId: string | null = null
    const buffer: OpsRunStepRecord[] = []
    let flushChain: Promise<unknown> = Promise.resolve()
    const flush = () => {
      if (!runImageId || !buffer.length) return
      const batch = buffer.splice(0, buffer.length)
      const id = runImageId
      flushChain = flushChain.then(() =>
        saveOpsRunStepsAction({ runId, runImageId: id, steps: batch }).catch(
          () => undefined
        )
      )
    }
    return {
      runId,
      push: (rec: OpsRunStepRecord) => {
        buffer.push(rec)
        if (buffer.length >= 4) flush()
      },
      beginMoment: async (position: number) => {
        const started = await startOpsRunImageAction({
          runId,
          imageId: null,
          imageUrl: null,
          position,
        })
        runImageId = started.ok && started.runImageId ? started.runImageId : null
      },
      finishMoment: async (opts: {
        status: 'done' | 'error'
        error?: string | null
        outputs: Record<string, unknown>
        finalOutput?: string | null
        captions?: string[] | null
        imageId?: string | null
        imageUrl?: string | null
      }) => {
        flush()
        await flushChain
        if (!runImageId) return
        await finishOpsRunImageAction({
          runImageId,
          status: opts.status,
          error: opts.error ?? null,
          outputs: opts.outputs,
          finalOutput: opts.finalOutput ?? null,
          captions: opts.captions ?? null,
          ...(opts.imageId != null ? { imageId: opts.imageId } : {}),
          ...(opts.imageUrl != null ? { imageUrl: opts.imageUrl } : {}),
        }).catch(() => undefined)
        runImageId = null
      },
      finish: async (opts: {
        status: 'done' | 'error'
        captionCount: number
      }) => {
        flush()
        await flushChain
        await finishOpsRunAction({
          runId,
          status: opts.status,
          exportJson: null,
          exportWarning: null,
          captionCount: opts.captionCount,
        }).catch(() => undefined)
      },
    }
  }

  // ---- preprocessing ------------------------------------------------------

  const preprocessImage = async (image: ReverseImage): Promise<void> => {
    setPreStates((prev) => ({ ...prev, [image.id]: { status: 'running' } }))
    const outputs: Record<string, string> = {}
    try {
      for (const step of activePreSteps) {
        setPreStates((prev) => ({
          ...prev,
          [image.id]: { status: 'running', stepLabel: `P${step.orderBy}` },
        }))
        outputs[String(step.orderBy)] = await execStep(step, image.id, {
          ...outputs,
          celebrityRecognition: image.celebrityRecognition ?? '',
        })
      }
      const lastPre = activePreSteps[activePreSteps.length - 1]
      const card = parseJsonLoose(outputs[String(lastPre?.orderBy)] ?? '')
      if (!card || typeof card !== 'object') {
        throw new Error(
          `P${lastPre?.orderBy} did not return valid JSON — no search card to store.`
        )
      }
      const res = await saveProfileAction({
        flavorId,
        imageId: image.id,
        stepOutputs: outputs,
        searchCard: card,
        promptHash: currentHash,
      })
      if (!res.ok) throw new Error(res.error ?? 'Could not save the profile.')
      setProfiles((prev) => ({
        ...prev,
        [image.id]: {
          imageId: image.id,
          stepOutputs: outputs,
          searchCard: card,
          promptHash: currentHash,
          modifiedAt: new Date().toISOString(),
        },
      }))
      setPreStates((prev) => ({ ...prev, [image.id]: { status: 'idle' } }))
    } catch (err) {
      setPreStates((prev) => ({
        ...prev,
        [image.id]: {
          status: 'error',
          error: err instanceof Error ? err.message : 'Preprocessing failed.',
        },
      }))
    }
  }

  const preprocessMany = async (images: ReverseImage[]): Promise<void> => {
    if (!images.length) return
    setPreprocessingAll(true)
    try {
      await runPool(images, 2, preprocessImage)
    } finally {
      setPreprocessingAll(false)
    }
  }

  // ---- reverse pipeline ---------------------------------------------------

  // The catalog the selection step searches: one entry per profiled image in
  // the selected set, in set order so image keys stay stable across runs.
  const catalog = useMemo(() => {
    if (!selectedSet) return []
    return selectedSet.images
      .map((img, index) => {
        const profile = profiles[img.id]
        if (!profile?.searchCard) return null
        return {
          key: `img${index + 1}`,
          image: img,
          card: profile.searchCard,
          stale: profile.promptHash !== currentHash,
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
  }, [selectedSet, profiles, currentHash])

  const anyImageId = selectedSet?.images[0]?.id

  // ---- state-free pipeline cores, shared by the interactive flow and the
  // study batch runner ----

  const execR1Core = async (momentText: string): Promise<string> => {
    const step = r1Step
    if (!step) throw new Error('R1 step is missing from this flavor.')
    // Hidden analyzer: downstream steps get an empty moment analysis.
    if (step.isHidden) return ''
    if (!anyImageId) throw new Error('Pick an image set first.')
    return execStep(step, anyImageId, { momentInput: momentText })
  }

  // Run the middle steps (between R1 and the selector) in order; each sees
  // momentInput, momentAnalysis, and earlier middle outputs. Returns the LAST
  // visible one's output. Also drives the per-step UI states.
  const execMiddleCore = async (
    momentText: string,
    momentAnalysis: string,
    chosenEntity: string
  ): Promise<string> => {
    const visible = middleSteps.filter((s) => !s.isHidden)
    if (!visible.length) return ''
    if (!anyImageId) throw new Error('Pick an image set first.')
    const priors: Record<string, string> = {
      momentInput: momentText,
      momentAnalysis,
      focusEntity: chosenEntity,
    }
    let last = ''
    for (const step of visible) {
      setMiddleStates((prev) => ({ ...prev, [step.id]: { status: 'loading' } }))
      try {
        const text = await execStep(step, anyImageId, { ...priors })
        priors[String(step.orderBy)] = text
        last = text
        setMiddleStates((prev) => ({
          ...prev,
          [step.id]: { status: 'done', text },
        }))
      } catch (err) {
        setMiddleStates((prev) => ({
          ...prev,
          [step.id]: {
            status: 'error',
            error: err instanceof Error ? err.message : 'Lens step failed.',
          },
        }))
        throw err
      }
    }
    return last
  }

  const runMiddles = async (momentAnalysis: string): Promise<string> => {
    const text = await execMiddleCore(moment.trim(), momentAnalysis, focusEntity)
    setLensText(text)
    return text
  }

  const execR2Core = async (
    momentText: string,
    momentAnalysis: string,
    associationLenses: string
  ): Promise<{ text: string; picks: R2Pick[]; dropped: number }> => {
    const step = r2Step
    if (!step) throw new Error('R2 step is missing from this flavor.')
    if (!anyImageId) throw new Error('Pick an image set first.')
    if (!catalog.length) {
      throw new Error('No profiled images in this set — run preprocessing first.')
    }
    // Hidden selector: every profiled image passes through to the caption
    // step, with no per-image reasoning.
    if (step.isHidden) {
      return {
        text: '(R2 hidden — every profiled image was passed through)',
        picks: catalog.map((e, i) => ({
          image_key: e.key,
          pickKey: `${e.key}#${i}`,
          imageId: e.image.id,
          entity: '',
          is_default_pov: false,
          emotional_alignment: 1,
          reason: 'R2 hidden — no selection was run',
          format_reason: '',
          posture_anchor: null,
          posture_reason: null,
          reaction_anchor: null,
          reaction_reason: null,
          role_anchor: null,
          role_reason: null,
          raw: {},
        })),
        dropped: 0,
      }
    }
    const catalogJson = JSON.stringify(
      catalog.map((e) => ({ image_key: e.key, ...(e.card as object) })),
      null,
      2
    )
    const text = await execStep(step, anyImageId, {
      momentInput: momentText,
      momentAnalysis,
      imageCatalog: catalogJson,
      associationLenses,
    })
    const parsed = parseJsonLoose(text)
    const rawPicks: unknown[] = Array.isArray(parsed?.selected_images)
      ? parsed.selected_images
      : []
    const byKey = new Map(catalog.map((e) => [e.key, e]))
    // Mechanical backstop: only keys that exist in the catalog survive.
    const picks: R2Pick[] = []
    let dropped = 0
    for (const raw of rawPicks) {
      const p = raw as Record<string, unknown>
      const entry = byKey.get(String(p.image_key))
      if (!entry) {
        dropped += 1
        continue
      }
      picks.push({
        image_key: entry.key,
        pickKey: `${entry.key}#${picks.length}`,
        imageId: entry.image.id,
        entity: String(p.entity ?? ''),
        is_default_pov: Boolean(p.is_default_pov),
        emotional_alignment: Number(p.emotional_alignment ?? 0),
        reason: String(p.reason ?? ''),
        format_reason: String(p.format_reason ?? ''),
        posture_anchor: p.posture_anchor == null ? null : String(p.posture_anchor),
        posture_reason: p.posture_reason == null ? null : String(p.posture_reason),
        reaction_anchor: p.reaction_anchor == null ? null : String(p.reaction_anchor),
        reaction_reason: p.reaction_reason == null ? null : String(p.reaction_reason),
        role_anchor: p.role_anchor == null ? null : String(p.role_anchor),
        role_reason: p.role_reason == null ? null : String(p.role_reason),
        raw: p,
      })
    }
    return { text, picks, dropped }
  }

  const execR3Core = async (
    momentText: string,
    pick: R2Pick
  ): Promise<{ text: string; jokes: Joke[] }> => {
    const step = r3Step
    if (!step) throw new Error('R3 step is missing from this flavor.')
    const profile = profiles[pick.imageId]
    if (!profile) throw new Error('No profile for this image.')
    // The caption step's mapping input. If the selector emitted an r3_payload
    // (recipe-specific shape, e.g. the scene recipe's S9-style scored
    // mapping), pass it through verbatim; otherwise reconstruct the 1517
    // Context Selection shape with ONE moment and ONE pre-qualified entity.
    const pairSelection = pick.raw.r3_payload
      ? JSON.stringify(pick.raw.r3_payload, null, 2)
      : JSON.stringify(
          {
            relevant_cu_context_selected: [
              {
                context: momentText,
                entities: [
                  {
                    entity: pick.entity,
                    is_default_pov: pick.is_default_pov,
                    emotional_alignment: pick.emotional_alignment,
                    reason: pick.reason,
                    posture_anchor: pick.posture_anchor,
                    posture_reason: pick.posture_reason,
                    reaction_anchor: pick.reaction_anchor,
                    reaction_reason: pick.reaction_reason,
                    role_anchor: pick.role_anchor,
                    role_reason: pick.role_reason,
                  },
                ],
              },
            ],
          },
          null,
          2
        )
    // Profile outputs resolve BOTH as ${stepNOutput} (numeric keys, matching
    // each preprocessing step's position) and as the legacy named slots.
    const profilePriors: Record<string, string> = {}
    for (const preStep of activePreSteps) {
      profilePriors[String(preStep.orderBy)] =
        profile.stepOutputs[String(preStep.orderBy)] ?? ''
    }
    const text = await execStep(step, pick.imageId, {
      ...profilePriors,
      imageScenePack: profilePriors['1'] ?? '',
      imageInterpretation: profilePriors['2'] ?? '',
      imagePunchlineConstraint: profilePriors['3'] ?? '',
      pairSelection,
      momentInput: momentText,
    })
    const jokes = extractJokes(parseJsonLoose(text))
    if (!jokes.length) {
      throw new Error('The caption writer returned no parsable jokes.')
    }
    return { text, jokes }
  }

  // jokesByKey is keyed by PICK (pickKey), not image — two POVs may share an
  // image, and each pick's jokes must stay its own candidate for the ranker.
  const execR4Core = async (
    picks: R2Pick[],
    jokesByKey: Record<string, Joke[]>,
    topNValue: number
  ): Promise<{ text: string; results: RankedResult[] }> => {
    const step = r4Step
    if (!step) throw new Error('R4 step is missing from this flavor.')
    if (!anyImageId) throw new Error('Pick an image set first.')
    const candidates = picks
      .filter((p) => jokesByKey[p.pickKey]?.length)
      .map((p) => ({
        image_key: p.image_key,
        entity: p.entity,
        emotional_alignment: p.emotional_alignment,
        jokes: jokesByKey[p.pickKey],
      }))
    if (!candidates.length) throw new Error('No caption results to rank.')
    // Hidden ranker: keep captions unranked, one per image per round, capped
    // at topN.
    if (step.isHidden) {
      const results: RankedResult[] = []
      for (let level = 0; results.length < topNValue; level += 1) {
        let added = false
        for (const c of candidates) {
          const joke = c.jokes[level]
          if (!joke || results.length >= topNValue) continue
          results.push({ image_key: c.image_key, caption: joke.caption })
          added = true
        }
        if (!added) break
      }
      if (!results.length) throw new Error('No captions to keep.')
      return { text: '(R4 hidden — captions kept unranked)', results }
    }
    const text = await execStep(step, anyImageId, {
      allCaptionResults: JSON.stringify(candidates, null, 2),
      topN: String(topNValue),
    })
    const parsed = parseJsonLoose(text)
    const valid = new Set(picks.map((p) => p.image_key))
    // Mechanical backstops: keys must exist, captions must be verbatim from
    // that image's jokes (merged across the picks sharing it), no duplicate
    // caption strings, cap at topN.
    const jokesByImage: Record<string, Joke[]> = {}
    for (const c of candidates) {
      ;(jokesByImage[c.image_key] ??= []).push(...c.jokes)
    }
    const seenCaptions = new Set<string>()
    const results: RankedResult[] = []
    for (const raw of Array.isArray(parsed) ? parsed : []) {
      const r = raw as RankedResult
      if (typeof r?.caption !== 'string') continue
      const key = String(r.image_key)
      if (!valid.has(key)) continue
      const isVerbatim = (jokesByImage[key] ?? []).some(
        (j) => j.caption === r.caption
      )
      if (!isVerbatim || seenCaptions.has(r.caption)) continue
      seenCaptions.add(r.caption)
      results.push({ image_key: key, caption: r.caption })
      if (results.length >= topNValue) break
    }
    if (!results.length) {
      throw new Error('The ranker returned no parsable results.')
    }
    return { text, results }
  }

  // ---- interactive wrappers (surface state on the step cards) ----

  const runR1 = async (): Promise<string> => {
    if (!moment.trim()) throw new Error('Write or pick a moment first.')
    setR1State({ status: 'loading' })
    try {
      const text = await execR1Core(moment.trim())
      setR1Text(text)
      setR1State({ status: 'done' })
      return text
    } catch (err) {
      const message = err instanceof Error ? err.message : 'R1 failed.'
      setR1State({ status: 'error', error: message })
      throw err
    }
  }

  const runR2 = async (
    momentAnalysis: string,
    associationLenses: string
  ): Promise<R2Pick[]> => {
    setR2State({ status: 'loading' })
    setR2Warning(null)
    try {
      const { text, picks, dropped } = await execR2Core(
        moment.trim(),
        momentAnalysis,
        associationLenses
      )
      setR2Raw(text)
      if (dropped > 0) {
        setR2Warning(
          `${dropped} selection(s) referenced image keys not in the catalog and were dropped.`
        )
      }
      setR2Picks(picks)
      setR3States({})
      setR4Results(null)
      setR2State({ status: 'done' })
      return picks
    } catch (err) {
      const message = err instanceof Error ? err.message : 'R2 failed.'
      setR2State({ status: 'error', error: message })
      throw err
    }
  }

  const runR3ForPick = async (pick: R2Pick): Promise<Joke[]> => {
    setR3States((prev) => ({ ...prev, [pick.pickKey]: { status: 'loading' } }))
    try {
      const { text, jokes } = await execR3Core(moment.trim(), pick)
      setR3States((prev) => ({
        ...prev,
        [pick.pickKey]: { status: 'done', raw: text, jokes },
      }))
      return jokes
    } catch (err) {
      const message = err instanceof Error ? err.message : 'R3 failed.'
      setR3States((prev) => ({
        ...prev,
        [pick.pickKey]: { status: 'error', error: message },
      }))
      throw err
    }
  }

  const runR4 = async (
    picks: R2Pick[],
    jokesByKey: Record<string, Joke[]>
  ): Promise<void> => {
    setR4State({ status: 'loading' })
    try {
      const { results } = await execR4Core(picks, jokesByKey, topN)
      setR4Results(results)
      setR4State({ status: 'done' })
    } catch (err) {
      setR4State({
        status: 'error',
        error: err instanceof Error ? err.message : 'R4 failed.',
      })
    }
  }

  // Run from a stage to the end, reusing earlier stages' existing outputs.
  // Stages: 1 = R1, 1.5 = middle (lens) steps, 2 = R2, 3 = R3, 4 = R4.
  // Hidden steps are skipped via their cores' fallbacks.
  const runFromStep = async (start: number): Promise<void> => {
    setRunningAll(true)
    try {
      let analysis = r1Text ?? ''
      if (start <= 1) analysis = await runR1()
      let lenses = lensText ?? ''
      if (start <= 1.5) lenses = await runMiddles(analysis)
      let picks = r2Picks ?? []
      if (start <= 2) picks = await runR2(analysis, lenses)
      if (!picks.length) return
      const jokesByKey: Record<string, Joke[]> = {}
      if (r3Step?.isHidden) {
        // Hidden writer: captions ride in the casting output — lift verbatim.
        Object.assign(jokesByKey, liftJokesFromPicks(picks))
        setR3States(
          Object.fromEntries(
            picks
              .filter((p) => jokesByKey[p.pickKey]?.length)
              .map((p) => [
                p.pickKey,
                { status: 'done' as const, jokes: jokesByKey[p.pickKey] },
              ])
          )
        )
      } else if (start <= 3) {
        await runPool(picks, 2, async (pick) => {
          try {
            jokesByKey[pick.pickKey] = await runR3ForPick(pick)
          } catch {
            // per-image failure already surfaced in r3States; keep ranking rest
          }
        })
      } else {
        for (const pick of picks) {
          const jokes = r3States[pick.pickKey]?.jokes
          if (jokes?.length) jokesByKey[pick.pickKey] = jokes
        }
      }
      await runR4(picks, jokesByKey)
    } catch {
      // the failing step already holds the error message
    } finally {
      setRunningAll(false)
    }
  }

  const runAll = (): Promise<void> => runFromStep(1)

  // ---- study batch: run a hand-picked list of moments headlessly, save each
  // moment's ranked results as captions rows as it completes ----

  const runStudyBatch = async (): Promise<void> => {
    const list = studyMoments.filter((m) => studySelected[m.key])
    if (!list.length || batchRunning) return
    const rankStepId = r4Step?.id
    setBatchRunning(true)
    // One archived ops_runs row for the whole batch, one moment row per
    // moment — the same record ops-reverse leaves, so the batch is openable in
    // the Flavor Inspector (ops-reverse2).
    const archive = await startRunArchive(
      `${flavorSlug} · /reverse batch · ${list.length} moment${list.length === 1 ? '' : 's'}`,
      list.length
    )
    archiveRef.current = archive
    setArchivedRunId(archive?.runId ?? null)
    let captionTotal = 0
    let anyError = false
    try {
      for (const [position, m] of list.entries()) {
        const setStage = (stage: string) =>
          setBatch((prev) => ({ ...prev, [m.key]: { ...prev[m.key], stage } }))
        setBatch((prev) => ({ ...prev, [m.key]: { stage: 'R1' } }))
        if (archive) await archive.beginMoment(position)
        const momentOutputs: Record<string, unknown> = { momentInput: m.text }
        try {
          const analysis = await execR1Core(m.text)
          momentOutputs.momentAnalysis = analysis
          let lenses = ''
          if (middleSteps.some((s) => !s.isHidden)) {
            setStage('lens')
            lenses = await execMiddleCore(m.text, analysis, '')
          }
          momentOutputs.associationLenses = lenses
          setStage('R2')
          const { picks } = await execR2Core(m.text, analysis, lenses)
          momentOutputs.picks = picks.map((p) => p.raw)
          if (!picks.length) {
            momentOutputs.noFit = true
            setBatch((prev) => ({
              ...prev,
              [m.key]: { stage: 'done', noFit: true },
            }))
            await archive?.finishMoment({ status: 'done', outputs: momentOutputs })
            continue
          }
          const jokesByKey: Record<string, Joke[]> = {}
          if (r3Step?.isHidden) {
            // Hidden writer: captions ride in the casting output — lift them.
            Object.assign(jokesByKey, liftJokesFromPicks(picks))
          } else {
            let doneCount = 0
            setStage(`R3 0/${picks.length}`)
            await runPool(picks, 2, async (pick) => {
              try {
                jokesByKey[pick.pickKey] = (await execR3Core(m.text, pick)).jokes
              } catch {
                // count this image out; the rest still rank
              } finally {
                doneCount += 1
                setStage(`R3 ${doneCount}/${picks.length}`)
              }
            })
          }
          momentOutputs.jokesByKey = archiveJokesByImage(picks, jokesByKey)
          setStage('R4')
          const { results } = await execR4Core(picks, jokesByKey, topN)
          // Attribute each ranked caption to the pick that WROTE it (captions
          // are verbatim, so ownership is exact) — an image_key lookup would
          // mislabel the entity when two POVs share an image.
          const ownerByCaption = new Map<string, R2Pick>()
          for (const pick of picks) {
            for (const joke of jokesByKey[pick.pickKey] ?? []) {
              if (!ownerByCaption.has(joke.caption)) {
                ownerByCaption.set(joke.caption, pick)
              }
            }
          }
          const withImages = results.map((r, index) => ({
            imageKey: r.image_key,
            imageId: imageByKey.get(r.image_key)?.id ?? '',
            imageUrl: imageByKey.get(r.image_key)?.url ?? '',
            caption: r.caption,
            rank: index + 1,
            entity: ownerByCaption.get(r.caption)?.entity ?? '',
            emotionalAlignment:
              ownerByCaption.get(r.caption)?.emotional_alignment ?? 0,
          }))
          momentOutputs.results = withImages
          let saved: number | undefined
          if (rankStepId != null) {
            setStage('saving')
            const toSave: StudyResultInput[] = withImages.map((r) => ({
              imageId: r.imageId,
              caption: r.caption,
              rank: r.rank,
              entity: r.entity,
              emotionalAlignment: r.emotionalAlignment,
            }))
            const res = await saveStudyResultsAction({
              flavorId,
              rankStepId,
              moment: m.text,
              results: toSave.filter((r) => r.imageId),
            })
            if (!res.ok) throw new Error(res.error ?? 'Saving failed.')
            saved = res.savedCount
          }
          setBatch((prev) => ({
            ...prev,
            [m.key]: { stage: 'done', results: withImages, saved },
          }))
          captionTotal += withImages.length
          await archive?.finishMoment({
            status: 'done',
            outputs: momentOutputs,
            finalOutput: JSON.stringify(withImages, null, 2),
            captions: withImages.map((r) => r.caption),
            imageId: withImages[0]?.imageId || null,
            imageUrl: withImages[0]?.imageUrl || null,
          })
        } catch (err) {
          anyError = true
          const message = err instanceof Error ? err.message : 'Failed.'
          setBatch((prev) => ({
            ...prev,
            [m.key]: { stage: 'error', error: message },
          }))
          await archive?.finishMoment({
            status: 'error',
            error: message,
            outputs: momentOutputs,
          })
        }
      }
    } finally {
      archiveRef.current = null
      await archive?.finish({
        status: anyError ? 'error' : 'done',
        captionCount: captionTotal,
      })
      setBatchRunning(false)
    }
  }

  // Bulk-add pasted contexts as custom moments: blank-line separated when the
  // paste contains a blank line (multi-line contexts), otherwise one per line.
  const addManyMoments = () => {
    const draft = customDraft.trim()
    if (!draft) return
    const parts = (/\n\s*\n/.test(draft) ? draft.split(/\n\s*\n/) : draft.split('\n'))
      .map((t) => t.trim())
      .filter(Boolean)
    if (!parts.length) return
    const added = parts.map((text, i) => ({
      key: `custom-${customMoments.length + 1 + i}-${text.length}`,
      text,
      custom: true,
    }))
    setCustomMoments((prev) => [...prev, ...added])
    setStudySelected((prev) => ({
      ...prev,
      ...Object.fromEntries(added.map((m) => [m.key, true])),
    }))
    setCustomDraft('')
  }

  // Flat pair list across every selected moment, with the image URL in the
  // image_id field: [{image_id: <url>, caption}].
  const exportUrlCaptionJson = () => {
    const pairs = studyMoments
      .filter((m) => studySelected[m.key])
      .flatMap((m) => batch[m.key]?.results ?? [])
      .filter((r) => r.imageUrl && r.caption)
      .map((r) => ({ image_id: r.imageUrl, caption: r.caption }))
    const blob = new Blob([JSON.stringify(pairs, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `reverse-url-caption-flavor-${flavorId}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // Flat pair list in the shape chucklesome's Quick Study importer accepts
  // (an array of {image_id, caption}) — paste or upload it on /study-quick.
  const exportQuickStudyJson = () => {
    const pairs = studyMoments
      .filter((m) => studySelected[m.key])
      .flatMap((m) => batch[m.key]?.results ?? [])
      .filter((r) => r.imageId && r.caption)
      .map((r) => ({ image_id: r.imageId, caption: r.caption }))
    const blob = new Blob([JSON.stringify(pairs, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `quick-study-flavor-${flavorId}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const exportStudyJson = () => {
    const list = studyMoments.filter((m) => studySelected[m.key])
    const payload = list.map((m) => ({
      moment: m.text,
      status: batch[m.key]?.stage ?? 'not run',
      no_fit: batch[m.key]?.noFit ?? false,
      error: batch[m.key]?.error ?? null,
      results: (batch[m.key]?.results ?? []).map((r) => ({
        rank: r.rank,
        caption: r.caption,
        entity: r.entity,
        emotional_alignment: r.emotionalAlignment,
        image_id: r.imageId,
        image_url: r.imageUrl,
      })),
    }))
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `reverse-study-flavor-${flavorId}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ---- rendering ----------------------------------------------------------

  const imageByKey = new Map(catalog.map((e) => [e.key, e.image]))

  // Entities parsed from R1's output, offered as one-click picks for the
  // lens step's chosen entity.
  const prominentEntities = useMemo(() => {
    const parsed = parseJsonLoose(r1Text ?? '')
    const list: unknown[] = Array.isArray(parsed?.prominent_entities)
      ? parsed.prominent_entities
      : []
    return list
      .map((e) => String((e as Record<string, unknown>)?.entity ?? ''))
      .filter(Boolean)
  }, [r1Text])

  // Rail/workbench helpers: a step's live run status, its dot color, and the
  // steps-state updater handed to each card's prompt editors.
  const stepRunStatus = (
    step: ReverseStep
  ): 'idle' | 'loading' | 'done' | 'error' => {
    if (step.id === r1Step?.id) return r1State.status
    if (step.id === r2Step?.id) return r2State.status
    if (step.id === r3Step?.id) {
      const states = Object.values(r3States)
      if (states.some((s) => s.status === 'loading')) return 'loading'
      if (states.some((s) => s.status === 'error')) return 'error'
      if (states.some((s) => s.status === 'done')) return 'done'
      return 'idle'
    }
    if (step.id === r4Step?.id) return r4State.status
    if (middleSteps.some((s) => s.id === step.id)) {
      return middleStates[step.id]?.status ?? 'idle'
    }
    return preprocessingAll && !step.isHidden ? 'loading' : 'idle'
  }
  const statusDotClass = (s: 'idle' | 'loading' | 'done' | 'error') =>
    s === 'loading'
      ? 'animate-pulse bg-[rgb(var(--primary))]'
      : s === 'done'
        ? 'bg-emerald-500'
        : s === 'error'
          ? 'bg-red-500'
          : 'bg-[rgb(var(--muted))]/40'
  const applyPromptSave =
    (stepId: number) =>
    (field: 'systemPrompt' | 'userPrompt', value: string) =>
      setSteps((prev) =>
        prev.map((s) => (s.id === stepId ? { ...s, [field]: value } : s))
      )
  const railRow = (s: ReverseStep) => (
    <div
      key={s.id}
      className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px]"
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(stepRunStatus(s))}`}
      />
      <button
        type="button"
        onClick={() =>
          document
            .getElementById(`step-card-${s.id}`)
            ?.scrollIntoView({ behavior: 'smooth' })
        }
        className={`min-w-0 flex-1 truncate text-left transition hover:text-[rgb(var(--accent-strong))] ${
          s.isHidden ? 'line-through opacity-50' : ''
        }`}
        title={s.description}
      >
        {s.description || `Step ${s.orderBy}`}
      </button>
      <button
        type="button"
        onClick={() => toggleStepHidden(s)}
        disabled={Boolean(hideDisabledReason(s))}
        title={
          hideDisabledReason(s) ??
          (s.isHidden ? 'Unhide' : 'Hide — skip this step on every run')
        }
        className="shrink-0 opacity-70 transition hover:opacity-100 disabled:opacity-30"
      >
        {s.isHidden ? '🚫' : '👁'}
      </button>
    </div>
  )
  const setImages = selectedSet?.images ?? []
  const counts = setImages.reduce(
    (acc, img) => {
      acc[profileStatus(img.id)] += 1
      return acc
    },
    { missing: 0, stale: 0, fresh: 0 }
  )
  const needsWork = setImages.filter((img) => profileStatus(img.id) !== 'fresh')
  const imagePageCount = Math.max(1, Math.ceil(setImages.length / IMAGES_PER_PAGE))
  const currentImagePage = Math.min(imagePage, imagePageCount - 1)
  const visibleImages = showAllImages
    ? setImages.slice(
        currentImagePage * IMAGES_PER_PAGE,
        (currentImagePage + 1) * IMAGES_PER_PAGE
      )
    : setImages

  // Batch-run rollup for the results section: every moment that has entered
  // the batch, in study-list order, plus stage counts for the progress bar.
  const batchMoments = studyMoments.filter((m) => batch[m.key])
  const selectedCount = studyMoments.filter((m) => studySelected[m.key]).length
  const batchCounts = batchMoments.reduce(
    (acc, m) => {
      const s = batch[m.key]
      if (s?.stage === 'done') {
        if (s.noFit) acc.noFit += 1
        else acc.done += 1
      } else if (s?.stage === 'error') acc.error += 1
      else acc.running += 1
      return acc
    },
    { done: 0, noFit: 0, error: 0, running: 0 }
  )
  const batchFinished = batchCounts.done + batchCounts.noFit + batchCounts.error
  const anyExportable = studyMoments.some(
    (m) => studySelected[m.key] && batch[m.key]?.stage === 'done'
  )

  // The three moment sources for the batch picker; any mix can be selected.
  const defaultMoments = studyMoments.filter((m) => m.key.startsWith('ctx-'))

  const selectMoments = (items: StudyMoment[], value: boolean) =>
    setStudySelected((prev) => ({
      ...prev,
      ...Object.fromEntries(items.map((item) => [item.key, value])),
    }))

  // One checkbox row of the batch picker, shared by all three source panels.
  const renderMomentRow = (m: StudyMoment) => {
    const status = batch[m.key]
    return (
      <div
        key={m.key}
        className="rounded-md border border-transparent px-1.5 py-1 text-xs hover:border-[rgb(var(--gloss)/0.4)]"
      >
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={Boolean(studySelected[m.key])}
            disabled={batchRunning}
            onChange={(e) =>
              setStudySelected((prev) => ({
                ...prev,
                [m.key]: e.target.checked,
              }))
            }
            className="mt-0.5"
          />
          <span className="min-w-0 flex-1">
            {m.brainTitle ? (
              <span className="mr-1 rounded-full bg-[rgb(var(--primary))]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[rgb(var(--primary))]">
                {m.brainTitle}
              </span>
            ) : null}
            {m.text}
          </span>
          {status ? (
            <span
              className={`shrink-0 text-[10px] font-semibold ${
                status.stage === 'error'
                  ? 'text-red-600 dark:text-red-400'
                  : status.stage === 'done'
                    ? status.noFit
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                    : 'text-[rgb(var(--primary))]'
              }`}
            >
              {status.stage === 'done'
                ? status.noFit
                  ? 'no fit ≥ 0.8'
                  : `done${status.saved != null ? ` · ${status.saved} saved` : ''}`
                : status.stage === 'error'
                  ? `error: ${status.error}`
                  : `${status.stage}…`}
            </span>
          ) : null}
        </div>
      </div>
    )
  }

  const statusChip = (status: 'missing' | 'stale' | 'fresh') =>
    status === 'fresh' ? (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
        fresh
      </span>
    ) : status === 'stale' ? (
      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
        stale
      </span>
    ) : (
      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
        no profile
      </span>
    )

  return (
    <div className="flex flex-col gap-6">
      {profilesTableMissing ? (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
          The <code>image_reaction_profiles</code> table does not exist yet in
          this database. Run{' '}
          <code>
            supabase/migrations/20260719000000_image_reaction_profiles.sql
          </code>{' '}
          in the Supabase SQL editor, then reload this page. Preprocessing
          cannot be saved until then.
        </div>
      ) : null}

      {/* Mode: single vs batch */}
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            {
              key: 'single' as const,
              title: 'Single run',
              detail:
                'One moment through R1→R4, step by step, with every intermediate output inspectable.',
            },
            {
              key: 'batch' as const,
              title: 'Batch run',
              detail:
                'Many moments end-to-end: pick or paste a list, run them all, review the ranked pairs, save + export for a study.',
            },
          ] as const
        ).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            className={`rounded-xl border p-4 text-left transition ${
              mode === m.key
                ? 'border-[rgb(var(--primary))] bg-[rgb(var(--primary))]/10'
                : 'border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.85)] hover:border-[rgb(var(--primary))]/50 dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.5)]'
            }`}
          >
            <span
              className={`block text-sm font-semibold ${
                mode === m.key ? 'text-[rgb(var(--primary))]' : ''
              }`}
            >
              {m.title}
            </span>
            <span className="mt-1 block text-xs text-[rgb(var(--muted))]">
              {m.detail}
            </span>
          </button>
        ))}
      </div>

      {/* 1 · Moment + corpus (single run) */}
      {mode === 'single' ? (
        <section className={sectionCard}>
          <h2 className="text-sm font-semibold">1 · The moment</h2>
          <p className="mt-1 text-xs text-[rgb(var(--muted))]">
            The single piece of community context to find reaction images for.
            Type one, or start from an existing community context.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <textarea
              value={moment}
              onChange={(e) => setMoment(e.target.value)}
              rows={3}
              placeholder="e.g. The Lerner ramps become an ice rink every time it rains."
              className={`${resultPre} block w-full resize-y text-[13px] focus:border-[rgb(var(--primary))] focus:outline-none sm:flex-1`}
            />
            <div className="flex flex-col gap-2 sm:w-72">
              <select
                value=""
                onChange={(e) => {
                  const picked = contexts.find(
                    (c) => c.id === Number(e.target.value)
                  )
                  if (picked) setMoment(picked.content)
                }}
                className="rounded-md border border-[rgb(var(--gloss)/0.6)] bg-transparent px-2 py-1.5 text-xs dark:border-[rgb(var(--gloss)/0.2)]"
              >
                <option value="">Pick a community context…</option>
                {contexts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.content.length > 90 ? `${c.content.slice(0, 90)}…` : c.content}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={runAll}
                disabled={
                  runningAll ||
                  preprocessingAll ||
                  !moment.trim() ||
                  !catalog.length
                }
                className={runButton}
              >
                {runningAll ? 'Running R1→R4…' : 'Run reverse pipeline (R1→R4)'}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {/* 1 · Moments (batch run) */}
      {mode === 'batch' ? (
      <section className={sectionCard}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">1 · Moments</h2>
            <p className="mt-1 text-xs text-[rgb(var(--muted))]">
              Three ways to add moments to the batch — mix and match all three.
              Every checked moment, from any source, runs through R1→R4.
            </p>
          </div>
          <p className="text-xs font-semibold">
            {selectedCount} moment{selectedCount === 1 ? '' : 's'} selected
          </p>
        </div>

        <div className="mt-3 space-y-3">
          {/* Source 1: write your own */}
          <div className="rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold">① Write your own</p>
                <p className="text-[11px] text-[rgb(var(--muted))]">
                  One moment per line (blank-line separated also works). Added
                  moments are checked automatically.
                </p>
              </div>
              {customMoments.length ? (
                <span className="flex items-center gap-2 text-[11px] text-[rgb(var(--muted))]">
                  {customMoments.length} added
                  <button
                    type="button"
                    onClick={() => selectMoments(customMoments, true)}
                    disabled={batchRunning}
                    className="font-semibold text-[rgb(var(--primary))] transition hover:brightness-110 disabled:opacity-40"
                  >
                    all
                  </button>
                  ·
                  <button
                    type="button"
                    onClick={() => selectMoments(customMoments, false)}
                    disabled={batchRunning}
                    className="font-semibold text-[rgb(var(--primary))] transition hover:brightness-110 disabled:opacity-40"
                  >
                    none
                  </button>
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-col gap-2">
              <textarea
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                rows={3}
                placeholder={
                  'The Lerner ramps become an ice rink every time it rains.\nJohn Jay runs out of chicken tenders by 6pm.\n(one moment per line)'
                }
                className={`${resultPre} block w-full resize-y text-[12px] focus:border-[rgb(var(--primary))] focus:outline-none`}
              />
              <button
                type="button"
                onClick={addManyMoments}
                disabled={!customDraft.trim()}
                className="self-start rounded-lg bg-[rgb(var(--primary))] px-5 py-2 text-sm font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
              >
                Add moments
              </button>
            </div>
            {customMoments.length ? (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.12)]">
                {customMoments.map(renderMomentRow)}
              </div>
            ) : null}
          </div>

          {/* Source 2: Sidechat event clusters */}
          <div className="rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold">
                  ② Recent Sidechat events (posts clustered by happening)
                </p>
                <p className="text-[11px] text-[rgb(var(--muted))]">
                  Recent Sidechat posts grouped by the specific event behind each
                  one. Fetch a fresh window (it is archived automatically) or
                  load an archived clustering, then check the events you want in
                  the batch. Each reaction group inside an event is one moment
                  (event, reaction, top posts); an event with no groups is one
                  moment. Events with one post are included only at{' '}
                  {SIDECHAT_SINGLE_POST_MIN_UPVOTES}+ upvotes.
                </p>
              </div>
              {sidechatMoments.length ? (
                <span className="flex items-center gap-2 text-[11px] text-[rgb(var(--muted))]">
                  {sidechatMoments.length} events
                  <button
                    type="button"
                    onClick={() => selectMoments(sidechatMoments, true)}
                    disabled={batchRunning}
                    className="font-semibold text-[rgb(var(--primary))] transition hover:brightness-110 disabled:opacity-40"
                  >
                    all
                  </button>
                  ·
                  <button
                    type="button"
                    onClick={() => selectMoments(sidechatMoments, false)}
                    disabled={batchRunning}
                    className="font-semibold text-[rgb(var(--primary))] transition hover:brightness-110 disabled:opacity-40"
                  >
                    none
                  </button>
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={fetchSidechatClustering}
                disabled={sidechatLoading || batchRunning}
                className="rounded-lg bg-[rgb(var(--accent-strong))] px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
                title="Fetch the last N days of Sidechat posts from the Student Brain feed, cluster them by event (two to three minutes for 7 days), and archive the result"
              >
                {sidechatLoading
                  ? 'Fetching and clustering…'
                  : `▶ Fetch last ${sidechatDays} days of Sidechat and cluster`}
              </button>
              <label className="text-xs text-[rgb(var(--muted))]">
                Days back:{' '}
                <select
                  value={sidechatDays}
                  onChange={(e) => setSidechatDays(Number(e.target.value))}
                  disabled={sidechatLoading || batchRunning}
                  className="rounded-md border border-[rgb(var(--gloss)/0.6)] bg-transparent px-2 py-1 text-xs dark:border-[rgb(var(--gloss)/0.2)]"
                >
                  {SIDECHAT_WINDOW_CHOICES.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </label>
              {sidechatArchive.length ? (
                <label className="flex items-center gap-2 text-xs text-[rgb(var(--muted))]">
                  Or load an archived clustering:
                  <select
                    value={sidechatArchiveId}
                    onChange={(e) => setSidechatArchiveId(e.target.value)}
                    disabled={sidechatLoading || batchRunning}
                    className="max-w-[18rem] rounded-md border border-[rgb(var(--gloss)/0.6)] bg-transparent px-2 py-1 text-xs dark:border-[rgb(var(--gloss)/0.2)]"
                  >
                    {sidechatArchive.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.windowDays}d · {a.postCount} posts
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={loadSidechatArchived}
                    disabled={sidechatLoading || batchRunning || !sidechatArchiveId}
                    className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-3 py-1.5 text-xs font-semibold text-[rgb(var(--accent-strong))] transition hover:brightness-110 disabled:opacity-40 dark:border-[rgb(var(--gloss)/0.2)]"
                  >
                    Load archived
                  </button>
                </label>
              ) : null}
            </div>
            {sidechatLoading ? (
              <p className="mt-2 text-xs text-[rgb(var(--muted))]">
                Naming the event behind each post, merging same-event names, then
                splitting any lumps. A fresh 7-day window takes two to three minutes.
              </p>
            ) : null}
            {sidechatLoaded ? (
              <p className="mt-2 text-xs text-[rgb(var(--muted))]">
                Loaded &ldquo;{sidechatLoaded.name}&rdquo;: {sidechatLoaded.postCount} posts,{' '}
                {sidechatLoaded.momentCount} moments across {sidechatLoaded.eventCount} events shown below.
              </p>
            ) : null}
            {sidechatError ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                Sidechat: {sidechatError}
              </p>
            ) : null}
            {sidechatMoments.length ? (
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.12)]">
                {sidechatMoments.map(renderMomentRow)}
              </div>
            ) : null}
          </div>

          {/* Source 3: default topics */}
          <div className="rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold">
                  ③ Default Columbia topics
                </p>
                <p className="text-[11px] text-[rgb(var(--muted))]">
                  The built-in community-context corpus ({defaultMoments.length}
                  {' '}topics). Check the ones you want in the batch.
                </p>
              </div>
              <span className="flex items-center gap-2 text-[11px] text-[rgb(var(--muted))]">
                <button
                  type="button"
                  onClick={() => selectMoments(defaultMoments, true)}
                  disabled={batchRunning}
                  className="font-semibold text-[rgb(var(--primary))] transition hover:brightness-110 disabled:opacity-40"
                >
                  all
                </button>
                ·
                <button
                  type="button"
                  onClick={() => selectMoments(defaultMoments, false)}
                  disabled={batchRunning}
                  className="font-semibold text-[rgb(var(--primary))] transition hover:brightness-110 disabled:opacity-40"
                >
                  none
                </button>
              </span>
            </div>
            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.12)]">
              {defaultMoments.map(renderMomentRow)}
            </div>
          </div>
        </div>

        {/* Run bar */}
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
          <button
            type="button"
            onClick={runStudyBatch}
            disabled={
              batchRunning || runningAll || !catalog.length || !selectedCount
            }
            className="rounded-lg bg-[rgb(var(--primary))] px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
          >
            {batchRunning
              ? 'Running batch…'
              : `Run batch (${selectedCount} moment${selectedCount === 1 ? '' : 's'})`}
          </button>
        </div>
      </section>
      ) : null}

      {/* 2 · Library + preprocessing */}
      <section className={sectionCard}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">
              2 · Image library
            </h2>
            <p className="mt-1 text-xs text-[rgb(var(--muted))]">
              {counts.fresh} fresh · {counts.stale} stale · {counts.missing}{' '}
              without a profile. Stale = the preprocessing prompts changed
              since the profile was generated.
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
              onClick={() => preprocessMany(needsWork)}
              disabled={preprocessingAll || !needsWork.length || profilesTableMissing}
              className={runButton}
            >
              {preprocessingAll
                ? 'Preprocessing…'
                : `Preprocess ${needsWork.length} missing/stale`}
            </button>
            <button
              type="button"
              onClick={() => preprocessMany(setImages)}
              disabled={preprocessingAll || !setImages.length || profilesTableMissing}
              className={ghostButton}
            >
              Re-run all
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAllImages((v) => !v)
                setImagePage(0)
              }}
              className={ghostButton}
            >
              {showAllImages
                ? 'Show less'
                : `Show all (${IMAGES_PER_PAGE} per page)`}
            </button>
          </div>
        </div>

        <div
          className={`mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-10 ${
            showAllImages ? '' : 'max-h-44 overflow-y-auto pr-1'
          }`}
        >
          {visibleImages.map((img) => {
            const status = profileStatus(img.id)
            const pre = preStates[img.id]
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
                  {pre?.status === 'running' ? (
                    <span className="text-[10px] font-semibold text-[rgb(var(--primary))]">
                      {pre.stepLabel ?? 'running'}…
                    </span>
                  ) : (
                    statusChip(status)
                  )}
                  <button
                    type="button"
                    onClick={() => preprocessImage(img)}
                    disabled={pre?.status === 'running' || profilesTableMissing}
                    className="text-[10px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] disabled:opacity-40"
                  >
                    {status === 'missing' ? 'Run' : 'Re-run'}
                  </button>
                </div>
                {pre?.status === 'error' ? (
                  <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                    {pre.error}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>

        {showAllImages && imagePageCount > 1 ? (
          <div className="mt-2 flex items-center gap-2 text-[11px] text-[rgb(var(--muted))]">
            <button
              type="button"
              onClick={() => setImagePage((p) => Math.max(0, p - 1))}
              disabled={currentImagePage === 0}
              className={ghostButton}
            >
              Prev
            </button>
            <span>
              page {currentImagePage + 1} of {imagePageCount} ·{' '}
              {setImages.length} images
            </span>
            <button
              type="button"
              onClick={() =>
                setImagePage((p) => Math.min(imagePageCount - 1, p + 1))
              }
              disabled={currentImagePage >= imagePageCount - 1}
              className={ghostButton}
            >
              Next
            </button>
          </div>
        ) : null}

        {expandedImageId && profiles[expandedImageId] ? (
          <div className="mt-3 space-y-2 rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
            <p className={outLabel}>Reaction profile</p>
            {preSteps.map((step) => (
              <div key={step.id}>
                <p className="text-[11px] font-semibold">{step.description}</p>
                <pre className={`${resultPre} mt-1 max-h-64`}>
                  {profiles[expandedImageId]?.stepOutputs[String(step.orderBy)] ??
                    '(no output)'}
                </pre>
              </div>
            ))}
          </div>
        ) : expandedImageId ? (
          <p className="mt-3 text-xs text-[rgb(var(--muted))]">
            No profile yet for this image — run preprocessing to inspect its
            outputs.
          </p>
        ) : null}
      </section>

      {/* 3 · Reverse pipeline (single run) */}
      {mode === 'single' ? (
      <section className={sectionCard}>
        <div>
          <h2 className="text-sm font-semibold">3 · Reverse pipeline</h2>
          <p className="mt-1 text-xs text-[rgb(var(--muted))]">
            Every step of the flavor, ops-style: prompts editable in place, the
            resolved prompt inspectable after a run, and 🚫 Hide to skip a step
            on every run — single AND batch — saved to the flavor.
          </p>
        </div>

        <div className="mt-3 flex items-start gap-4">
          {/* Step rail */}
          <nav className="sticky top-4 hidden max-h-[calc(100vh-2rem)] w-60 shrink-0 flex-col gap-0.5 overflow-y-auto rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 lg:flex dark:border-[rgb(var(--gloss)/0.12)]">
            <p className={outLabel}>Preprocess (per image)</p>
            {preSteps.map(railRow)}
            <p className={`${outLabel} mt-2`}>Per moment</p>
            {reverseSteps.map(railRow)}
          </nav>

          <div className="min-w-0 flex-1 space-y-3">
            {/* P-step cards */}
            {preSteps.map((s, i) => (
              <StepCard
                key={s.id}
                step={s}
                flavorId={flavorId}
                inputs={
                  i === 0
                    ? ['celebrityRecognition']
                    : preSteps.slice(0, i).map((ps) => `step${ps.orderBy}Output`)
                }
                resolved={resolvedPrompts[s.id]}
                hidden={s.isHidden}
                hideDisabled={hideDisabledReason(s)}
                onToggleHidden={() => toggleStepHidden(s)}
                onSavedPrompt={applyPromptSave(s.id)}
              >
                <p className="mt-2 text-[11px] text-[rgb(var(--muted))]">
                  Runs once per image during preprocessing (the image library
                  section) — outputs are cached as reaction profiles. Click a
                  thumbnail there to inspect this step&rsquo;s cached output.
                </p>
              </StepCard>
            ))}

            {/* R1 */}
            {r1Step ? (
              <StepCard
                step={r1Step}
                flavorId={flavorId}
                inputs={['momentInput']}
                resolved={resolvedPrompts[r1Step.id]}
                hidden={r1Step.isHidden}
                hideDisabled={hideDisabledReason(r1Step)}
                onToggleHidden={() => toggleStepHidden(r1Step)}
                onSavedPrompt={applyPromptSave(r1Step.id)}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => runR1().catch(() => undefined)}
                      disabled={
                        r1State.status === 'loading' ||
                        runningAll ||
                        !moment.trim() ||
                        r1Step.isHidden
                      }
                      className={runButton}
                    >
                      {r1State.status === 'loading' ? 'Running…' : 'Run R1'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runFromStep(1)}
                      disabled={runningAll || !moment.trim() || !catalog.length}
                      title="Run R1, then every later visible step, in order"
                      className={ghostButton}
                    >
                      ▶▶ To end
                    </button>
                  </>
                }
              >
                {r1State.status === 'error' ? (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                    {r1State.error}
                  </p>
                ) : null}
                {r1Text ? (
                  <pre className={`${resultPre} mt-2 max-h-72`}>{r1Text}</pre>
                ) : null}
              </StepCard>
            ) : null}

            {/* Middle (lens) steps — between R1 and R2 */}
            {middleSteps.map((s) => (
              <StepCard
                key={s.id}
                step={s}
                flavorId={flavorId}
                inputs={['momentInput', 'momentAnalysis']}
                resolved={resolvedPrompts[s.id]}
                hidden={s.isHidden}
                hideDisabled={hideDisabledReason(s)}
                onToggleHidden={() => toggleStepHidden(s)}
                onSavedPrompt={applyPromptSave(s.id)}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        runMiddles(r1Text ?? '').catch(() => undefined)
                      }
                      disabled={
                        middleStates[s.id]?.status === 'loading' ||
                        runningAll ||
                        (!r1Text && !r1Step?.isHidden) ||
                        s.isHidden
                      }
                      className={runButton}
                    >
                      {middleStates[s.id]?.status === 'loading'
                        ? 'Running…'
                        : 'Run lens'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runFromStep(1.5)}
                      disabled={
                        runningAll ||
                        !moment.trim() ||
                        !catalog.length ||
                        (!r1Text && !r1Step?.isHidden)
                      }
                      title="Run the lens step, then every later visible step (R1 keeps its existing output)"
                      className={ghostButton}
                    >
                      ▶▶ To end
                    </button>
                  </>
                }
              >
                <div className="mt-2">
                  <p className={outLabel}>Chosen entity (input to this step)</p>
                  {prominentEntities.length ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {prominentEntities.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => setFocusEntity(e)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                            focusEntity === e
                              ? 'border-[rgb(var(--primary))] bg-[rgb(var(--primary))]/10 font-semibold'
                              : 'border-[rgb(var(--gloss)/0.5)] hover:border-[rgb(var(--primary))]/50 dark:border-[rgb(var(--gloss)/0.2)]'
                          }`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1 text-[10px] text-[rgb(var(--muted))]">
                      Run R1 to list the moment&rsquo;s prominent entities — or
                      type one below.
                    </p>
                  )}
                  <input
                    value={focusEntity}
                    onChange={(e) => setFocusEntity(e.target.value)}
                    placeholder="…or write your own (blank = first prominent entity)"
                    className={`${resultPre} mt-1.5 block w-full text-[12px] focus:border-[rgb(var(--primary))] focus:outline-none`}
                  />
                </div>
                {middleStates[s.id]?.status === 'error' ? (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                    {middleStates[s.id]?.error}
                  </p>
                ) : null}
                {middleStates[s.id]?.text ? (
                  <pre className={`${resultPre} mt-2 max-h-96`}>
                    {middleStates[s.id]?.text}
                  </pre>
                ) : (
                  <p className="mt-2 text-xs text-[rgb(var(--muted))]">
                    not run yet — its output binds as{' '}
                    <code>{'${associationLenses}'}</code> for R2
                  </p>
                )}
              </StepCard>
            ))}

            {/* R2 */}
            {r2Step ? (
              <StepCard
                step={r2Step}
                flavorId={flavorId}
                inputs={['momentInput', 'momentAnalysis', 'imageCatalog']}
                resolved={resolvedPrompts[r2Step.id]}
                hidden={r2Step.isHidden}
                hideDisabled={hideDisabledReason(r2Step)}
                onToggleHidden={() => toggleStepHidden(r2Step)}
                onSavedPrompt={applyPromptSave(r2Step.id)}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        runR2(r1Text ?? '', lensText ?? '').catch(() => undefined)
                      }
                      disabled={
                        r2State.status === 'loading' ||
                        runningAll ||
                        (!r1Text && !r1Step?.isHidden) ||
                        !catalog.length
                      }
                      className={runButton}
                    >
                      {r2State.status === 'loading' ? 'Running…' : 'Run R2'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runFromStep(2)}
                      disabled={
                        runningAll ||
                        !moment.trim() ||
                        !catalog.length ||
                        (!r1Text && !r1Step?.isHidden)
                      }
                      title="Run R2, then every later visible step (R1 keeps its existing output)"
                      className={ghostButton}
                    >
                      ▶▶ To end
                    </button>
                  </>
                }
              >
                <p className="mt-1 text-[10px] text-[rgb(var(--muted))]">
                  catalog: {catalog.length} profiled images
                  {catalog.some((e) => e.stale)
                    ? ` (${catalog.filter((e) => e.stale).length} stale)`
                    : ''}
                </p>
                {r2State.status === 'error' ? (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                    {r2State.error}
                  </p>
                ) : null}
                {r2Warning ? (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    {r2Warning}
                  </p>
                ) : null}
                {r2Picks ? (
                  r2Picks.length ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {r2Picks.map((pick) => {
                        const img = imageByKey.get(pick.image_key)
                        return (
                          <div
                            key={pick.pickKey}
                            className="flex gap-2 rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.12)]"
                          >
                            {img ? (
                              <img
                                src={img.url}
                                alt=""
                                className="h-20 w-20 shrink-0 rounded-md object-cover"
                              />
                            ) : null}
                            <div className="min-w-0 text-[11px]">
                              <p className="font-semibold">
                                {pick.entity}{' '}
                                <span className="text-[rgb(var(--muted))]">
                                  · align {pick.emotional_alignment.toFixed(2)}
                                </span>
                                {pick.emotional_alignment < 0.8 ? (
                                  <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                                    weak fit
                                  </span>
                                ) : null}
                              </p>
                              <p className="mt-0.5 text-[rgb(var(--muted))]">
                                {pick.reason}
                              </p>
                              <p className="mt-0.5 text-[rgb(var(--muted))]">
                                {pick.format_reason}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-[rgb(var(--muted))]">
                      R2 selected no images for this moment — check its raw
                      output below for the reasoning.
                    </p>
                  )
                ) : null}
                {r2Raw ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-[rgb(var(--muted))]">
                      raw output
                    </summary>
                    <pre className={`${resultPre} mt-1 max-h-72`}>{r2Raw}</pre>
                  </details>
                ) : null}
              </StepCard>
            ) : null}

            {/* R3 */}
            {r3Step ? (
              <StepCard
                step={r3Step}
                flavorId={flavorId}
                inputs={[
                  'pairSelection',
                  'momentInput',
                  'imageScenePack',
                  'imageInterpretation',
                  'imagePunchlineConstraint',
                ]}
                resolved={resolvedPrompts[r3Step.id]}
                hidden={r3Step.isHidden}
                hideDisabled={hideDisabledReason(r3Step)}
                onToggleHidden={() => toggleStepHidden(r3Step)}
                onSavedPrompt={applyPromptSave(r3Step.id)}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!r2Picks?.length) return
                        await runPool(r2Picks, 2, async (pick) => {
                          try {
                            await runR3ForPick(pick)
                          } catch {
                            // surfaced per-image
                          }
                        })
                      }}
                      disabled={runningAll || !r2Picks?.length}
                      className={runButton}
                    >
                      Run R3 for {r2Picks?.length ?? 0} images
                    </button>
                    <button
                      type="button"
                      onClick={() => void runFromStep(3)}
                      disabled={runningAll || !r2Picks?.length}
                      title="Write captions for R2's picks, then rank (R1–R2 keep their existing outputs)"
                      className={ghostButton}
                    >
                      ▶▶ To end
                    </button>
                  </>
                }
              >
                <p className="mt-1 text-[10px] text-[rgb(var(--muted))]">
                  fans out over R2&rsquo;s picks — the resolved prompt below is
                  from the most recent image
                </p>
                {r2Picks?.length ? (
                  <div className="mt-3 space-y-2">
                    {r2Picks.map((pick) => {
                      const state = r3States[pick.pickKey]
                      const img = imageByKey.get(pick.image_key)
                      return (
                        <div
                          key={pick.pickKey}
                          className="flex gap-3 rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.12)]"
                        >
                          {img ? (
                            <img
                              src={img.url}
                              alt=""
                              className="h-16 w-16 shrink-0 rounded-md object-cover"
                            />
                          ) : null}
                          <div className="min-w-0 flex-1 text-xs">
                            <p className="font-semibold">
                              {pick.image_key} · {pick.entity}
                            </p>
                            {state?.status === 'loading' ? (
                              <p className="mt-1 text-[rgb(var(--muted))]">
                                writing…
                              </p>
                            ) : state?.status === 'error' ? (
                              <p className="mt-1 text-red-600 dark:text-red-400">
                                {state.error}
                              </p>
                            ) : state?.jokes?.length ? (
                              <ul className="mt-1 space-y-1">
                                {state.jokes.map((joke) => (
                                  <li key={joke.caption}>
                                    <span className="font-medium">
                                      “{joke.caption}”
                                    </span>{' '}
                                    <span className="text-[rgb(var(--muted))]">
                                      — {joke.reason}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-1 text-[rgb(var(--muted))]">
                                not run yet
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[rgb(var(--muted))]">
                    Run R2 first — R3 writes captions for each selected image.
                  </p>
                )}
              </StepCard>
            ) : null}

            {/* R4 */}
            {r4Step ? (
              <StepCard
                step={r4Step}
                flavorId={flavorId}
                inputs={['allCaptionResults', 'topN']}
                resolved={resolvedPrompts[r4Step.id]}
                hidden={r4Step.isHidden}
                hideDisabled={hideDisabledReason(r4Step)}
                onToggleHidden={() => toggleStepHidden(r4Step)}
                onSavedPrompt={applyPromptSave(r4Step.id)}
                actions={
                  <>
                    <label className="flex items-center gap-1 text-[11px] text-[rgb(var(--muted))]">
                      keep
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={topN}
                        onChange={(e) =>
                          setTopN(
                            Math.min(10, Math.max(1, Number(e.target.value) || 1))
                          )
                        }
                        className="w-14 rounded-md border border-[rgb(var(--gloss)/0.6)] bg-transparent px-1.5 py-0.5 text-xs dark:border-[rgb(var(--gloss)/0.2)]"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (!r2Picks?.length) return
                        const jokesByKey: Record<string, Joke[]> = {}
                        for (const pick of r2Picks) {
                          const jokes = r3States[pick.pickKey]?.jokes
                          if (jokes?.length) jokesByKey[pick.pickKey] = jokes
                        }
                        runR4(r2Picks, jokesByKey)
                      }}
                      disabled={
                        r4State.status === 'loading' ||
                        runningAll ||
                        !r2Picks?.length
                      }
                      className={runButton}
                    >
                      {r4State.status === 'loading' ? 'Ranking…' : 'Run R4'}
                    </button>
                  </>
                }
              >
                {r4State.status === 'error' ? (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                    {r4State.error}
                  </p>
                ) : null}
                {r4Results?.length ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {r4Results.map((result, index) => {
                      const img = imageByKey.get(result.image_key)
                      return (
                        <figure
                          key={`${result.image_key}-${result.caption}`}
                          className="rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.12)]"
                        >
                          <p className={outLabel}>#{index + 1}</p>
                          <figcaption className="mt-1 text-sm font-medium">
                            {result.caption}
                          </figcaption>
                          {img ? (
                            <img
                              src={img.url}
                              alt=""
                              className="mt-2 w-full rounded-md object-cover"
                            />
                          ) : null}
                        </figure>
                      )
                    })}
                  </div>
                ) : null}
              </StepCard>
            ) : null}
          </div>
        </div>
      </section>
      ) : null}

      {/* 3 · Batch results (batch run) */}
      {mode === 'batch' && batchMoments.length ? (
        <section className={sectionCard}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">3 · Batch results</h2>
              <p className="mt-1 text-xs text-[rgb(var(--muted))]">
                {batchCounts.done} done
                {batchCounts.noFit ? ` · ${batchCounts.noFit} no fit` : ''}
                {batchCounts.error ? ` · ${batchCounts.error} failed` : ''}
                {batchRunning
                  ? ` · running (${batchFinished}/${selectedCount} moments finished)`
                  : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {archivedRunId ? (
                <a
                  href={`/humor-flavor/${flavorId}/ops-reverse2?run=${archivedRunId}`}
                  target="_blank"
                  rel="noreferrer"
                  className={ghostButton}
                  title="Open this batch's archived run in the Flavor Inspector (ops-reverse2): every step's rendered prompts and outputs, per moment"
                >
                  Open in Flavor Inspector →
                </a>
              ) : null}
              <button
                type="button"
                onClick={exportStudyJson}
                disabled={!anyExportable}
                className={ghostButton}
                title="Full per-moment report: status, errors, and ranked results"
              >
                Export JSON
              </button>
              <button
                type="button"
                onClick={exportQuickStudyJson}
                disabled={!anyExportable}
                className={ghostButton}
                title="Flat [{image_id, caption}] array for chucklesome's /study-quick importer"
              >
                Export for Quick Study
              </button>
              <button
                type="button"
                onClick={exportUrlCaptionJson}
                disabled={!anyExportable}
                className={ghostButton}
                title="Flat [{image_id, caption}] array across all moments, with the image URL in the image_id field"
              >
                Export URL + caption
              </button>
            </div>
          </div>

          {batchRunning ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[rgb(var(--gloss)/0.3)]">
              <div
                className="h-full rounded-full bg-[rgb(var(--primary))] transition-all duration-500"
                style={{
                  width: `${selectedCount ? Math.round((batchFinished / selectedCount) * 100) : 0}%`,
                }}
              />
            </div>
          ) : null}

          <div className="mt-3 space-y-3">
            {batchMoments.map((m) => {
              const status = batch[m.key]
              if (!status) return null
              return (
                <div
                  key={m.key}
                  className="rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-xs leading-snug">
                      {m.custom ? (
                        <span className={`${outLabel} mr-1`}>custom</span>
                      ) : null}
                      {m.brainTitle ? (
                        <span className="mr-1 rounded-full bg-[rgb(var(--primary))]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[rgb(var(--primary))]">
                          brain · {m.brainTitle}
                        </span>
                      ) : null}
                      {m.text}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        status.stage === 'error'
                          ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                          : status.stage === 'done'
                            ? status.noFit
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            : 'bg-[rgb(var(--primary))]/15 text-[rgb(var(--primary))]'
                      }`}
                    >
                      {status.stage === 'done'
                        ? status.noFit
                          ? 'no fit'
                          : `done${status.saved != null ? ` · ${status.saved} saved` : ''}`
                        : status.stage === 'error'
                          ? 'error'
                          : `${status.stage}…`}
                    </span>
                  </div>
                  {status.stage === 'error' ? (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                      {status.error}
                    </p>
                  ) : null}
                  {status.noFit ? (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      R2 selected no image with emotional alignment ≥ 0.8 for
                      this moment.
                    </p>
                  ) : null}
                  {status.results?.length ? (
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                      {status.results.map((r) => (
                        <figure
                          key={`${m.key}-${r.rank}`}
                          className="flex flex-col overflow-hidden rounded-lg border border-[rgb(var(--gloss)/0.4)] dark:border-[rgb(var(--gloss)/0.12)]"
                        >
                          <div className="relative">
                            <img
                              src={r.imageUrl}
                              alt=""
                              className="aspect-square w-full object-cover"
                            />
                            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              #{r.rank}
                            </span>
                          </div>
                          <figcaption className="flex flex-1 flex-col justify-between gap-1 p-2">
                            <p className="text-xs font-medium leading-snug">
                              {r.caption}
                            </p>
                            <p className="text-[10px] text-[rgb(var(--muted))]">
                              {r.entity}
                              <span
                                className={
                                  r.emotionalAlignment < 0.8
                                    ? 'ml-1 font-semibold text-amber-600 dark:text-amber-400'
                                    : 'ml-1'
                                }
                              >
                                {r.emotionalAlignment.toFixed(2)}
                              </span>
                            </p>
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

    </div>
  )
}
