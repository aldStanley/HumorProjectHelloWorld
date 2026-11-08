'use client'

import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import BulkModelSelect from '@/components/bulk-model-select'
import { useRouter } from 'next/navigation'

import {
  runStepAction,
  saveAsNewFlavorAction,
  saveOneOutputAction,
  saveStepPromptAction,
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
  // Stable variable token (e.g. "8" or "7a"). Fixed to the step's identity, NOT
  // its position — so inserting a step never changes existing references.
  varName: string
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

type ImageRole = 'training' | 'testing'

type EditTarget =
  | { kind: 'system'; stepKey: string }
  | { kind: 'user'; stepKey: string }
  | { kind: 'output'; stepKey: string; imageId: string }

const cellKey = (stepKey: string, imageId: string) => `${stepKey}:${imageId}`

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

// Textarea that grows to fit its content (up to a max, then scrolls) so cells
// don't carry a fixed block of empty space.
const MAX_AUTO_HEIGHT = 360
function AutoTextarea({
  value,
  onChange,
  className,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  className?: string
  placeholder?: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_AUTO_HEIGHT)}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  )
}

// Cell-address chip that copies its label to the clipboard on click.
function AddrChip({ addr, className }: { addr: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={`Copy ${addr}`}
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(addr)
          setCopied(true)
          setTimeout(() => setCopied(false), 900)
        } catch {
          // clipboard unavailable; ignore
        }
      }}
      className={className}
    >
      {copied ? '✓' : addr}
    </button>
  )
}

export default function ChiltrixClient({
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
    steps.map((s, i) => ({
      key: `s${s.id}`,
      varName: String(i + 1),
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

  // First N selected default to training (first 3), the rest to testing.
  const buildDefaultRoles = (ids: string[]): Record<string, ImageRole> => {
    const r: Record<string, ImageRole> = {}
    ids.forEach((id, i) => {
      r[id] = i < 3 ? 'training' : 'testing'
    })
    return r
  }

  // Surface images that already have saved generations: pick the set holding
  // the most of them, and put those images first in the default columns.
  const savedImageIds = [...new Set(savedOutputs.map((o) => o.imageId))]
  const initialSet =
    imageSets
      .map((s) => ({
        s,
        hits: s.images.filter((i) => savedImageIds.includes(i.id)).length,
      }))
      .sort((a, b) => b.hits - a.hits)[0]?.s ??
    imageSets[0] ??
    null
  const initialSelectedIds = (() => {
    const imgs = initialSet?.images ?? []
    const saved = imgs.filter((i) => savedImageIds.includes(i.id)).map((i) => i.id)
    const rest = imgs.filter((i) => !saved.includes(i.id)).map((i) => i.id)
    return [...saved, ...rest].slice(0, Math.max(6, saved.length))
  })()

  const [activeSetId, setActiveSetId] = useState<number | null>(
    initialSet?.id ?? null
  )
  const activeSet = useMemo(
    () => imageSets.find((s) => s.id === activeSetId) ?? null,
    [imageSets, activeSetId]
  )
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>(
    () => initialSelectedIds
  )
  const [roleByImage, setRoleByImage] = useState<Record<string, ImageRole>>(
    () => buildDefaultRoles(initialSelectedIds)
  )
  const [cells, setCells] = useState<Record<string, CellState>>(() => {
    const init: Record<string, CellState> = {}
    savedOutputs.forEach(({ stepId, imageId, output }) => {
      init[cellKey(`s${stepId}`, imageId)] = { status: 'done', output }
    })
    return init
  })
  const [sidebar, setSidebar] = useState<EditTarget | null>(null)
  const [copied, setCopied] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [sidebarSave, setSidebarSave] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')

  const roleOf = (id: string): ImageRole => roleByImage[id] ?? 'testing'
  const setRole = (id: string, role: ImageRole) =>
    setRoleByImage((prev) => ({ ...prev, [id]: role }))
  const toggleRole = (id: string) =>
    setRole(id, roleOf(id) === 'training' ? 'testing' : 'training')

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
  // Columns: selected images, grouped training-first then testing.
  const selectedImages = useMemo(() => {
    const picked = (activeSet?.images ?? []).filter((img) =>
      selectedImageIds.includes(img.id)
    )
    const rank = (id: string) => (roleByImage[id] === 'training' ? 0 : 1)
    return [...picked].sort((a, b) => rank(a.id) - rank(b.id))
  }, [activeSet, selectedImageIds, roleByImage])

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

  // Pick a stable variable token for a step inserted AFTER position `index`.
  // Appending (or the very first step) gets the next plain integer; inserting in
  // the middle suffixes the preceding step's token with a letter (a, b, … aa, …)
  // so it sorts after N without disturbing the existing ${stepNOutput} refs.
  const nextVarName = (index: number, steps: EditableStep[]): string => {
    const taken = new Set(steps.map((s) => s.varName))
    const isAppend = index >= steps.length - 1 || index < 0
    if (isAppend) {
      let max = 0
      for (const s of steps) {
        const m = s.varName.match(/^(\d+)/)
        if (m) max = Math.max(max, Number.parseInt(m[1], 10))
      }
      let n = max + 1
      while (taken.has(String(n))) n += 1
      return String(n)
    }
    const base = steps[index].varName
    const letters = (i: number): string => {
      // 0->a, 25->z, 26->aa, ... (bijective base-26)
      let s = ''
      let x = i
      do {
        s = String.fromCharCode(97 + (x % 26)) + s
        x = Math.floor(x / 26) - 1
      } while (x >= 0)
      return s
    }
    for (let i = 0; ; i += 1) {
      const cand = base + letters(i)
      if (!taken.has(cand)) return cand
    }
  }

  const addStepAfter = (index: number) => {
    const newStep: EditableStep = {
      key: makeKey(),
      varName: nextVarName(index, localSteps),
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
    localSteps.slice(0, index).forEach((s) => {
      priorOutputs[s.varName] = outputValue(s, image) ?? ''
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

    // Auto-save the generated value to the current flavor (existing steps only;
    // newly added steps have no DB id until the flavor is saved).
    const dbStepId = dbIdOf(step.key)
    if (result.ok && result.text != null && dbStepId != null) {
      void saveOneOutputAction({
        flavorId,
        stepId: dbStepId,
        imageId: image.id,
        output: result.text,
        modelId: step.modelId,
        systemPrompt: step.systemPrompt,
        userPrompt: step.userPrompt,
        temperature: model.isTemperatureSupported ? step.temperature : null,
      })
    }
  }

  const runStepForAllImages = async (step: EditableStep) => {
    await Promise.all(selectedImages.map((image) => runCell(step, image)))
  }

  // Existing DB step id encoded in the key (`s196` -> 196); null for new steps.
  const dbIdOf = (key: string): number | null => {
    const m = key.match(/^s(\d+)$/)
    return m ? Number(m[1]) : null
  }

  // At save time, rewrite the stable in-session tokens (e.g. "7a") to the
  // sequential positions (1..N) that a reload will assign, across every
  // ${stepXOutput} reference. Renumbering is safe here because the final order
  // is fixed and all references move together — keeping the persisted prompts
  // consistent with the positional numbering used when the flavor reloads.
  const normalizePrompt = (text: string): string => {
    const map = new Map(localSteps.map((s, i) => [s.varName, String(i + 1)]))
    return text.replace(
      /\$\{step([0-9a-z]+)Output\}/g,
      (full, tok: string) => {
        const to = map.get(tok)
        return to ? `\${step${to}Output}` : full
      }
    )
  }

  const buildStepPayload = (s: EditableStep) => {
    const model = modelById.get(s.modelId)
    return {
      stepTypeId: s.stepTypeId,
      inputTypeId: s.inputTypeId,
      outputTypeId: s.outputTypeId,
      modelId: s.modelId,
      temperature: model?.isTemperatureSupported ? s.temperature : null,
      systemPrompt: normalizePrompt(s.systemPrompt),
      userPrompt: normalizePrompt(s.userPrompt),
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
      lines.push(`=== Step ${n} (\${step${step.varName}Output}): ${name} ===`)
      lines.push(
        `Variable: \${step${step.varName}Output}  |  Type: ${typeLabel}  |  Model: ${modelName}  |  Image: ${
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

  // Save just the prompt currently open in the sidebar to the flavor.
  const handleSaveSidebarPrompt = async () => {
    if (!sidebar || (sidebar.kind !== 'system' && sidebar.kind !== 'user')) {
      return
    }
    const stepId = dbIdOf(sidebar.stepKey)
    if (stepId == null) {
      setSidebarSave('error')
      return
    }
    setSidebarSave('saving')
    const res = await saveStepPromptAction({
      flavorId,
      stepId,
      kind: sidebar.kind,
      value: normalizePrompt(getValue(sidebar)),
    })
    setSidebarSave(res.ok ? 'saved' : 'error')
    if (res.ok) setTimeout(() => setSidebarSave('idle'), 1800)
  }

  const handleSelectSet = (setId: number) => {
    const set = imageSets.find((s) => s.id === setId)
    const ids = (set?.images ?? []).slice(0, 6).map((img) => img.id)
    setActiveSetId(setId)
    setSelectedImageIds(ids)
    setRoleByImage(buildDefaultRoles(ids))
    setSidebar(null)
  }

  const toggleImage = (imageId: string) => {
    setSelectedImageIds((prev) => {
      if (prev.includes(imageId)) {
        return prev.filter((id) => id !== imageId)
      }
      // Newly added images default to testing.
      setRoleByImage((roles) => ({ ...roles, [imageId]: roles[imageId] ?? 'testing' }))
      return [...prev, imageId]
    })
  }

  if (!imageSets.length) {
    return (
      <p className="text-sm text-[rgb(var(--muted))]">
        No study image sets with images are available.
      </p>
    )
  }

  const colWidth = 'w-[320px] max-w-[320px]'
  const promptColWidth = 'w-[560px] max-w-[560px]'
  const editAreaClass =
    'w-full resize-y overflow-auto rounded-lg bg-[rgb(var(--panel)/0.6)] p-2 font-sans text-[11px] leading-relaxed text-[rgb(var(--ink))] outline-none focus:ring-1 focus:ring-[rgb(var(--primary))] dark:bg-[rgb(var(--panel)/0.12)]'
  const selectClass =
    'mt-1 w-full rounded-md border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] px-1.5 py-1 text-[10px] text-[rgb(var(--ink))] outline-none focus:ring-1 focus:ring-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.12)]'
  const spacerCell = 'w-5 min-w-[20px] max-w-[20px] border-0 bg-transparent p-0'
  // Cell address chip (e.g. S3·I2) so cells can be referenced in discussion.
  const addrChip =
    'cursor-pointer rounded bg-[rgb(var(--primary)/0.2)] px-1 py-0.5 font-mono text-[9px] font-bold tracking-wider text-[rgb(var(--accent-strong))] transition hover:bg-[rgb(var(--primary)/0.4)]'
  // Where testing columns begin (images are sorted training-first).
  const firstTestIndex = selectedImages.findIndex(
    (img) => roleOf(img.id) === 'testing'
  )
  const hasMidGap = firstTestIndex > 0
  // 3 fixed cols + instructions|images gap + optional train|test gap + images
  const totalCols = 4 + (hasMidGap ? 1 : 0) + selectedImages.length

  const popOutButton = (target: EditTarget) => (
    <button
      type="button"
      onClick={() => {
        setSidebar(target)
        setSidebarSave('idle')
      }}
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
    const num = sidebarStep.varName
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
              2. Pick images — tap the badge to set{' '}
              <span className="text-[rgb(var(--primary))]">TRAIN</span> /{' '}
              <span className="text-amber-400">TEST</span> (6 by default)
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
                        ? roleOf(image.id) === 'training'
                          ? 'border-[rgb(var(--primary))] shadow-[0_0_0_2px_rgb(var(--primary)/0.4)]'
                          : 'border-amber-400 shadow-[0_0_0_2px_rgba(251,191,36,0.4)]'
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
                      className="absolute left-0 top-0 cursor-zoom-in rounded-br-md bg-black/60 px-1 text-[10px] leading-tight text-white"
                    >
                      ⤢
                    </span>
                    {selected ? (
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleRole(image.id)
                        }}
                        title="Toggle training / testing"
                        className={`absolute bottom-0 left-0 right-0 cursor-pointer text-center text-[8px] font-bold tracking-wider ${
                          roleOf(image.id) === 'training'
                            ? 'bg-[rgb(var(--primary))] text-[rgb(var(--on-primary))]'
                            : 'bg-amber-400 text-black'
                        }`}
                      >
                        {roleOf(image.id) === 'training' ? 'TRAIN' : 'TEST'}
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
        <div className="max-h-[75vh] overflow-auto rounded-2xl border border-[rgb(var(--gloss)/0.7)] dark:border-[rgb(var(--gloss)/0.1)]">
          <table className="border-collapse text-left align-top">
            <thead>
              <tr className="bg-[rgb(var(--panel)/0.9)] text-[10px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))] dark:bg-[rgb(var(--panel)/0.1)]">
                <th className="sticky left-0 top-0 z-30 w-[200px] min-w-[200px] max-w-[200px] border-b border-r border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel))] p-3 dark:border-[rgb(var(--gloss)/0.1)]">
                  Step / Config
                </th>
                <th className={`${promptColWidth} sticky top-0 z-20 border-b border-r border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel))] p-3 dark:border-[rgb(var(--gloss)/0.1)]`}>
                  System Prompt
                </th>
                <th className={`${promptColWidth} sticky top-0 z-20 border-b border-r border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel))] p-3 dark:border-[rgb(var(--gloss)/0.1)]`}>
                  User Prompt
                </th>
                <th aria-hidden className={spacerCell} />
                {selectedImages.map((image, index) => {
                  const training = roleOf(image.id) === 'training'
                  const needsGap = hasMidGap && index === firstTestIndex
                  return (
                    <Fragment key={image.id}>
                    {needsGap ? <th aria-hidden className={spacerCell} /> : null}
                    <th
                      className={`${colWidth} sticky top-0 z-20 border-b border-r border-t-4 border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel))] p-3 dark:border-[rgb(var(--gloss)/0.1)] ${
                        training
                          ? 'border-t-[rgb(var(--primary))]'
                          : 'border-t-amber-400'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
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
                              className={`h-9 w-9 cursor-zoom-in rounded-md object-cover ring-2 ${
                                training
                                  ? 'ring-[rgb(var(--primary))]'
                                  : 'ring-amber-400'
                              }`}
                            />
                          </button>
                          <span>Image {index + 1}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleRole(image.id)}
                          title="Toggle training / testing"
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${
                            training
                              ? 'bg-[rgb(var(--primary))] text-[rgb(var(--on-primary))]'
                              : 'bg-amber-400 text-black'
                          }`}
                        >
                          {training ? 'TRAIN' : 'TEST'}
                        </button>
                      </div>
                    </th>
                    </Fragment>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {localSteps.map((step, index) => {
                const prefill = prefillOf(step)
                return (
                  <Fragment key={step.key}>
                    <tr className="align-top text-xs text-[rgb(var(--ink))]">
                      {/* Column 0: variable + config + run-all + remove */}
                      <td className="sticky left-0 z-10 w-[200px] min-w-[200px] max-w-[200px] border-b border-r border-[rgb(var(--gloss)/0.4)] bg-[rgb(var(--panel)/0.92)] p-3 dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.12)]">
                        <div className="flex items-center justify-between">
                          <code className="rounded bg-[rgb(var(--primary)/0.12)] px-1.5 py-0.5 text-[11px] font-semibold text-[rgb(var(--accent-strong))]">
                            {`\${step${step.varName}Output}`}
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

                        <label className="mt-2 block text-[9px] font-semibold uppercase tracking-[0.15em] text-[rgb(var(--muted))]">
                          Temperature
                          {modelById.get(step.modelId)?.isTemperatureSupported ? (
                            <input
                              type="number"
                              min={0}
                              max={2}
                              step={0.1}
                              value={step.temperature ?? 0.7}
                              onChange={(e) =>
                                patchStep(step.key, {
                                  temperature:
                                    e.target.value === ''
                                      ? null
                                      : Number(e.target.value),
                                })
                              }
                              className={selectClass}
                            />
                          ) : (
                            <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-[rgb(var(--muted))]">
                              n/a for this model
                            </span>
                          )}
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
                      <td className={`${promptColWidth} border-b border-r border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.1)]`}>
                        <div className="mb-1 flex items-center justify-between">
                          <AddrChip
                            addr={`S${step.varName}·SYS`}
                            className={addrChip}
                          />
                          {popOutButton({ kind: 'system', stepKey: step.key })}
                        </div>
                        <AutoTextarea
                          value={getValue({ kind: 'system', stepKey: step.key })}
                          onChange={(e) =>
                            setValue(
                              { kind: 'system', stepKey: step.key },
                              e.target.value
                            )
                          }
                          className={`${editAreaClass}`}
                        />
                      </td>

                      {/* Column 2: editable user prompt */}
                      <td className={`${promptColWidth} border-b border-r border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.1)]`}>
                        <div className="mb-1 flex items-center justify-between">
                          <AddrChip
                            addr={`S${step.varName}·USR`}
                            className={addrChip}
                          />
                          {popOutButton({ kind: 'user', stepKey: step.key })}
                        </div>
                        <AutoTextarea
                          value={getValue({ kind: 'user', stepKey: step.key })}
                          onChange={(e) =>
                            setValue(
                              { kind: 'user', stepKey: step.key },
                              e.target.value
                            )
                          }
                          className={`${editAreaClass}`}
                        />
                      </td>

                      {/* gap between AI instructions and image columns */}
                      <td aria-hidden className={spacerCell} />

                      {/* One column per selected image (train, then test) */}
                      {selectedImages.map((image, imgIndex) => {
                        const key = cellKey(step.key, image.id)
                        const state = cells[key]
                        const source = sourceOf(step, image)
                        const isLoading = state?.status === 'loading'
                        const needsGap = hasMidGap && imgIndex === firstTestIndex
                        const target: EditTarget = {
                          kind: 'output',
                          stepKey: step.key,
                          imageId: image.id,
                        }
                        return (
                          <Fragment key={image.id}>
                          {needsGap ? (
                            <td aria-hidden className={spacerCell} />
                          ) : null}
                          <td
                            className={`${colWidth} border-b border-r border-[rgb(var(--gloss)/0.4)] p-2 dark:border-[rgb(var(--gloss)/0.1)]`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <AddrChip
                                  addr={`S${step.varName}·I${imgIndex + 1}`}
                                  className={addrChip}
                                />
                                <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[rgb(var(--muted))]">
                                  {source === 'computed'
                                    ? 'Value'
                                    : source === 'cached'
                                      ? 'From DB'
                                      : 'Not run'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                {popOutButton(target)}
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
                              <AutoTextarea
                                disabled={isLoading}
                                value={getValue(target)}
                                onChange={(e) => setValue(target, e.target.value)}
                                placeholder={
                                  isLoading ? 'Running…' : 'Enter a value or paste output from another run.'
                                }
                                className={`${editAreaClass} mt-2`}
                              />
                          </td>
                          </Fragment>
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
            {sidebar.kind === 'system' || sidebar.kind === 'user' ? (
              <div className="mt-3 flex items-center gap-3">
                {dbIdOf(sidebar.stepKey) != null ? (
                  <button
                    type="button"
                    onClick={handleSaveSidebarPrompt}
                    disabled={sidebarSave === 'saving'}
                    className="self-start rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[rgb(var(--on-primary))] transition hover:-translate-y-0.5 disabled:opacity-60"
                  >
                    {sidebarSave === 'saving'
                      ? 'Saving…'
                      : sidebarSave === 'saved'
                        ? 'Saved ✓'
                        : 'Save prompt to flavor'}
                  </button>
                ) : (
                  <span className="text-[11px] text-[rgb(var(--muted))]">
                    New step — use “Update this flavor” first to save it.
                  </span>
                )}
                {sidebarSave === 'error' ? (
                  <span className="text-[11px] text-red-500">
                    Couldn’t save.
                  </span>
                ) : null}
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}

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
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
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
