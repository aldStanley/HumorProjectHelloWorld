'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import BulkModelSelect from '@/components/bulk-model-select'
import { useRouter } from 'next/navigation'

import {
  runStepAction,
  saveAsNewFlavorAction,
  updateFlavorInPlaceAction,
} from './actions'

export type MatrixImage = {
  id: string
  url: string
  additionalContext: string | null
  imageDescription: string | null
  celebrityRecognition: string | null
}

export type MatrixImageSet = {
  id: number
  slug: string
  description: string | null
  images: MatrixImage[]
}

export type MatrixStep = {
  id: number
  stepNumber: number
  orderBy: number
  description: string
  stepTypeId: number
  stepTypeSlug: string | null
  inputTypeId: number
  outputTypeId: number
  modelId: number
  systemPrompt: string
  userPrompt: string
  temperature: number | null
  includeImage: boolean
  modelName: string
  providerModelId: string
  isTemperatureSupported: boolean
  prefillSource: 'celebrity-recognition' | 'image-description' | null
}

export type MatrixOptions = {
  models: {
    id: number
    name: string
    providerModelId: string
    isTemperatureSupported: boolean
  }[]
  stepTypes: { id: number; slug: string }[]
  inputTypes: { id: number; slug: string }[]
  outputTypes: { id: number; slug: string }[]
}

// Latest saved generation for an existing step + image, loaded on open.
export type MatrixSavedOutput = {
  stepId: number
  imageId: string
  output: string
}

type MatrixClientProps = {
  flavorId: number
  flavorSlug: string
  steps: MatrixStep[]
  imageSets: MatrixImageSet[]
  options: MatrixOptions
  savedOutputs: MatrixSavedOutput[]
}

// Local, editable representation of a step (covers existing + newly added).
type EditableStep = {
  key: string
  description: string
  stepTypeId: number
  inputTypeId: number
  outputTypeId: number
  modelId: number
  temperature: number | null
  systemPrompt: string
  userPrompt: string
}

type CellState = {
  status: 'idle' | 'loading' | 'done' | 'error'
  output?: string
  error?: string
}

type EditTarget =
  | { kind: 'system'; stepKey: string }
  | { kind: 'user'; stepKey: string }
  | { kind: 'output'; stepKey: string; imageId: string }

const cellKey = (stepKey: string, imageId: string) => `${stepKey}:${imageId}`

// Refresh-survival: unsaved runs + image selection live only in React state,
// so they are mirrored to localStorage per flavor and restored on mount.
type PersistedMatrixState = {
  activeSetId: number | null
  selectedImageIds: string[]
  outputs: Record<string, string>
}

const persistKeyFor = (flavorId: number) => `matrix-state:${flavorId}`

const readPersistedState = (flavorId: number): PersistedMatrixState | null => {
  try {
    const raw = window.localStorage.getItem(persistKeyFor(flavorId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedMatrixState>
    return {
      activeSetId: typeof parsed.activeSetId === 'number' ? parsed.activeSetId : null,
      selectedImageIds: Array.isArray(parsed.selectedImageIds)
        ? parsed.selectedImageIds.filter((id): id is string => typeof id === 'string')
        : [],
      outputs:
        parsed.outputs && typeof parsed.outputs === 'object'
          ? (parsed.outputs as Record<string, string>)
          : {},
    }
  } catch {
    return null
  }
}

const formatLabel = (slug: string) =>
  slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

const prefillSourceFor = (
  slug: string | null
): 'celebrity-recognition' | 'image-description' | null => {
  if (slug === 'celebrity-recognition') return 'celebrity-recognition'
  if (slug === 'image-description') return 'image-description'
  return null
}

export default function MatrixClient({
  flavorId,
  flavorSlug,
  steps,
  imageSets,
  options,
  savedOutputs,
}: MatrixClientProps) {
  const router = useRouter()

  const modelById = useMemo(
    () => new Map(options.models.map((m) => [m.id, m])),
    [options.models]
  )
  const stepTypeSlugById = useMemo(
    () => new Map(options.stepTypes.map((t) => [t.id, t.slug])),
    [options.stepTypes]
  )

  // Sensible defaults for a freshly added step.
  const generalStepTypeId =
    options.stepTypes.find((t) => t.slug === 'general')?.id ??
    options.stepTypes[0]?.id ??
    0
  const textInputTypeId =
    options.inputTypes.find((t) => t.slug === 'text-only')?.id ??
    options.inputTypes[0]?.id ??
    2
  const stringOutputTypeId =
    options.outputTypes.find((t) => t.slug === 'string')?.id ??
    options.outputTypes[0]?.id ??
    1
  const defaultModelId = options.models[0]?.id ?? 0

  const newKeyCounter = useRef(0)
  const makeKey = () => {
    newKeyCounter.current += 1
    return `new-${newKeyCounter.current}`
  }

  const [localSteps, setLocalSteps] = useState<EditableStep[]>(() =>
    steps.map((s) => ({
      key: `s${s.id}`,
      description: s.description,
      stepTypeId: s.stepTypeId,
      inputTypeId: s.inputTypeId,
      outputTypeId: s.outputTypeId,
      modelId: s.modelId,
      temperature: s.temperature,
      systemPrompt: s.systemPrompt,
      userPrompt: s.userPrompt,
    }))
  )

  const [activeSetId, setActiveSetId] = useState<number | null>(
    imageSets[0]?.id ?? null
  )
  const activeSet = useMemo(
    () => imageSets.find((s) => s.id === activeSetId) ?? null,
    [imageSets, activeSetId]
  )
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>(
    () => (imageSets[0]?.images ?? []).slice(0, 3).map((img) => img.id)
  )
  const [cells, setCells] = useState<Record<string, CellState>>(() => {
    const init: Record<string, CellState> = {}
    savedOutputs.forEach(({ stepId, imageId, output }) => {
      init[cellKey(`s${stepId}`, imageId)] = { status: 'done', output }
    })
    return init
  })
  // Restore persisted state after mount (not in initializers — localStorage
  // is unavailable during SSR and would cause a hydration mismatch).
  const hydratedRef = useRef(false)
  useEffect(() => {
    const persisted = readPersistedState(flavorId)
    if (persisted) {
      const set = imageSets.find((s) => s.id === persisted.activeSetId)
      if (set) {
        setActiveSetId(set.id)
        const validIds = new Set(set.images.map((img) => img.id))
        const restoredIds = persisted.selectedImageIds.filter((id) =>
          validIds.has(id)
        )
        if (restoredIds.length) setSelectedImageIds(restoredIds)
      }
      const validStepKeys = new Set(localSteps.map((s) => s.key))
      const restoredCells = Object.entries(persisted.outputs).filter(
        ([key]) => validStepKeys.has(key.slice(0, key.indexOf(':')))
      )
      if (restoredCells.length) {
        setCells((prev) => {
          const next = { ...prev }
          restoredCells.forEach(([key, output]) => {
            next[key] = { status: 'done', output }
          })
          return next
        })
      }
    }
    hydratedRef.current = true
    // Run once on mount only; imageSets/steps are stable for the page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mirror the working state to localStorage so a refresh restores it.
  useEffect(() => {
    if (!hydratedRef.current) return
    const outputs: Record<string, string> = {}
    Object.entries(cells).forEach(([key, state]) => {
      if (state.status === 'done' && state.output != null) {
        outputs[key] = state.output
      }
    })
    try {
      window.localStorage.setItem(
        persistKeyFor(flavorId),
        JSON.stringify({ activeSetId, selectedImageIds, outputs })
      )
    } catch {
      // Best-effort (quota/private mode) — never break the page over this.
    }
  }, [flavorId, activeSetId, selectedImageIds, cells])

  const [sidebar, setSidebar] = useState<EditTarget | null>(null)
  const [jokesView, setJokesView] = useState<{
    stepKey: string
    imageId: string
  } | null>(null)
  const [copied, setCopied] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Save-as-new-flavor modal state
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState(`${flavorSlug}-edited`)
  const [saveDescription, setSaveDescription] = useState('')
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'error' | 'done'
  >('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveWarning, setSaveWarning] = useState<string | null>(null)
  const [savedFlavorId, setSavedFlavorId] = useState<number | null>(null)

  // Update-this-flavor (overwrite in place) modal state
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'saving' | 'error' | 'done'
  >('idle')
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateWarning, setUpdateWarning] = useState<string | null>(null)

  const stepByKey = useMemo(
    () => new Map(localSteps.map((s) => [s.key, s])),
    [localSteps]
  )
  const imageById = useMemo(
    () => new Map((activeSet?.images ?? []).map((img) => [img.id, img])),
    [activeSet]
  )
  const selectedImages = useMemo(
    () =>
      (activeSet?.images ?? []).filter((img) =>
        selectedImageIds.includes(img.id)
      ),
    [activeSet, selectedImageIds]
  )

  // ---- derived per-step helpers ----
  const slugOf = (step: EditableStep) =>
    stepTypeSlugById.get(step.stepTypeId) ?? null
  const prefillOf = (step: EditableStep) => prefillSourceFor(slugOf(step))
  const includesImage = (step: EditableStep) => step.inputTypeId === 1

  const cachedValue = (
    step: EditableStep,
    image: MatrixImage
  ): string | null => {
    const source = prefillOf(step)
    if (source === 'celebrity-recognition')
      return image.celebrityRecognition?.trim() || null
    if (source === 'image-description')
      return image.imageDescription?.trim() || null
    return null
  }

  const outputValue = (
    step: EditableStep,
    image: MatrixImage
  ): string | null => {
    const computed = cells[cellKey(step.key, image.id)]?.output
    if (computed != null) return computed
    return cachedValue(step, image)
  }

  const sourceOf = (
    step: EditableStep,
    image: MatrixImage
  ): 'computed' | 'cached' | null => {
    if (cells[cellKey(step.key, image.id)]?.output != null) return 'computed'
    if (cachedValue(step, image) != null) return 'cached'
    return null
  }

  // ---- step mutation ----
  const patchStep = (key: string, patch: Partial<EditableStep>) =>
    setLocalSteps((prev) =>
      prev.map((s) => (s.key === key ? { ...s, ...patch } : s))
    )

  const addStepAfter = (index: number) => {
    const newStep: EditableStep = {
      key: makeKey(),
      description: '',
      stepTypeId: generalStepTypeId,
      inputTypeId: textInputTypeId,
      outputTypeId: stringOutputTypeId,
      modelId: defaultModelId,
      temperature: 0.7,
      systemPrompt: '',
      userPrompt: '',
    }
    setLocalSteps((prev) => {
      const next = [...prev]
      next.splice(index + 1, 0, newStep)
      return next
    })
  }

  const removeStep = (key: string) => {
    setLocalSteps((prev) => prev.filter((s) => s.key !== key))
    setCells((prev) => {
      const next: Record<string, CellState> = {}
      Object.entries(prev).forEach(([k, v]) => {
        if (!k.startsWith(`${key}:`)) next[k] = v
      })
      return next
    })
  }

  // ---- read/write for editable surfaces (cells + sidebar) ----
  const getValue = (t: EditTarget): string => {
    const step = stepByKey.get(t.stepKey)
    if (!step) return ''
    if (t.kind === 'system') return step.systemPrompt
    if (t.kind === 'user') return step.userPrompt
    const image = imageById.get(t.imageId)
    if (!image) return ''
    return outputValue(step, image) ?? ''
  }

  const setValue = (t: EditTarget, value: string) => {
    if (t.kind === 'system') return patchStep(t.stepKey, { systemPrompt: value })
    if (t.kind === 'user') return patchStep(t.stepKey, { userPrompt: value })
    const key = cellKey(t.stepKey, t.imageId)
    setCells((prev) => ({
      ...prev,
      [key]: { ...prev[key], status: 'done', output: value, error: undefined },
    }))
  }

  const runCell = async (step: EditableStep, image: MatrixImage) => {
    const key = cellKey(step.key, image.id)
    const model = modelById.get(step.modelId)
    if (!model) {
      setCells((prev) => ({
        ...prev,
        [key]: { status: 'error', error: 'Pick a model for this step first.' },
      }))
      return
    }
    setCells((prev) => ({ ...prev, [key]: { status: 'loading' } }))

    const index = localSteps.findIndex((s) => s.key === step.key)
    const priorOutputs: Record<string, string> = {}
    localSteps.slice(0, index).forEach((s, i) => {
      priorOutputs[String(i + 1)] = outputValue(s, image) ?? ''
    })

    const result = await runStepAction({
      imageId: image.id,
      systemPrompt: step.systemPrompt,
      userPrompt: step.userPrompt,
      providerModelId: model.providerModelId,
      temperature: step.temperature,
      includeImage: includesImage(step),
      isTemperatureSupported: model.isTemperatureSupported,
      priorOutputs,
    })

    const nextState: CellState = result.ok
      ? { status: 'done', output: result.text ?? '' }
      : { status: 'error', error: result.error ?? 'Unknown error.' }
    setCells((prev) => ({ ...prev, [key]: nextState }))
  }

  const runStepForAllImages = async (step: EditableStep) => {
    await Promise.all(selectedImages.map((image) => runCell(step, image)))
  }

  // Existing DB step id encoded in the key (`s196` -> 196); null for new steps.
  const dbIdOf = (key: string): number | null => {
    const m = key.match(/^s(\d+)$/)
    return m ? Number(m[1]) : null
  }

  const buildStepPayload = (s: EditableStep) => {
    const model = modelById.get(s.modelId)
    return {
      stepTypeId: s.stepTypeId,
      inputTypeId: s.inputTypeId,
      outputTypeId: s.outputTypeId,
      modelId: s.modelId,
      temperature: model?.isTemperatureSupported ? s.temperature : null,
      systemPrompt: s.systemPrompt,
      userPrompt: s.userPrompt,
      description: s.description.trim() || null,
    }
  }

  // Snapshot every cell that has a computed (LLM-generated) value.
  const collectOutputs = () => {
    const out: { stepIndex: number; imageId: string; output: string }[] = []
    Object.entries(cells).forEach(([key, state]) => {
      if (state.output == null) return
      const sep = key.indexOf(':')
      const stepKey = key.slice(0, sep)
      const imageId = key.slice(sep + 1)
      const stepIndex = localSteps.findIndex((s) => s.key === stepKey)
      if (stepIndex < 0) return
      out.push({ stepIndex, imageId, output: state.output })
    })
    return out
  }

  // Serialize the whole matrix (prompts + outputs for the selected images).
  const buildCopyText = () => {
    const lines: string[] = [`Flavor: ${flavorSlug}`, '']
    localSteps.forEach((step, index) => {
      const n = index + 1
      const name = step.description.trim() || '(unnamed)'
      const typeSlug = slugOf(step)
      const typeLabel = typeSlug ? formatLabel(typeSlug) : 'Step'
      const modelName = modelById.get(step.modelId)?.name ?? 'Unknown model'
      lines.push(`=== Step ${n}: ${name} ===`)
      lines.push(
        `Variable: \${step${n}Output}  |  Type: ${typeLabel}  |  Model: ${modelName}  |  Image: ${
          includesImage(step) ? 'yes' : 'no'
        }`
      )
      lines.push('', 'System Prompt:')
      lines.push(getValue({ kind: 'system', stepKey: step.key }) || '(empty)')
      lines.push('', 'User Prompt:')
      lines.push(getValue({ kind: 'user', stepKey: step.key }) || '(empty)')
      lines.push('')
      selectedImages.forEach((image, imgIdx) => {
        const val = getValue({
          kind: 'output',
          stepKey: step.key,
          imageId: image.id,
        })
        lines.push(`Image ${imgIdx + 1} output:`)
        lines.push(val || '(not run)')
        lines.push('')
      })
      lines.push('')
    })
    return lines.join('\n')
  }

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(buildCopyText())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const handleSave = async () => {
    setSaveStatus('saving')
    setSaveError(null)
    setSaveWarning(null)
    const result = await saveAsNewFlavorAction({
      slug: saveName,
      description: saveDescription.trim() || null,
      steps: localSteps.map(buildStepPayload),
      outputs: collectOutputs(),
    })
    if (result.ok && result.flavorId) {
      setSavedFlavorId(result.flavorId)
      setSaveWarning(result.outputsWarning ?? null)
      setSaveStatus('done')
    } else {
      setSaveError(result.error ?? 'Unable to save.')
      setSaveStatus('error')
    }
  }

  const handleUpdate = async () => {
    setUpdateStatus('saving')
    setUpdateError(null)
    setUpdateWarning(null)
    const result = await updateFlavorInPlaceAction({
      flavorId,
      steps: localSteps.map((s) => ({
        ...buildStepPayload(s),
        id: dbIdOf(s.key),
      })),
      outputs: collectOutputs(),
    })
    if (result.ok) {
      setUpdateWarning(result.outputsWarning ?? null)
      setUpdateStatus('done')
      router.refresh()
    } else {
      setUpdateError(result.error ?? 'Unable to update.')
      setUpdateStatus('error')
    }
  }

  const handleSelectSet = (setId: number) => {
    const set = imageSets.find((s) => s.id === setId)
    setActiveSetId(setId)
    setSelectedImageIds((set?.images ?? []).slice(0, 3).map((img) => img.id))
    setSidebar(null)
  }

  const toggleImage = (imageId: string) => {
    setSelectedImageIds((prev) =>
      prev.includes(imageId)
        ? prev.filter((id) => id !== imageId)
        : [...prev, imageId]
    )
  }

  if (!imageSets.length) {
    return (
      <p className="text-sm text-[rgb(var(--muted))]">
        No study image sets with images are available.
      </p>
    )
  }

  const colWidth = 'w-[320px] max-w-[320px]'
  const editAreaClass =
    'w-full resize rounded-lg bg-[rgb(var(--panel)/0.6)] p-2 font-sans text-[11px] leading-relaxed text-[rgb(var(--ink))] outline-none focus:ring-1 focus:ring-[rgb(var(--primary))] dark:bg-[rgb(var(--panel)/0.12)]'
  const selectClass =
    'mt-1 w-full rounded-md border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-1.5 py-1 text-[10px] text-[rgb(var(--ink))] outline-none focus:ring-1 focus:ring-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.12)]'
  const totalCols = 3 + selectedImages.length

  // Pulls every {caption, ...} object out of a step output, whatever the
  // step's JSON shape (captions[], jokes_by_candidate[].jokes[], plain lists).
  // Falls back to a regex scan when the output is not parseable JSON.
  const extractJokes = (
    raw: string
  ): { caption: string; scores: [string, number][] }[] => {
    const out: { caption: string; scores: [string, number][] }[] = []
    const SCORE_KEYS = [
      'fit',
      'dynamic_alignment',
      'cast_derivation',
      'mapping_overall',
      'overall',
    ]
    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (node && typeof node === 'object') {
        const rec = node as Record<string, unknown>
        if (typeof rec.caption === 'string' && rec.caption.trim()) {
          const scores: [string, number][] = []
          for (const k of SCORE_KEYS) {
            if (typeof rec[k] === 'number')
              scores.push([k.replace(/_/g, ' '), rec[k] as number])
          }
          out.push({ caption: rec.caption.trim(), scores })
        }
        Object.values(rec).forEach(walk)
      }
    }
    try {
      const stripped = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/, '')
      walk(JSON.parse(stripped))
    } catch {
      for (const m of raw.matchAll(/"caption"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
        try {
          out.push({ caption: JSON.parse(`"${m[1]}"`) as string, scores: [] })
        } catch {
          // skip unparseable fragment
        }
      }
    }
    return out
  }

  const popOutButton = (target: EditTarget) => (
    <button
      type="button"
      onClick={() => setSidebar(target)}
      title="Pop out to sidebar"
      className="rounded border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-1.5 py-0.5 text-[10px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
    >
      ⤢
    </button>
  )

  const addStepRow = (index: number, label: string) => (
    <tr>
      <td colSpan={totalCols} className="bg-[rgb(var(--panel)/0.4)] p-0 dark:bg-[rgb(var(--panel)/0.06)]">
        <div className="flex justify-center py-1">
          <button
            type="button"
            onClick={() => addStepAfter(index)}
            className="rounded-full border border-dashed border-[rgb(var(--primary)/0.5)] bg-[rgb(var(--panel)/0.7)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[rgb(var(--accent-strong))] transition hover:-translate-y-0.5 hover:border-solid dark:bg-[rgb(var(--panel)/0.1)]"
          >
            + {label}
          </button>
        </div>
      </td>
    </tr>
  )

  const sidebarStep = sidebar ? stepByKey.get(sidebar.stepKey) ?? null : null
  const sidebarImage =
    sidebar?.kind === 'output' ? imageById.get(sidebar.imageId) ?? null : null
  const sidebarTitle = (() => {
    if (!sidebar || !sidebarStep) return ''
    const num = localSteps.findIndex((s) => s.key === sidebar.stepKey) + 1
    if (sidebar.kind === 'system') return `System Prompt · Step ${num}`
    if (sidebar.kind === 'user') return `User Prompt · Step ${num}`
    const idx = selectedImages.findIndex((i) => i.id === sidebar.imageId)
    return `Step ${num} · Image ${idx >= 0 ? idx + 1 : ''}`
  })()

  return (
    <div className="space-y-6">
      <BulkModelSelect models={options.models.map((model) => ({ ...model, provider_model_id: model.providerModelId, is_temperature_supported: model.isTemperatureSupported }))}
        disabled={Object.values(cells).some((cell) => cell.status === 'loading')}
        description="Applies to every step in this experiment. Use Update this flavor or Save as new flavor to save your model choices."
        onApply={(model) => setLocalSteps((current) => current.map((step) => ({ ...step, modelId: model.id, temperature: model.is_temperature_supported ? step.temperature : null })))} />
      <div className="flex items-center justify-end gap-3">
        <p className="text-[11px] text-[rgb(var(--muted))]">
          Prompt &amp; step edits are local until you save them.
        </p>
        <button
          type="button"
          onClick={handleCopyAll}
          className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--accent-strong))] transition hover:-translate-y-0.5 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
        >
          {copied ? 'Copied!' : 'Copy all'}
        </button>
        <button
          type="button"
          onClick={() => {
            setUpdateStatus('idle')
            setUpdateError(null)
            setUpdateOpen(true)
          }}
          className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--accent-strong))] transition hover:-translate-y-0.5 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
        >
          Update this flavor
        </button>
        <button
          type="button"
          onClick={() => {
            setSaveStatus('idle')
            setSaveError(null)
            setSaveName(`${flavorSlug}-edited`)
            setSaveOpen(true)
          }}
          className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--on-primary))] transition hover:-translate-y-0.5"
        >
          Save as new flavor
        </button>
      </div>

      {/* Image set selector */}
      <section className="rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-4 dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.05)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
          1. Choose an image set
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {imageSets.map((set) => (
            <button
              key={set.id}
              type="button"
              onClick={() => handleSelectSet(set.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                set.id === activeSetId
                  ? 'border-transparent bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] text-[rgb(var(--on-primary))]'
                  : 'border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.7)] text-[rgb(var(--ink))] hover:-translate-y-0.5 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]'
              }`}
            >
              {formatLabel(set.slug)} ({set.images.length})
            </button>
          ))}
        </div>

        {activeSet ? (
          <>
            <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
              2. Select images to compare (columns)
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              {activeSet.images.map((image, index) => {
                const selected = selectedImageIds.includes(image.id)
                return (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => toggleImage(image.id)}
                    title={image.additionalContext ?? undefined}
                    className={`relative h-16 w-16 overflow-hidden rounded-xl border-2 transition ${
                      selected
                        ? 'border-[rgb(var(--primary))] shadow-[0_0_0_2px_rgb(var(--primary)/0.4)]'
                        : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.url}
                      alt={`Image ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                    <span
                      onClick={(e) => {
                        e.stopPropagation()
                        setPreviewUrl(image.url)
                      }}
                      title="Enlarge"
                      className="absolute left-0 top-0 cursor-zoom-in rounded-br-md bg-[rgb(var(--shadow)/0.6)] px-1 text-[10px] leading-tight text-white"
                    >
                      ⤢
                    </span>
                    {selected ? (
                      <span className="absolute bottom-0 right-0 rounded-tl-md bg-[rgb(var(--primary))] px-1 text-[9px] font-bold text-[rgb(var(--on-primary))]">
                        {selectedImageIds.indexOf(image.id) + 1}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </>
        ) : null}
      </section>

      {/* Matrix table */}
      {selectedImages.length === 0 ? (
        <p className="text-sm text-[rgb(var(--muted))]">
          Select at least one image to build the matrix.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[rgb(var(--gloss)/0.7)] dark:border-[rgb(var(--gloss)/0.1)]">
          <table className="border-collapse text-left align-top">
            <thead>
              <tr className="bg-[rgb(var(--panel)/0.9)] text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))] dark:bg-[rgb(var(--panel)/0.1)]">
                <th className="sticky left-0 z-10 w-[200px] min-w-[200px] max-w-[200px] border-b border-r border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.95)] p-3 dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.15)]">
                  Step / Config
                </th>
                <th className={`${colWidth} border-b border-r border-[rgb(var(--gloss)/0.5)] p-3 dark:border-[rgb(var(--gloss)/0.1)]`}>
                  System Prompt
                </th>
                <th className={`${colWidth} border-b border-r border-[rgb(var(--gloss)/0.5)] p-3 dark:border-[rgb(var(--gloss)/0.1)]`}>
                  User Prompt
                </th>
                {selectedImages.map((image, index) => (
                  <th
                    key={image.id}
                    className={`${colWidth} border-b border-r border-[rgb(var(--gloss)/0.5)] p-3 dark:border-[rgb(var(--gloss)/0.1)]`}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewUrl(image.url)}
                        title="Click to enlarge"
                        className="shrink-0"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.url}
                          alt={`Image ${index + 1}`}
                          className="h-9 w-9 cursor-zoom-in rounded-md object-cover transition hover:ring-2 hover:ring-[rgb(var(--primary))]"
                        />
                      </button>
                      <span>Image {index + 1}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {localSteps.map((step, index) => {
                const stepNumber = index + 1
                const prefill = prefillOf(step)
                return (
                  <Fragment key={step.key}>
                    <tr className="align-top text-xs text-[rgb(var(--ink))]">
                      {/* Column 0: variable + config + run-all + remove */}
                      <td className="sticky left-0 z-10 w-[200px] min-w-[200px] max-w-[200px] border-b border-r border-[rgb(var(--gloss)/0.4)] bg-[rgb(var(--panel)/0.92)] p-3 dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.12)]">
                        <div className="flex items-center justify-between">
                          <code className="rounded bg-[rgb(var(--primary)/0.12)] px-1.5 py-0.5 text-[11px] font-semibold text-[rgb(var(--accent-strong))]">
                            {`\${step${stepNumber}Output}`}
                          </code>
                          <button
                            type="button"
                            onClick={() => removeStep(step.key)}
                            title="Remove step"
                            className="rounded px-1 text-[12px] text-[rgb(var(--muted))] transition hover:text-red-500"
                          >
                            ✕
                          </button>
                        </div>

                        <input
                          value={step.description}
                          onChange={(e) =>
                            patchStep(step.key, { description: e.target.value })
                          }
                          placeholder="Name / purpose…"
                          className="mt-2 w-full rounded-md border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-1.5 py-1 text-[11px] font-semibold text-[rgb(var(--ink))] outline-none placeholder:font-normal placeholder:text-[rgb(var(--muted))] focus:ring-1 focus:ring-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.12)]"
                        />

                        <label className="mt-2 block text-[9px] font-semibold uppercase tracking-[0.15em] text-[rgb(var(--muted))]">
                          Step type
                          <select
                            value={step.stepTypeId}
                            onChange={(e) =>
                              patchStep(step.key, {
                                stepTypeId: Number(e.target.value),
                              })
                            }
                            className={selectClass}
                          >
                            {options.stepTypes.map((t) => (
                              <option key={t.id} value={t.id}>
                                {formatLabel(t.slug)}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="mt-2 block text-[9px] font-semibold uppercase tracking-[0.15em] text-[rgb(var(--muted))]">
                          Model
                          <select
                            value={step.modelId}
                            onChange={(e) =>
                              patchStep(step.key, {
                                modelId: Number(e.target.value),
                              })
                            }
                            className={selectClass}
                          >
                            {!modelById.has(step.modelId) ? (
                              <option value={step.modelId}>— pick —</option>
                            ) : null}
                            {options.models.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="mt-2 flex items-center gap-1.5 text-[10px] text-[rgb(var(--muted))]">
                          <input
                            type="checkbox"
                            checked={includesImage(step)}
                            onChange={(e) =>
                              patchStep(step.key, {
                                inputTypeId: e.target.checked
                                  ? 1
                                  : textInputTypeId,
                              })
                            }
                          />
                          Send image 🖼
                        </label>

                        {prefill ? (
                          <p className="mt-1 text-[10px] font-semibold text-[rgb(var(--primary-deep))] dark:text-[rgb(var(--primary-bright))]">
                            value from DB
                          </p>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => runStepForAllImages(step)}
                          className="mt-2 w-full rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[rgb(var(--accent-strong))] transition hover:-translate-y-0.5 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
                        >
                          Run all →
                        </button>
                      </td>

                      {/* Column 1: editable system prompt */}
                      <td className={`${colWidth} border-b border-r border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.1)]`}>
                        <div className="mb-1 flex justify-end">
                          {popOutButton({ kind: 'system', stepKey: step.key })}
                        </div>
                        <textarea
                          value={getValue({ kind: 'system', stepKey: step.key })}
                          onChange={(e) =>
                            setValue(
                              { kind: 'system', stepKey: step.key },
                              e.target.value
                            )
                          }
                          className={`${editAreaClass}`}
                          rows={6}
                        />
                      </td>

                      {/* Column 2: editable user prompt */}
                      <td className={`${colWidth} border-b border-r border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.1)]`}>
                        <div className="mb-1 flex justify-end">
                          {popOutButton({ kind: 'user', stepKey: step.key })}
                        </div>
                        <textarea
                          value={getValue({ kind: 'user', stepKey: step.key })}
                          onChange={(e) =>
                            setValue(
                              { kind: 'user', stepKey: step.key },
                              e.target.value
                            )
                          }
                          className={`${editAreaClass}`}
                          rows={6}
                        />
                      </td>

                      {/* One column per selected image */}
                      {selectedImages.map((image) => {
                        const key = cellKey(step.key, image.id)
                        const state = cells[key]
                        const source = sourceOf(step, image)
                        const isLoading = state?.status === 'loading'
                        const target: EditTarget = {
                          kind: 'output',
                          stepKey: step.key,
                          imageId: image.id,
                        }
                        return (
                          <td
                            key={image.id}
                            className={`${colWidth} border-b border-r border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.1)]`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[rgb(var(--muted))]">
                                {source === 'computed'
                                  ? 'Value'
                                  : source === 'cached'
                                    ? 'From DB'
                                    : 'Not run'}
                              </span>
                              <div className="flex items-center gap-1">
                                {popOutButton(target)}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setJokesView({
                                      stepKey: step.key,
                                      imageId: image.id,
                                    })
                                  }
                                  title="Show captions with the image (screenshot view)"
                                  className="rounded border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-1.5 py-0.5 text-[10px] font-semibold text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
                                >
                                  Jokes
                                </button>
                                <button
                                  type="button"
                                  onClick={() => runCell(step, image)}
                                  disabled={isLoading}
                                  className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[rgb(var(--on-primary))] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isLoading
                                    ? 'Running…'
                                    : source
                                      ? 'Re-run'
                                      : 'Run'}
                                </button>
                              </div>
                            </div>

                            {state?.status === 'error' ? (
                              <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-[rgb(var(--panel)/0.6)] p-2 text-[11px] text-red-500 dark:bg-[rgb(var(--panel)/0.12)]">
                                {state.error}
                              </p>
                            ) : null}
                              <textarea
                                disabled={isLoading}
                                value={getValue(target)}
                                onChange={(e) => setValue(target, e.target.value)}
                                placeholder={
                                  isLoading ? 'Running…' : 'Enter a value or paste output from another run.'
                                }
                                className={`${editAreaClass} mt-2`}
                                rows={6}
                              />
                          </td>
                        )
                      })}
                    </tr>
                    {addStepRow(
                      index,
                      index === localSteps.length - 1
                        ? 'Add step at the bottom'
                        : 'Add step here'
                    )}
                  </Fragment>
                )
              })}
              {localSteps.length === 0 ? addStepRow(-1, 'Add first step') : null}
            </tbody>
          </table>
        </div>
      )}

      {/* Pop-out sidebar */}
      {sidebar ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-[rgb(var(--shadow)/0.2)]"
          onMouseDown={() => setSidebar(null)}
        >
          <aside
            className="flex h-screen w-[520px] max-w-[90vw] flex-col border-l border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.98)] p-5 shadow-[0_0_80px_-20px_rgb(var(--primary-deep)/0.5)] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--ambient-base-1)/0.98)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-[rgb(var(--ink))]">
                {sidebarTitle}
              </h3>
              <button
                type="button"
                onClick={() => setSidebar(null)}
                className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-xs font-semibold text-[rgb(var(--accent-strong))] transition hover:-translate-y-0.5 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
              >
                Close
              </button>
            </div>
            <textarea
              value={getValue(sidebar)}
              onChange={(e) => setValue(sidebar, e.target.value)}
              className="mt-4 min-h-0 flex-1 resize rounded-xl bg-[rgb(var(--panel)/0.6)] p-4 font-sans text-sm leading-relaxed text-[rgb(var(--ink))] outline-none focus:ring-1 focus:ring-[rgb(var(--primary))] dark:bg-[rgb(var(--panel)/0.12)]"
            />
            {sidebar.kind === 'output' && sidebarStep && sidebarImage ? (
              <button
                type="button"
                onClick={() => runCell(sidebarStep, sidebarImage)}
                className="mt-3 self-start rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[rgb(var(--on-primary))] transition hover:-translate-y-0.5"
              >
                Re-run this step
              </button>
            ) : null}
          </aside>
        </div>
      ) : null}

      {/* Jokes sidebar: image + formatted captions, made for screenshots */}
      {jokesView
        ? (() => {
            const jokesImage = imageById.get(jokesView.imageId) ?? null
            const jokes = extractJokes(
              getValue({
                kind: 'output',
                stepKey: jokesView.stepKey,
                imageId: jokesView.imageId,
              })
            )
            const stepNum =
              localSteps.findIndex((s) => s.key === jokesView.stepKey) + 1
            return (
              <div
                className="fixed inset-0 z-50 flex justify-end bg-[rgb(var(--shadow)/0.2)]"
                onMouseDown={() => setJokesView(null)}
              >
                <aside
                  className="flex h-screen w-[560px] max-w-[90vw] flex-col border-l border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.98)] p-5 shadow-[0_0_80px_-20px_rgb(var(--primary-deep)/0.5)] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--ambient-base-1)/0.98)]"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[rgb(var(--ink))]">
                      Jokes · Step {stepNum}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setJokesView(null)}
                      className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-xs font-semibold text-[rgb(var(--accent-strong))] transition hover:-translate-y-0.5 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
                    >
                      Close
                    </button>
                  </div>
                  <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                    {jokes.length ? (
                      <ol className="space-y-0.5">
                        {jokes.map((j, i) => (
                          <li
                            key={i}
                            className="flex gap-2 text-sm leading-snug text-[rgb(var(--ink))]"
                          >
                            <span className="shrink-0 font-mono text-[11px] text-[rgb(var(--muted))]">
                              {i + 1}.
                            </span>
                            <span className="min-w-0 font-medium">
                              {j.caption}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-sm text-[rgb(var(--muted))]">
                        No captions found in this cell&apos;s output — run the
                        step first, or check that its output contains
                        &quot;caption&quot; fields.
                      </p>
                    )}
                    {jokesImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={jokesImage.url}
                        alt="Meme"
                        className="mt-3 w-full rounded-xl object-contain"
                      />
                    ) : null}
                  </div>
                </aside>
              </div>
            )
          })()
        : null}

      {/* Save-as-new-flavor modal */}
      {saveOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(var(--shadow)/0.65)] p-4 backdrop-blur-sm"
          onMouseDown={() => setSaveOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-[28px] border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.98)] p-6 shadow-[0_40px_110px_-60px_rgb(var(--primary-deep)/0.5)] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--ambient-base-1)/0.98)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[rgb(var(--ink))]">
              Save as new flavor
            </h3>
            <p className="mt-1 text-xs text-[rgb(var(--muted))]">
              Creates a new flavor with your edited prompts and steps. The
              original ({flavorSlug}) is left unchanged.
            </p>

            {saveStatus === 'done' && savedFlavorId ? (
              <div className="mt-5 space-y-4">
                <p className="text-sm text-[rgb(var(--ink))]">
                  Saved as <span className="font-semibold">{saveName}</span> (id{' '}
                  {savedFlavorId}).
                </p>
                {saveWarning ? (
                  <p className="text-xs text-amber-500">{saveWarning}</p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSaveOpen(false)}
                    className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
                  >
                    Stay here
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      router.push(`/humor-flavor/${savedFlavorId}/matrix`)
                    }
                    className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[rgb(var(--on-primary))]"
                  >
                    Open new flavor →
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
                    New flavor name (slug)
                  </span>
                  <input
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.6)] p-2.5 text-sm text-[rgb(var(--ink))] outline-none focus:ring-1 focus:ring-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.12)]"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
                    Description (optional)
                  </span>
                  <textarea
                    value={saveDescription}
                    onChange={(e) => setSaveDescription(e.target.value)}
                    rows={2}
                    className="mt-1 w-full resize rounded-xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.6)] p-2.5 text-sm text-[rgb(var(--ink))] outline-none focus:ring-1 focus:ring-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.12)]"
                  />
                </label>

                {saveError ? (
                  <p className="text-xs text-red-500">{saveError}</p>
                ) : null}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSaveOpen(false)}
                    className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saveStatus === 'saving' || !saveName.trim()}
                    className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[rgb(var(--on-primary))] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saveStatus === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Update-this-flavor (overwrite) modal */}
      {updateOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(var(--shadow)/0.65)] p-4 backdrop-blur-sm"
          onMouseDown={() => setUpdateOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-[28px] border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.98)] p-6 shadow-[0_40px_110px_-60px_rgb(var(--primary-deep)/0.5)] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--ambient-base-1)/0.98)]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[rgb(var(--ink))]">
              Update this flavor
            </h3>
            {updateStatus === 'done' ? (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-[rgb(var(--ink))]">
                  Updated <span className="font-semibold">{flavorSlug}</span>{' '}
                  (id {flavorId}) in the database.
                </p>
                {updateWarning ? (
                  <p className="text-xs text-amber-500">{updateWarning}</p>
                ) : null}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setUpdateOpen(false)}
                    className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[rgb(var(--on-primary))]"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2 space-y-4">
                <p className="text-xs text-[rgb(var(--muted))]">
                  Overwrites the steps of{' '}
                  <span className="font-semibold">{flavorSlug}</span> (id{' '}
                  {flavorId}) with the current matrix — prompts, step config, and
                  any added or removed steps. This cannot be undone.
                </p>
                {updateError ? (
                  <p className="text-xs text-red-500">{updateError}</p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setUpdateOpen(false)}
                    className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.8)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleUpdate}
                    disabled={updateStatus === 'saving'}
                    className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[rgb(var(--on-primary))] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {updateStatus === 'saving' ? 'Updating…' : 'Update flavor'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Enlarged image lightbox */}
      {previewUrl ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgb(var(--shadow)/0.85)] p-6 backdrop-blur-sm"
          onMouseDown={() => setPreviewUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Enlarged image"
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-[0_40px_120px_-40px_rgb(var(--shadow))]"
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  )
}
