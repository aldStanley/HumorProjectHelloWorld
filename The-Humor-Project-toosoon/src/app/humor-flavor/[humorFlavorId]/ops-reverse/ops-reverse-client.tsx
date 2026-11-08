'use client'

// ops-reverse: the ops-style workbench for reverse (context → image) flavors,
// focused on the per-moment R-steps. P-steps are preprocessing: their cached
// reaction profiles are INPUTS here, not runnable steps — preprocessing (and
// the batch runner) live on the /reverse page; a dedicated P-step ops page
// can come later.
//
// Layout mirrors ops: sticky toolbar (set, moment, run-all), a step rail with
// live status + hide toggles (is_hidden, shared with /reverse), and one row
// per R-step with the control card on the left and its output on the right.
// R2 is the image-finding step: its card exposes the search-card catalog it
// selects from.
/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import BulkModelSelect, { type ModelChoice } from '@/components/bulk-model-select'
import ManualStepValue from '@/components/manual-step-value'
import { parseManualStepOutput } from '@/utils/manual-step-output'
import { JsonTree } from '@/components/json-tree'
import { promptHash } from '@/utils/prompt-hash'

import { setStepHiddenAction } from '../actions'
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
  copyProfilesAction,
  listProfilesAction,
  loadStudentBrainContextsAction,
  saveStudyResultsAction,
  type ReverseProfile,
  type StudyResultInput,
} from '../reverse/actions'
import {
  DEFAULT_MOMENTS,
  StepCard,
  archiveJokesByImage,
  extractJokes,
  liftJokesFromPicks,
  ghostButton,
  outLabel,
  parseJsonLoose,
  resultPre,
  runButton,
  runPool,
  sectionCard,
  type BatchResult,
  type BatchStatus,
  type Joke,
  type R2Pick,
  type R3State,
  type RankedResult,
  type ReverseCommunityContext,
  type ReverseImageSet,
  type ReverseStep,
  type RunState,
  type StepIo,
  type StudyMoment,
} from '../reverse/reverse-client'
import {
  listClusteringsAction,
  loadClusteringAction,
  type SavedClusteringMeta,
} from '@/app/sidechat-topics/actions'
import {
  clusteringToMoments,
  groupMomentsByEvent,
  toStudyMoment,
  type SidechatMoment,
} from '@/app/sidechat-topics/sidechat-moments'

const PRE_STEP_FALLBACK = 4
const isPreStep = (s: ReverseStep) => /^P\d/i.test(s.description)
const isReverseStep = (s: ReverseStep) => /^R\d/i.test(s.description)

// A step's JSON output laid out field by field (the Flavor Maker's JsonTree:
// keys as labels, parallel objects as a comparison table), with the verbatim
// text folded underneath. Non-JSON output falls back to the raw block.
function StructuredOutput({ text, className = 'mt-2' }: { text: string; className?: string }) {
  const parsed = parseJsonLoose(text)
  if (parsed == null || typeof parsed !== 'object')
    return <pre className={`${resultPre} ${className} max-h-96`}>{text}</pre>
  return (
    <div className={className}>
      <div className="rounded-md border border-[rgb(var(--gloss)/0.4)] bg-[rgb(var(--panel)/0.6)] p-3 dark:border-[rgb(var(--gloss)/0.12)] dark:bg-[rgb(var(--panel)/0.2)]">
        <JsonTree data={parsed} />
      </div>
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[11px] text-[rgb(var(--muted))]">
          raw output (the exact text the model returned)
        </summary>
        <pre className={`${resultPre} mt-1 max-h-72`}>{text}</pre>
      </details>
    </div>
  )
}

// Every ${variable} a step's prompts read, in order of first appearance.
const varsIn = (step: ReverseStep): string[] =>
  Array.from(
    new Set(
      Array.from(
        `${step.systemPrompt}\n${step.userPrompt}`.matchAll(/\$\{([A-Za-z0-9_]+)\}/g),
        (m) => m[1]
      )
    )
  )

export default function OpsReverseClient({
  flavorId,
  flavorSlug,
  steps: initialSteps,
  imageSets,
  contexts,
  initialProfiles,
  profilesTableMissing,
  initialSetId,
  models,
}: {
  flavorId: number
  flavorSlug: string
  models: ModelChoice[]
  steps: ReverseStep[]
  imageSets: ReverseImageSet[]
  contexts: ReverseCommunityContext[]
  initialProfiles: ReverseProfile[]
  profilesTableMissing: boolean
  initialSetId: number | null
}) {
  const [manualValues, setManualValues] = useState<Record<number, string>>({})
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
  // Analyzer first; selector, caption fan-out, ranker are the LAST THREE.
  // Steps between are middle steps (e.g. the association lens step) — run in
  // order between R1 and R2; the last one binds as ${associationLenses}.
  const r1Step = reverseSteps[0]
  const middleSteps = useMemo(
    () => reverseSteps.slice(1, Math.max(1, reverseSteps.length - 3)),
    [reverseSteps]
  )
  const [r2Step, r3Step, r4Step] = reverseSteps.slice(-3)

  // Hidden P-steps drop out of the chain — must match /reverse so staleness
  // agrees between the two surfaces.
  const activePreSteps = useMemo(
    () => preSteps.filter((s) => !s.isHidden),
    [preSteps]
  )
  const currentHash = useMemo(
    () =>
      promptHash(activePreSteps.flatMap((s) => [s.systemPrompt, s.userPrompt])),
    [activePreSteps]
  )

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
  // The caption writer CAN be hidden: caption-first flavors write captions
  // upstream and carry them in the casting step's output, from which the
  // runners lift them in code (liftJokesFromPicks).
  const hideDisabledReason = (_step: ReverseStep): string | undefined =>
    undefined

  const [setId, setSetId] = useState<number | ''>(
    initialSetId ?? imageSets[0]?.id ?? ''
  )
  const selectedSet = imageSets.find((s) => s.id === setId) ?? null
  useEffect(() => {
    if (setId === '') return
    const url = new URL(window.location.href)
    if (url.searchParams.get('set') !== String(setId)) {
      url.searchParams.set('set', String(setId))
      window.history.replaceState(null, '', url)
    }
  }, [setId])

  const [moment, setMoment] = useState(DEFAULT_MOMENTS[flavorId] ?? '')
  const [topN, setTopN] = useState(3)

  // Batch state — same semantics as /reverse batch mode: which moments are
  // checked, per-moment run status, and the custom-moment paste box.
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [customMoments, setCustomMoments] = useState<StudyMoment[]>([])
  const [customDraft, setCustomDraft] = useState('')
  const [studySelected, setStudySelected] = useState<Record<string, boolean>>({})
  const [batch, setBatch] = useState<Record<string, BatchStatus>>({})
  const [batchRunning, setBatchRunning] = useState(false)
  // The ops_runs id of the current / most recent archived run (chain OR
  // batch) — the target of the "Open in Flavor Inspector" links.
  const [archivedRunId, setArchivedRunId] = useState<string | null>(null)

  // Recent topics from the Student Brain API — one selectable moment each.
  const [brainMoments, setBrainMoments] = useState<
    { key: string; text: string; title: string }[]
  >([])
  const [brainLoading, setBrainLoading] = useState(false)
  const [brainError, setBrainError] = useState<string | null>(null)
  const loadBrainContexts = async (): Promise<void> => {
    setBrainLoading(true)
    setBrainError(null)
    try {
      const res = await loadStudentBrainContextsAction()
      if (!res.ok) {
        setBrainError(res.error ?? 'Student Brain load failed.')
        return
      }
      setBrainMoments(
        (res.contexts ?? []).map((c) => ({
          key: `sb-${c.topicId}`,
          text: c.summary,
          title: c.title || `topic ${c.topicId}`,
        }))
      )
    } catch (err) {
      setBrainError(
        err instanceof Error ? err.message : 'Student Brain load failed.'
      )
    } finally {
      setBrainLoading(false)
    }
  }

  // Archived Sidechat clusterings (made on /sidechat-events), chunked into
  // moments by the shared chunker: one moment per reaction group inside an
  // event, the whole event when it has no groups. Loading makes no model calls.
  const [sidechatArchive, setSidechatArchive] = useState<SavedClusteringMeta[]>([])
  const [sidechatArchiveId, setSidechatArchiveId] = useState<string>('')
  const [sidechatArchiveNote, setSidechatArchiveNote] = useState<string | null>(null)
  const [sidechatMoments, setSidechatMoments] = useState<SidechatMoment[]>([])
  const [sidechatLoading, setSidechatLoading] = useState(false)
  const [sidechatError, setSidechatError] = useState<string | null>(null)
  const [sidechatLoaded, setSidechatLoaded] = useState<{
    name: string
    postCount: number
    eventCount: number
    momentCount: number
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await listClusteringsAction()
        if (cancelled) return
        if (res.ok === false) {
          setSidechatArchiveNote(`Could not list the archive: ${res.error}`)
          return
        }
        setSidechatArchive(res.clusterings)
        setSidechatArchiveId((prev) => prev || res.clusterings[0]?.id || '')
        if (res.tableMissing) {
          setSidechatArchiveNote('The archive table does not exist in this database yet (run the sidechat_clusterings migration).')
        } else if (res.clusterings.length === 0) {
          setSidechatArchiveNote('No archived clusterings yet. Run one on the Sidechat events page; it is archived automatically.')
        }
      } catch (err) {
        if (!cancelled) setSidechatArchiveNote(err instanceof Error ? err.message : 'Could not list the archive.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
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
      const moments = clusteringToMoments(res.clusters)
      // Selections on the old rows are cleared so a stale check never carries over by key.
      setStudySelected((prev) => {
        const next = { ...prev }
        for (const m of sidechatMoments) delete next[m.key]
        return next
      })
      setSidechatMoments(moments)
      setSidechatLoaded({
        name: res.name,
        postCount: res.postCount,
        eventCount: groupMomentsByEvent(moments).length,
        momentCount: moments.length,
      })
    } catch (err) {
      setSidechatError(err instanceof Error ? err.message : 'Archive load failed.')
    } finally {
      setSidechatLoading(false)
    }
  }
  const sidechatByEvent = useMemo(() => groupMomentsByEvent(sidechatMoments), [sidechatMoments])

  // Every moment the batch picker can offer, across all four sources.
  const studyMoments: StudyMoment[] = useMemo(
    () => [
      ...customMoments,
      ...sidechatMoments.map(toStudyMoment),
      ...brainMoments.map((m) => ({
        key: m.key,
        text: m.text,
        brainTitle: m.title,
      })),
      ...contexts.map((c) => ({ key: `ctx-${c.id}`, text: c.content })),
    ],
    [contexts, customMoments, sidechatMoments, brainMoments]
  )

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

  const selectMoments = (items: StudyMoment[], value: boolean) =>
    setStudySelected((prev) => ({
      ...prev,
      ...Object.fromEntries(items.map((item) => [item.key, value])),
    }))

  // One clickable row in a moment-source list; clicking makes it THE moment.
  const momentRow = (key: string | number, text: string, badge?: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setMoment(text)}
      className={`block w-full rounded-md border px-2 py-1 text-left text-xs transition ${
        moment === text
          ? 'border-[rgb(var(--primary))] bg-[rgb(var(--primary))]/10'
          : 'border-transparent hover:border-[rgb(var(--gloss)/0.4)]'
      }`}
    >
      {badge ? (
        <span className="mr-1 rounded-full bg-[rgb(var(--primary))]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[rgb(var(--primary))]">
          {badge}
        </span>
      ) : null}
      {text}
    </button>
  )

  const [profiles, setProfiles] = useState<Record<string, ReverseProfile>>(
    () => Object.fromEntries(initialProfiles.map((p) => [p.imageId, p]))
  )
  const profileStatus = (imageId: string): 'missing' | 'stale' | 'fresh' => {
    const profile = profiles[imageId]
    if (!profile || !profile.searchCard) return 'missing'
    return profile.promptHash === currentHash ? 'fresh' : 'stale'
  }
  const setImages = selectedSet?.images ?? []
  const counts = setImages.reduce(
    (acc, img) => {
      acc[profileStatus(img.id)] += 1
      return acc
    },
    { missing: 0, stale: 0, fresh: 0 }
  )

  // Copy another flavor's cached profiles for the missing/stale images in
  // this set — the shortcut for duplicated flavors, instead of re-running
  // preprocessing on the reverse page.
  const [copySourceId, setCopySourceId] = useState('')
  const [copyState, setCopyState] = useState<
    { status: 'idle' | 'copying' } | { status: 'done'; note: string } | { status: 'error'; error: string }
  >({ status: 'idle' })
  const copyProfiles = async () => {
    const sourceFlavorId = Number.parseInt(copySourceId, 10)
    if (!Number.isFinite(sourceFlavorId)) {
      setCopyState({ status: 'error', error: 'Enter a source flavor id.' })
      return
    }
    const imageIds = setImages
      .filter((img) => profileStatus(img.id) !== 'fresh')
      .map((img) => img.id)
    setCopyState({ status: 'copying' })
    const res = await copyProfilesAction({
      targetFlavorId: flavorId,
      sourceFlavorId,
      imageIds,
    })
    if (!res.ok) {
      setCopyState({ status: 'error', error: res.error ?? 'Copy failed.' })
      return
    }
    const reload = await listProfilesAction({ flavorId })
    if (reload.ok) {
      setProfiles(
        Object.fromEntries(reload.profiles.map((p) => [p.imageId, p]))
      )
    }
    setCopyState({
      status: 'done',
      note: `copied ${res.copiedCount ?? 0}${
        res.missingCount ? ` (${res.missingCount} not in ${sourceFlavorId})` : ''
      }`,
    })
  }

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
  const imageByKey = new Map(catalog.map((e) => [e.key, e.image]))
  const catalogJson = useMemo(
    () =>
      JSON.stringify(
        catalog.map((e) => ({ image_key: e.key, ...(e.card as object) })),
        null,
        2
      ),
    [catalog]
  )

  // ---- run state ----------------------------------------------------------

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
  const [r2State, setR2State] = useState<RunState>({ status: 'idle' })
  const [r2Raw, setR2Raw] = useState<string | null>(null)
  const [r2Picks, setR2Picks] = useState<R2Pick[] | null>(null)
  const [r2Warning, setR2Warning] = useState<string | null>(null)
  const [r3States, setR3States] = useState<Record<string, R3State>>({})
  const [r4State, setR4State] = useState<RunState>({ status: 'idle' })
  const [r4Results, setR4Results] = useState<RankedResult[] | null>(null)
  const [runningAll, setRunningAll] = useState(false)
  const [resolvedPrompts, setResolvedPrompts] = useState<
    Record<number, { system?: string; user?: string }>
  >({})

  // The active run archive, when a chain or study batch is running. execStep
  // consults it on every model call, so EVERY call in an archived run leaves a
  // step record — rendered prompts, output, timing — regardless of which stage
  // made it. Null outside orchestrated runs (lone per-stage pokes).
  const archiveRef = useRef<{ push: (rec: OpsRunStepRecord) => void } | null>(null)

  const execStep = async (
    step: ReverseStep,
    imageId: string,
    priorOutputs: Record<string, string>,
    branch?: { label: string }
  ): Promise<string> => {
    const startedAt = Date.now()
    const manualText = manualValues[step.id]
    const res = manualText !== undefined
      ? { ok: true, text: manualText, resolvedSystemPrompt: undefined, resolvedUserPrompt: undefined }
      : await runStepAction({
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
      opTitle: (manualText !== undefined ? '[Manual value] ' : '') + (step.description.trim().split('\n')[0].slice(0, 120) || 'Step'),
      position: step.orderBy,
      branchIndex: null,
      branchLabel: branch?.label ?? null,
      humorFlavorStepId: step.id,
      stepOrderBy: step.orderBy,
      providerModelId: manualText !== undefined ? null : step.providerModelId,
      temperature: manualText !== undefined ? null : step.temperature,
      includeImage: manualText !== undefined ? false : step.includeImage,
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

  // ---- run archive (same ops_runs tables the forward ops page writes) ------
  // For reverse runs the archived unit is a MOMENT: one ops_run_images row per
  // moment (image fields null until the run finishes, then set to the
  // top-ranked pick), with the moment text in outputs.momentInput. Best-effort
  // throughout: a dead archive never blocks the run.
  const reverseRunSpec = () => ({
    surface: 'ops-reverse',
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
        exportJson?: unknown
        exportWarning?: string | null
        captionCount: number
      }) => {
        flush()
        await flushChain
        await finishOpsRunAction({
          runId,
          status: opts.status,
          exportJson: opts.exportJson ?? null,
          exportWarning: opts.exportWarning ?? null,
          captionCount: opts.captionCount,
        }).catch(() => undefined)
      },
    }
  }

  // ---- cores (same semantics as /reverse, hidden fallbacks included) ------

  const execR1Core = async (momentText: string): Promise<string> => {
    const step = r1Step
    if (!step) throw new Error('R1 step is missing from this flavor.')
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
      throw new Error(
        'No profiled images in this set — run preprocessing on the reverse page first.'
      )
    }
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
        reaction_anchor:
          p.reaction_anchor == null ? null : String(p.reaction_anchor),
        reaction_reason:
          p.reaction_reason == null ? null : String(p.reaction_reason),
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
    const profilePriors: Record<string, string> = {}
    for (const preStep of activePreSteps) {
      profilePriors[String(preStep.orderBy)] =
        profile.stepOutputs[String(preStep.orderBy)] ?? ''
    }
    const text = await execStep(
      step,
      pick.imageId,
      {
        ...profilePriors,
        imageScenePack: profilePriors['1'] ?? '',
        imageInterpretation: profilePriors['2'] ?? '',
        imagePunchlineConstraint: profilePriors['3'] ?? '',
        pairSelection,
        momentInput: momentText,
      },
      // Fan-out: one call per R2 pick — label the record with which image.
      { label: pick.image_key }
    )
    const jokes = extractJokes(parseJsonLoose(text))
    if (!jokes.length) {
      throw new Error('The caption writer returned no parsable jokes.')
    }
    return { text, jokes }
  }

  const execR4Core = async (
    picks: R2Pick[],
    jokesByKey: Record<string, Joke[]>,
    topNValue: number
  ): Promise<{ text: string; results: RankedResult[] }> => {
    const step = r4Step
    if (!step) throw new Error('R4 step is missing from this flavor.')
    if (!anyImageId) throw new Error('Pick an image set first.')
    // jokesByKey is keyed by PICK (pickKey), not image — two POVs may share an
    // image, and each pick's jokes must stay its own candidate for the ranker.
    const candidates = picks
      .filter((p) => jokesByKey[p.pickKey]?.length)
      .map((p) => ({
        image_key: p.image_key,
        entity: p.entity,
        emotional_alignment: p.emotional_alignment,
        jokes: jokesByKey[p.pickKey],
      }))
    if (!candidates.length) throw new Error('No caption results to rank.')
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
    // Verbatim check merges the jokes of every pick sharing an image.
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

  // ---- interactive wrappers ----

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
  ): Promise<RankedResult[] | null> => {
    setR4State({ status: 'loading' })
    try {
      const { results } = await execR4Core(picks, jokesByKey, topN)
      setR4Results(results)
      setR4State({ status: 'done' })
      return results
    } catch (err) {
      setR4State({
        status: 'error',
        error: err instanceof Error ? err.message : 'R4 failed.',
      })
      return null
    }
  }

  // Stages: 1 = R1, 1.5 = middle (lens) steps, 2 = R2, 3 = R3, 4 = R4.
  // Archived to ops_runs like a forward run (one "moment" row), so every chain
  // leaves the rendered prompts and raw output of each model call.
  const runFromStep = async (start: number): Promise<void> => {
    setRunningAll(true)
    const archive = await startRunArchive(
      start > 1
        ? `${flavorSlug} · reverse · 1 moment · from stage ${start}`
        : `${flavorSlug} · reverse · 1 moment`,
      1
    )
    if (archive) await archive.beginMoment(0)
    archiveRef.current = archive
    setArchivedRunId(archive?.runId ?? null)
    const momentOutputs: Record<string, unknown> = { momentInput: moment.trim() }
    let failed: string | null = null
    let ranked: RankedResult[] | null = null
    try {
      let analysis = r1Text ?? ''
      if (start <= 1) analysis = await runR1()
      momentOutputs.momentAnalysis = analysis
      let lenses = lensText ?? ''
      if (start <= 1.5) lenses = await runMiddles(analysis)
      momentOutputs.associationLenses = lenses
      let picks = r2Picks ?? []
      if (start <= 2) picks = await runR2(analysis, lenses)
      momentOutputs.picks = picks.map((p) => p.raw)
      if (!picks.length) {
        momentOutputs.noFit = true
        return
      }
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
            // per-image failure already surfaced in r3States
          }
        })
      } else {
        for (const pick of picks) {
          const jokes = r3States[pick.pickKey]?.jokes
          if (jokes?.length) jokesByKey[pick.pickKey] = jokes
        }
      }
      momentOutputs.jokesByKey = archiveJokesByImage(picks, jokesByKey)
      ranked = await runR4(picks, jokesByKey)
      if (ranked) momentOutputs.results = ranked
      else failed = 'R4 failed — see the ranker card.'
    } catch (err) {
      // the failing step already holds the error message in its card
      failed = err instanceof Error ? err.message : 'A step failed.'
    } finally {
      archiveRef.current = null
      if (archive) {
        const topPick = ranked?.[0] ? imageByKey.get(ranked[0].image_key) : null
        await archive.finishMoment({
          status: failed ? 'error' : 'done',
          error: failed,
          outputs: momentOutputs,
          finalOutput: ranked ? JSON.stringify(ranked, null, 2) : null,
          captions: ranked ? ranked.map((r) => r.caption) : null,
          imageId: topPick?.id ?? null,
          imageUrl: topPick?.url ?? null,
        })
        await archive.finish({
          status: failed ? 'error' : 'done',
          exportWarning: failed,
          captionCount: ranked?.length ?? 0,
        })
      }
      setRunningAll(false)
    }
  }

  // ---- batch: run every checked moment headlessly through the R cores,
  // saving each moment's ranked results as captions rows as it completes —
  // the same loop as /reverse batch mode ----

  const runStudyBatch = async (): Promise<void> => {
    const list = studyMoments.filter((m) => studySelected[m.key])
    if (!list.length || batchRunning) return
    const rankStepId = r4Step?.id
    setBatchRunning(true)
    // One archived run for the whole batch, one moment row per moment — the
    // same record a forward batch leaves, so prompts/outputs are queryable.
    const archive = await startRunArchive(
      `${flavorSlug} · reverse study · ${list.length} moment${list.length === 1 ? '' : 's'}`,
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
          const withImages: BatchResult[] = results.map((r, index) => ({
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

  // Full per-moment report: status, errors, and ranked results.
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

  // ---- rendering ----------------------------------------------------------

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
    return 'idle'
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

  // What each ${variable} means on THIS surface and where its value comes from.
  // The list a card shows is derived from the step's own prompts (varsIn), so
  // a prompt edit that adds or drops a variable updates the card on reload.
  const stepLabel = (s?: ReverseStep) =>
    s ? s.description || `Step ${s.orderBy}` : 'an earlier step'
  const lastMiddle = middleSteps[middleSteps.length - 1]
  const lastPre = preSteps[preSteps.length - 1]
  const preOut = (index: number) =>
    preSteps[index]
      ? `cached ${stepLabel(preSteps[index])} output for the pick's image`
      : `cached P${index + 1} output for the pick's image (this flavor has no P${index + 1})`
  const knownVars: Record<string, Omit<StepIo['inputs'][number], 'slot'>> = {
    momentInput: {
      description: 'the community moment being processed',
      boundTo: 'moment text — typed or picked in section 2',
    },
    momentAnalysis: {
      description: `output of ${stepLabel(r1Step)}`,
      boundTo: `${stepLabel(r1Step)} → \${momentAnalysis}`,
    },
    focusEntity: {
      description: 'the entity the lens step focuses on',
      boundTo: 'Chosen entity picker in the lens step\u2019s output panel (blank = first prominent entity)',
    },
    associationLenses: {
      description: lastMiddle
        ? `output of ${stepLabel(lastMiddle)}`
        : 'output of the last lens step (this flavor has none — resolves empty)',
      boundTo: lastMiddle
        ? `${stepLabel(lastMiddle)} → \${associationLenses}`
        : 'nothing — empty string',
      optional: true,
    },
    imageCatalog: {
      description: `one search card per profiled image (${catalog.length} in this set)`,
      boundTo: `cached ${stepLabel(lastPre)} output of every image in the set, as one JSON list`,
    },
    pairSelection: {
      description: `ONE selected image + its entity, from ${stepLabel(r2Step)}`,
      boundTo: `${stepLabel(r2Step)} → selected_images[i] (one per fan-out branch)`,
    },
    imageScenePack: { description: 'the scene pack of the pick\u2019s image', boundTo: preOut(0) },
    imageInterpretation: {
      description: 'the interpretive stance of the pick\u2019s image',
      boundTo: preOut(1),
    },
    imagePunchlineConstraint: {
      description: 'the punchline constraint of the pick\u2019s image',
      boundTo: preOut(2),
    },
    imageAdditionalContext: {
      description: 'cached image field "additionalContext"',
      boundTo: '(image) additional context — resolved by the server for the pick\u2019s image',
      optional: true,
    },
    celebrityRecognition: {
      description: 'cached image field "celebrityRecognition"',
      boundTo: '(image) celebrity recognition — resolved by the server for the pick\u2019s image',
      optional: true,
    },
    allCaptionResults: {
      description: `every branch of ${stepLabel(r3Step)}: image_key + pair + jokes, one entry per pick`,
      boundTo: `${stepLabel(r3Step)} → all fan-out branches merged into one JSON list`,
    },
    topN: {
      description: 'how many image+caption pairs to keep',
      boundTo: `"keep the best" control (currently ${topN})`,
    },
  }
  const describeVar = (slot: string): StepIo['inputs'][number] => {
    const known = knownVars[slot]
    if (known) return { slot, ...known }
    const preIndex = /^\d+$/.test(slot) ? Number(slot) - 1 : -1
    if (preIndex >= 0 && preIndex < preSteps.length)
      return {
        slot,
        description: `output of ${stepLabel(preSteps[preIndex])}`,
        boundTo: preOut(preIndex),
      }
    return {
      slot,
      description: 'not a variable this surface binds',
      boundTo: 'server built-in if one exists, otherwise empty',
      optional: true,
    }
  }
  const ioFor = (
    step: ReverseStep,
    role: 'r1' | 'middle' | 'r2' | 'r3' | 'r4'
  ): StepIo => {
    const inputs = varsIn(step).map(describeVar)
    switch (role) {
      case 'r1':
        return {
          inputs,
          output: {
            name: 'momentAnalysis',
            description: `output of ${stepLabel(step)} — read by every later R step`,
          },
        }
      case 'middle': {
        const isLast = step.id === lastMiddle?.id
        return {
          inputs,
          output: {
            name: isLast ? 'associationLenses' : String(step.orderBy),
            description: isLast
              ? `output of ${stepLabel(step)} — read by ${stepLabel(r2Step)}`
              : `output of ${stepLabel(step)} — read by the next lens step as \${${step.orderBy}}`,
          },
        }
      }
      case 'r2':
        return {
          inputs,
          output: {
            name: 'pairSelection',
            isList: true,
            description: `selected_images from ${stepLabel(step)}; each entry runs ${stepLabel(r3Step)} once`,
          },
        }
      case 'r3':
        return {
          inputs,
          fanOutOver: 'pairSelection',
          output: {
            name: 'allCaptionResults',
            isList: true,
            description: `this pick\u2019s captions; all branches merge into ${stepLabel(r4Step)}\u2019s input`,
          },
        }
      case 'r4':
        return {
          inputs,
          output: {
            name: 'rankedResults',
            isList: true,
            description: `the top ${topN} image+caption pairs — what the study saves`,
          },
        }
    }
  }

  const stepRow = (
    step: ReverseStep,
    io: StepIo,
    actions: ReactNode,
    output: ReactNode
  ) => (
    <div key={step.id} className="flex flex-col gap-3 xl:flex-row">
      <div className="min-w-0 xl:w-[26rem] xl:shrink-0">
        <StepCard
          step={step}
          flavorId={flavorId}
          inputs={io.inputs.map((i) => i.slot)}
          io={io}
          resolved={resolvedPrompts[step.id]}
          hidden={step.isHidden}
          hideDisabled={hideDisabledReason(step)}
          onToggleHidden={() => toggleStepHidden(step)}
          onSavedPrompt={applyPromptSave(step.id)}
          actions={actions}
        />
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
        {output}
        <ManualStepValue key={`${step.id}:${manualValues[step.id] !== undefined}`}
          initial={manualValues[step.id] ?? ''}
          disabled={runningAll || batchRunning || r1State.status === 'loading' || r2State.status === 'loading' || r4State.status === 'loading' || Object.values(middleStates).some((state) => state.status === 'loading') || Object.values(r3States).some((state) => state.status === 'loading')}
          onApply={(text) => {
            parseManualStepOutput(text)
            setManualValues((current) => ({ ...current, [step.id]: text }))
          }}
          onClear={manualValues[step.id] !== undefined ? () => setManualValues((current) => {
            const next = { ...current }; delete next[step.id]; return next
          }) : undefined} />
        {manualValues[step.id] !== undefined ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Manual value active. Run this step or “To end” to use it. This value applies to every moment and image branch in this experiment until cleared.</p> : null}
      </div>
    </div>
  )

  // Batch-run rollup: every moment that has entered the batch, in study-list
  // order, plus stage counts for the progress bar.
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
  const defaultMoments = studyMoments.filter((m) => m.key.startsWith('ctx-'))
  const brainStudyMoments = studyMoments.filter((m) => m.key.startsWith('sb-'))
  const sidechatStudyMoments = studyMoments.filter((m) => m.key.startsWith('sc-'))
  const sidechatStudyByKey = new Map(sidechatStudyMoments.map((m) => [m.key, m]))

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
                  ? 'no fit'
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

  // "all · none" bulk toggles for one source panel of the batch picker.
  // Source panel "② Archived Sidechat clusterings", shared by the single-moment
  // picker (click a row → THE moment) and the batch picker (check rows).
  const sidechatArchivePanel = (pickMode: 'single' | 'batch') => (
    <div className="rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold">② Archived Sidechat clusterings</p>
          <p className="text-[11px] text-[rgb(var(--muted))]">
            Event clusterings archived from the{' '}
            <a
              href="/sidechat-events"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
            >
              Sidechat events page ↗
            </a>
            . Each reaction group inside an event becomes one moment; an event with no groups is one
            moment. Loading is instant and makes no model calls.
            {pickMode === 'single' ? ' Click a moment to make it the moment.' : ' Check the ones you want in the batch.'}
          </p>
        </div>
        {pickMode === 'batch' && sidechatStudyMoments.length ? (
          <span className="flex items-center gap-2 text-[11px] text-[rgb(var(--muted))]">
            {sidechatStudyMoments.length} loaded {selectAllNone(sidechatStudyMoments)}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[11px] text-[rgb(var(--muted))]">
          Archived clustering
          <select
            value={sidechatArchiveId}
            onChange={(e) => setSidechatArchiveId(e.target.value)}
            disabled={sidechatLoading || batchRunning || sidechatArchive.length === 0}
            className="max-w-[22rem] rounded-md border border-[rgb(var(--gloss)/0.6)] bg-transparent px-2 py-1 text-xs dark:border-[rgb(var(--gloss)/0.2)]"
          >
            {sidechatArchive.length === 0 ? <option value="">(none archived)</option> : null}
            {sidechatArchive.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.windowDays}d · {a.postCount} posts
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void loadSidechatArchived()}
          disabled={sidechatLoading || batchRunning || !sidechatArchiveId}
          className="rounded-lg bg-[rgb(var(--accent-strong))] px-5 py-2 text-sm font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
          title="Open this archived clustering and turn its events into moments — no model calls"
        >
          {sidechatLoading ? 'Loading archive…' : sidechatMoments.length ? 'Load a different archive' : 'Load archived moments'}
        </button>
      </div>
      {sidechatArchiveNote && sidechatArchive.length === 0 ? (
        <p className="mt-2 text-xs text-[rgb(var(--muted))]">{sidechatArchiveNote}</p>
      ) : null}
      {sidechatError ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">Archive: {sidechatError}</p>
      ) : null}
      {sidechatLoaded ? (
        <p className="mt-2 text-xs text-[rgb(var(--muted))]">
          Loaded &ldquo;{sidechatLoaded.name}&rdquo;: {sidechatLoaded.postCount} posts →{' '}
          {sidechatLoaded.momentCount} moment{sidechatLoaded.momentCount === 1 ? '' : 's'} across{' '}
          {sidechatLoaded.eventCount} event{sidechatLoaded.eventCount === 1 ? '' : 's'}.
        </p>
      ) : null}
      {sidechatByEvent.length ? (
        <div className="mt-2 max-h-[28rem] space-y-3 overflow-y-auto rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.12)]">
          {sidechatByEvent.map((ev) => {
            const rows = ev.moments.map((m) => sidechatStudyByKey.get(m.key)).filter((m): m is StudyMoment => Boolean(m))
            const posts = ev.moments.reduce((n, m) => n + m.postCount, 0)
            return (
              <div key={ev.eventIndex}>
                <div className="flex flex-wrap items-center justify-between gap-2 px-1.5">
                  <p className="text-[11px] font-semibold text-[rgb(var(--muted))]">
                    Event {ev.eventIndex + 1}: {ev.eventTitle}{' '}
                    <span className="font-normal">
                      · {ev.moments.length} moment{ev.moments.length === 1 ? '' : 's'} · {posts} posts
                    </span>
                  </p>
                  {pickMode === 'batch' && rows.length > 1 ? selectAllNone(rows) : null}
                </div>
                <div className="mt-1 space-y-1">
                  {pickMode === 'single'
                    ? ev.moments.map((m) => momentRow(m.key, m.text, m.reaction ?? 'whole event'))
                    : rows.map(renderMomentRow)}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )

  const selectAllNone = (items: StudyMoment[]) => (
    <span className="flex items-center gap-2 text-[11px] text-[rgb(var(--muted))]">
      <button
        type="button"
        onClick={() => selectMoments(items, true)}
        disabled={batchRunning}
        className="font-semibold text-[rgb(var(--primary))] transition hover:brightness-110 disabled:opacity-40"
      >
        all
      </button>
      ·
      <button
        type="button"
        onClick={() => selectMoments(items, false)}
        disabled={batchRunning}
        className="font-semibold text-[rgb(var(--primary))] transition hover:brightness-110 disabled:opacity-40"
      >
        none
      </button>
    </span>
  )

  return (
    <div className="flex flex-col gap-4">
      <BulkModelSelect models={models} disabled={runningAll || batchRunning || r1State.status === 'loading' || r2State.status === 'loading' || r4State.status === 'loading' || Object.values(middleStates).some((state) => state.status === 'loading') || Object.values(r3States).some((state) => state.status === 'loading')}
        description="Use one model for all steps in this experiment. Save permanent model choices on the flavor page. Manual values are kept."
        onApply={(model) => setSteps((current) => current.map((step) => ({ ...step, providerModelId: model.provider_model_id, isTemperatureSupported: model.is_temperature_supported, temperature: model.is_temperature_supported ? step.temperature : null })))} />
      {profilesTableMissing ? (
        <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
          The <code>image_reaction_profiles</code> table does not exist yet in
          this database — run its migration, then preprocess images on the
          reverse page.
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

      {/* 1 · Image set */}
      <section className={sectionCard}>
        <h2 className="text-sm font-semibold">1 · Image set</h2>
        <div className="mt-2 flex flex-wrap items-center gap-3">
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
          <span className="text-[11px] text-[rgb(var(--muted))]">
            profiles: {counts.fresh} fresh · {counts.stale} stale ·{' '}
            {counts.missing} missing
            {counts.stale + counts.missing > 0 ? (
              <>
                {' — '}
                <a
                  href={`/humor-flavor/${flavorId}/reverse${setId ? `?set=${setId}` : ''}`}
                  className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                >
                  preprocess on the reverse page →
                </a>
              </>
            ) : null}
          </span>
          {counts.stale + counts.missing > 0 ? (
            <span className="flex items-center gap-1.5 text-[11px] text-[rgb(var(--muted))]">
              or copy from flavor
              <input
                value={copySourceId}
                onChange={(e) => setCopySourceId(e.target.value)}
                placeholder="1540"
                inputMode="numeric"
                className="w-16 rounded-md border border-[rgb(var(--gloss)/0.6)] bg-transparent px-2 py-1 text-xs dark:border-[rgb(var(--gloss)/0.2)]"
              />
              <button
                type="button"
                onClick={() => void copyProfiles()}
                disabled={copyState.status === 'copying'}
                className={ghostButton}
              >
                {copyState.status === 'copying' ? 'Copying…' : 'Copy profiles'}
              </button>
              {copyState.status === 'error' ? (
                <span className="text-[rgb(var(--accent-strong))]">
                  {copyState.error}
                </span>
              ) : null}
            </span>
          ) : copyState.status === 'done' ? (
            <span className="text-[11px] text-[rgb(var(--muted))]">
              {copyState.note}
            </span>
          ) : null}
        </div>
      </section>

      {/* 2 · The moment (single run) */}
      {mode === 'single' ? (
      <section className={sectionCard}>
        <h2 className="text-sm font-semibold">2 · The moment</h2>
        <p className="mt-1 text-xs text-[rgb(var(--muted))]">
          ONE piece of community context to find reaction images for. Set it
          any of four ways — the text box always holds the moment that runs.
          Looking for material?{' '}
          <a
            href="/sidechat-topics"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
          >
            browse clustered Sidechat posts ↗
          </a>
        </p>

        <div className="mt-3 rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
          <p className="text-[13px] font-semibold">① Write your own</p>
          <textarea
            value={moment}
            onChange={(e) => setMoment(e.target.value)}
            rows={2}
            placeholder="e.g. The Lerner ramps become an ice rink every time it rains."
            className={`${resultPre} mt-2 block w-full resize-y text-[13px] focus:border-[rgb(var(--primary))] focus:outline-none`}
          />
        </div>

        <div className="mt-3">{sidechatArchivePanel('single')}</div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
            <p className="text-[13px] font-semibold">
              ③ Recent Columbia topics (Student Brain)
            </p>
            <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">
              Live topics from the Student Brain API. Load them, then click one
              to make it the moment.
            </p>
            <div className="mt-2">
              <button
                type="button"
                onClick={loadBrainContexts}
                disabled={brainLoading}
                className="rounded-lg bg-[rgb(var(--accent-strong))] px-5 py-2 text-sm font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
                title="Fetch recent contexts from the Student Brain API — the same source as ${studentBrainOutput} in the ops pipeline"
              >
                {brainLoading
                  ? 'Loading Student Brain…'
                  : brainMoments.length
                    ? `🧠 Reload Student Brain (${brainMoments.length})`
                    : '🧠 Load Student Brain topics'}
              </button>
            </div>
            {brainError ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                Student Brain: {brainError}
              </p>
            ) : null}
            {brainMoments.length ? (
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.12)]">
                {brainMoments.map((m) => momentRow(m.key, m.text, m.title))}
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
            <p className="text-[13px] font-semibold">
              ④ Default Columbia topics ({contexts.length})
            </p>
            <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">
              The built-in community-context corpus. Click one to make it the
              moment.
            </p>
            <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.12)]">
              {contexts.map((c) => momentRow(c.id, c.content))}
            </div>
          </div>
        </div>
      </section>
      ) : null}

      {/* 2 · Moments (batch run) */}
      {mode === 'batch' ? (
      <section className={sectionCard}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">2 · Moments</h2>
            <p className="mt-1 text-xs text-[rgb(var(--muted))]">
              Four ways to add moments to the batch — mix and match them all.
              Every checked moment, from any source, runs through R1→R4.
              Looking for material?{' '}
              <a
                href="/sidechat-topics"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
              >
                browse clustered Sidechat posts ↗
              </a>
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
                  {customMoments.length} added {selectAllNone(customMoments)}
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

          {/* Source 2: archived Sidechat clusterings */}
          {sidechatArchivePanel('batch')}

          {/* Source 3: Student Brain */}
          <div className="rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold">
                  ③ Recent Columbia topics (Student Brain)
                </p>
                <p className="text-[11px] text-[rgb(var(--muted))]">
                  Live topics from the Student Brain API. Load them, then check
                  the ones you want in the batch.
                </p>
              </div>
              {brainStudyMoments.length ? (
                <span className="flex items-center gap-2 text-[11px] text-[rgb(var(--muted))]">
                  {brainStudyMoments.length} loaded{' '}
                  {selectAllNone(brainStudyMoments)}
                </span>
              ) : null}
            </div>
            <div className="mt-2">
              <button
                type="button"
                onClick={loadBrainContexts}
                disabled={brainLoading || batchRunning}
                className="rounded-lg bg-[rgb(var(--accent-strong))] px-5 py-2 text-sm font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
                title="Fetch recent contexts from the Student Brain API — the same source as ${studentBrainOutput} in the ops pipeline"
              >
                {brainLoading
                  ? 'Loading Student Brain…'
                  : brainMoments.length
                    ? `🧠 Reload Student Brain (${brainMoments.length})`
                    : '🧠 Load Student Brain topics'}
              </button>
            </div>
            {brainError ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                Student Brain: {brainError}
              </p>
            ) : null}
            {brainStudyMoments.length ? (
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.12)]">
                {brainStudyMoments.map(renderMomentRow)}
              </div>
            ) : null}
          </div>

          {/* Source 4: default topics */}
          <div className="rounded-lg border border-[rgb(var(--gloss)/0.4)] p-3 dark:border-[rgb(var(--gloss)/0.12)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold">
                  ④ Default Columbia topics
                </p>
                <p className="text-[11px] text-[rgb(var(--muted))]">
                  The built-in community-context corpus ({defaultMoments.length}
                  {' '}topics). Check the ones you want in the batch.
                </p>
              </div>
              {selectAllNone(defaultMoments)}
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
            onClick={() => void runStudyBatch()}
            disabled={
              batchRunning || runningAll || !catalog.length || !selectedCount
            }
            className="rounded-lg bg-[rgb(var(--primary))] px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
          >
            {batchRunning
              ? 'Running batch…'
              : `Run batch (${selectedCount} moment${selectedCount === 1 ? '' : 's'})`}
          </button>
          <label className="flex items-center gap-1 text-[11px] text-[rgb(var(--muted))]">
            keep the best
            <input
              type="number"
              min={1}
              max={30}
              value={topN}
              onChange={(e) =>
                setTopN(Math.min(30, Math.max(1, Number(e.target.value) || 1)))
              }
              disabled={batchRunning}
              className="w-14 rounded-md border border-[rgb(var(--gloss)/0.6)] bg-transparent px-1.5 py-0.5 text-xs dark:border-[rgb(var(--gloss)/0.2)]"
            />
            pairs per moment
          </label>
          <span className="text-[11px] text-[rgb(var(--muted))]">
            hidden steps (🚫 in the rail below) are skipped · each moment&rsquo;s
            results save as captions rows as it completes
          </span>
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
                      R2 selected no image that clears the alignment floor for
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

      {/* 3 · Run (single run) */}
      {mode === 'single' ? (
      <section className={sectionCard}>
        <h2 className="text-sm font-semibold">3 · Run the R steps</h2>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => void runFromStep(1)}
            disabled={runningAll || !moment.trim() || !catalog.length}
            className="rounded-lg bg-[rgb(var(--primary))] px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
          >
            {runningAll ? 'Running R1→R4…' : '▶ Run all R steps'}
          </button>
          <label className="flex items-center gap-1 text-[11px] text-[rgb(var(--muted))]">
            keep the best
            <input
              type="number"
              min={1}
              max={30}
              value={topN}
              onChange={(e) =>
                setTopN(Math.min(30, Math.max(1, Number(e.target.value) || 1)))
              }
              className="w-14 rounded-md border border-[rgb(var(--gloss)/0.6)] bg-transparent px-1.5 py-0.5 text-xs dark:border-[rgb(var(--gloss)/0.2)]"
            />
            image+caption pairs
          </label>
          <span className="text-[11px] text-[rgb(var(--muted))]">
            hidden steps (🚫 in the rail below) are skipped
          </span>
        </div>
      </section>
      ) : null}

      <div className="flex items-start gap-4">
        {/* Step rail — R steps only */}
        <nav className="sticky top-4 hidden w-60 shrink-0 flex-col gap-0.5 rounded-lg border border-[rgb(var(--gloss)/0.4)] p-2 lg:flex dark:border-[rgb(var(--gloss)/0.12)]">
          <p className={outLabel}>R steps (per moment)</p>
          {reverseSteps.map((s) => (
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
          ))}
          <p className="mt-2 border-t border-[rgb(var(--gloss)/0.4)] pt-2 text-[10px] text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.12)]">
            P1–P{preSteps.length} are preprocessing: they already ran per image
            and their cached profiles feed R2/R3. Edit them on the{' '}
            <a
              href={`/humor-flavor/${flavorId}/reverse${setId ? `?set=${setId}` : ''}`}
              className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
            >
              reverse page
            </a>
            .
          </p>
        </nav>

        {/* Step rows: card left, output right */}
        <div className="min-w-0 flex-1 space-y-4">
          {r1Step
            ? stepRow(
                r1Step,
                ioFor(r1Step, 'r1'),
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
                </>,
                <>
                  <p className={outLabel}>Moment analysis</p>
                  {r1State.status === 'error' ? (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                      {r1State.error}
                    </p>
                  ) : null}
                  {r1Text ? (
                    <StructuredOutput text={r1Text} />
                  ) : (
                    <p className="mt-2 text-xs text-[rgb(var(--muted))]">
                      not run yet
                    </p>
                  )}
                </>
              )
            : null}

          {middleSteps.map((s) =>
            stepRow(
              s,
              ioFor(s, 'middle'),
              <>
                <button
                  type="button"
                  onClick={() => runMiddles(r1Text ?? '').catch(() => undefined)}
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
              </>,
              <>
                <p className={outLabel}>
                  Lens catalog — persona-voiced quotes per alternative
                </p>
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
                  <StructuredOutput text={middleStates[s.id]?.text ?? ''} />
                ) : (
                  <p className="mt-2 text-xs text-[rgb(var(--muted))]">
                    not run yet — its output binds as{' '}
                    <code>{'${associationLenses}'}</code> for R2
                  </p>
                )}
              </>
            )
          )}

          {r2Step
            ? stepRow(
                r2Step,
                ioFor(r2Step, 'r2'),
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
                </>,
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={outLabel}>
                      Image selection — the step that finds the right images
                    </p>
                    <span className="text-[10px] text-[rgb(var(--muted))]">
                      searches {catalog.length} search cards
                      {catalog.some((e) => e.stale)
                        ? ` (${catalog.filter((e) => e.stale).length} stale)`
                        : ''}
                    </span>
                  </div>
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[11px] text-[rgb(var(--muted))]">
                      the search catalog R2 selects from (one card per profiled
                      image, from the P-steps)
                    </summary>
                    <pre className={`${resultPre} mt-1 max-h-96`}>
                      {catalogJson}
                    </pre>
                  </details>
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
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                  ) : (
                    <p className="mt-2 text-xs text-[rgb(var(--muted))]">
                      not run yet
                    </p>
                  )}
                  {r2Raw ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[11px] font-semibold text-[rgb(var(--accent-strong))]">
                        every field of R2&rsquo;s output, one column per selected image
                      </summary>
                      <StructuredOutput text={r2Raw} />
                    </details>
                  ) : null}
                </>
              )
            : null}

          {r3Step
            ? stepRow(
                r3Step,
                ioFor(r3Step, 'r3'),
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
                    Run R3 ({r2Picks?.length ?? 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => void runFromStep(3)}
                    disabled={runningAll || !r2Picks?.length}
                    title="Write captions for R2's picks, then rank"
                    className={ghostButton}
                  >
                    ▶▶ To end
                  </button>
                </>,
                <>
                  <p className={outLabel}>
                    Captions per selected image (fan-out)
                  </p>
                  {r2Picks?.length ? (
                    <div className="mt-2 space-y-2">
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
                                <>
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
                                  {state.raw ? (
                                    <details className="mt-1.5">
                                      <summary className="cursor-pointer text-[11px] text-[rgb(var(--muted))]">
                                        every field of this branch&rsquo;s output (speaker, anchors, jokes)
                                      </summary>
                                      <StructuredOutput text={state.raw} className="mt-1" />
                                    </details>
                                  ) : null}
                                </>
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
                </>
              )
            : null}

          {r4Step
            ? stepRow(
                r4Step,
                ioFor(r4Step, 'r4'),
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
                    r4State.status === 'loading' || runningAll || !r2Picks?.length
                  }
                  className={runButton}
                >
                  {r4State.status === 'loading' ? 'Ranking…' : 'Run R4'}
                </button>,
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={outLabel}>
                      Top {topN} image+caption pairs for this moment
                    </p>
                    {archivedRunId ? (
                      <a
                        href={`/humor-flavor/${flavorId}/ops-reverse2?run=${archivedRunId}`}
                        target="_blank"
                        rel="noreferrer"
                        className={ghostButton}
                        title="Open this chain's archived run in the Flavor Inspector (ops-reverse2): every step's rendered prompts and outputs"
                      >
                        Open in Flavor Inspector →
                      </a>
                    ) : null}
                  </div>
                  {r4State.status === 'error' ? (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                      {r4State.error}
                    </p>
                  ) : null}
                  {r4Results?.length ? (
                    <div className="mt-2 grid gap-3 sm:grid-cols-3">
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
                  ) : (
                    <p className="mt-2 text-xs text-[rgb(var(--muted))]">
                      not run yet
                    </p>
                  )}
                </>
              )
            : null}
        </div>
      </div>
    </div>
  )
}
