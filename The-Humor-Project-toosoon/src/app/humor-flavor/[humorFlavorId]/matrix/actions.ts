'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/utils/supabase/server'
import {
  getStudentBrainOutputText,
  getTopByVelocityText,
  getTopByVolumeText,
  getRecentlyAddedText,
  getActiveMemoriesText,
  getPersistentMemoriesText,
  getDormantMemoriesText,
} from '@/utils/student-brain'

export type RunStepResult = {
  ok: boolean
  text?: string
  resolvedUserPrompt?: string
  error?: string
}

export type SaveFlavorResult = {
  ok: boolean
  flavorId?: number
  error?: string
  outputsWarning?: string
}

export type SaveStepInput = {
  stepTypeId: number
  inputTypeId: number
  outputTypeId: number
  modelId: number
  temperature: number | null
  systemPrompt: string
  userPrompt: string
  description: string | null
}

// A single generated cell value to snapshot (stepIndex = position in steps[]).
export type StepOutputInput = {
  stepIndex: number
  imageId: string
  output: string
}

type SaveFlavorInput = {
  slug: string
  description: string | null
  // the full, ordered step list as it currently appears in the matrix
  steps: SaveStepInput[]
  outputs?: StepOutputInput[]
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

// Snapshots the latest generated values into llm_model_responses. Keeps only
// the latest: clears this flavor's prior responses for each image, then
// inserts fresh rows. Best-effort — returns false on any failure so callers
// can warn without failing the whole save.
async function persistLatestOutputs(
  supabase: SupabaseClient,
  params: {
    flavorId: number
    profileId: string
    stepIdByIndex: (number | null)[]
    steps: SaveStepInput[]
    outputs: StepOutputInput[]
  }
): Promise<boolean> {
  const { flavorId, profileId, stepIdByIndex, steps, outputs } = params
  if (!outputs.length) return true

  const byImage = new Map<string, StepOutputInput[]>()
  for (const o of outputs) {
    const list = byImage.get(o.imageId) ?? []
    list.push(o)
    byImage.set(o.imageId, list)
  }

  let ok = true
  for (const [imageId, items] of byImage) {
    try {
      const { data: crs } = await supabase
        .from('caption_requests')
        .select('id')
        .eq('image_id', imageId)
        .eq('profile_id', profileId)
      const crIds = (crs ?? []).map((c) => c.id)

      if (crIds.length) {
        await supabase
          .from('llm_model_responses')
          .delete()
          .eq('humor_flavor_id', flavorId)
          .in('caption_request_id', crIds)
      }

      let captionRequestId = crIds[0]
      if (captionRequestId == null) {
        const { data: newCr, error } = await supabase
          .from('caption_requests')
          .insert({ image_id: imageId, profile_id: profileId })
          .select('id')
          .single()
        if (error || !newCr) {
          ok = false
          continue
        }
        captionRequestId = newCr.id
      }

      const rows = items
        .map((it) => {
          const stepId = stepIdByIndex[it.stepIndex]
          const step = steps[it.stepIndex]
          if (stepId == null || !step) return null
          return {
            caption_request_id: captionRequestId as number,
            humor_flavor_id: flavorId,
            humor_flavor_step_id: stepId,
            llm_model_id: step.modelId,
            llm_system_prompt: step.systemPrompt ?? '',
            llm_user_prompt: step.userPrompt ?? '',
            llm_model_response: it.output,
            llm_temperature: step.temperature,
            processing_time_seconds: 0,
            profile_id: profileId,
          }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      if (rows.length) {
        const { error } = await supabase
          .from('llm_model_responses')
          .insert(rows)
        if (error) ok = false
      }
    } catch {
      ok = false
    }
  }
  return ok
}

// Saves the current matrix (edited prompts + any added/removed steps) as a
// brand-new flavor. The source flavor is never modified.
export async function saveAsNewFlavorAction(
  input: SaveFlavorInput
): Promise<SaveFlavorResult> {
  const slug = input.slug.trim()
  if (!slug) {
    return { ok: false, error: 'Please enter a name for the new flavor.' }
  }
  if (!input.steps.length) {
    return { ok: false, error: 'A flavor needs at least one step.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to save.' }
  }

  const audit = {
    created_by_user_id: user.id,
    modified_by_user_id: user.id,
  }

  const { data: newFlavor, error: insertFlavorError } = await supabase
    .from('humor_flavors')
    .insert({ slug, description: input.description, ...audit })
    .select('id')
    .single()

  if (insertFlavorError || !newFlavor) {
    if (insertFlavorError?.code === '23505') {
      return { ok: false, error: 'That name already exists. Pick another.' }
    }
    return { ok: false, error: 'Unable to create the new flavor.' }
  }

  const stepInserts = input.steps.map((step, index) => ({
    humor_flavor_id: newFlavor.id,
    order_by: index + 1,
    llm_temperature: step.temperature,
    llm_system_prompt: step.systemPrompt,
    llm_user_prompt: step.userPrompt,
    description: step.description,
    humor_flavor_step_type_id: step.stepTypeId,
    llm_input_type_id: step.inputTypeId,
    llm_model_id: step.modelId,
    llm_output_type_id: step.outputTypeId,
    ...audit,
  }))

  const { data: insertedSteps, error: insertStepsError } = await supabase
    .from('humor_flavor_steps')
    .insert(stepInserts)
    .select('id, order_by')
  if (insertStepsError || !insertedSteps) {
    return { ok: false, error: 'Saved the flavor, but failed to save steps.' }
  }

  const idByOrder = new Map<number, number>()
  insertedSteps.forEach((s) => idByOrder.set(s.order_by, s.id))
  const stepIdByIndex = input.steps.map((_, i) => idByOrder.get(i + 1) ?? null)

  const outputsOk = await persistLatestOutputs(supabase, {
    flavorId: newFlavor.id,
    profileId: user.id,
    stepIdByIndex,
    steps: input.steps,
    outputs: input.outputs ?? [],
  })

  return {
    ok: true,
    flavorId: newFlavor.id,
    outputsWarning: outputsOk
      ? undefined
      : 'Flavor saved, but some generated values could not be stored.',
  }
}

export type UpdateFlavorResult = {
  ok: boolean
  error?: string
  outputsWarning?: string
}

type UpdateFlavorInput = {
  flavorId: number
  // the full ordered step list; id is the existing DB step id, or null if new
  steps: (SaveStepInput & { id: number | null })[]
  outputs?: StepOutputInput[]
}

// Overwrites the EXISTING flavor's steps to match the current matrix:
// existing steps are updated, new steps inserted, removed steps deleted.
export async function updateFlavorInPlaceAction(
  input: UpdateFlavorInput
): Promise<UpdateFlavorResult> {
  if (!input.steps.length) {
    return { ok: false, error: 'A flavor needs at least one step.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to update.' }
  }

  const insertAudit = {
    created_by_user_id: user.id,
    modified_by_user_id: user.id,
  }
  const updateAudit = { modified_by_user_id: user.id }

  const { data: existing, error: existingError } = await supabase
    .from('humor_flavor_steps')
    .select('id')
    .eq('humor_flavor_id', input.flavorId)
  if (existingError || !existing) {
    return { ok: false, error: 'Unable to load the existing steps.' }
  }
  const existingIds = new Set(existing.map((s) => s.id))
  const keepIds = new Set(
    input.steps
      .map((s) => s.id)
      .filter((id): id is number => id != null && existingIds.has(id))
  )

  // Update existing / insert new, in order. Track each step's final id.
  const stepIdByIndex: (number | null)[] = []
  for (const [index, step] of input.steps.entries()) {
    const common = {
      order_by: index + 1,
      humor_flavor_step_type_id: step.stepTypeId,
      llm_input_type_id: step.inputTypeId,
      llm_output_type_id: step.outputTypeId,
      llm_model_id: step.modelId,
      llm_temperature: step.temperature,
      llm_system_prompt: step.systemPrompt,
      llm_user_prompt: step.userPrompt,
      description: step.description,
    }

    if (step.id != null && existingIds.has(step.id)) {
      const { error } = await supabase
        .from('humor_flavor_steps')
        .update({ ...common, ...updateAudit })
        .eq('id', step.id)
        .eq('humor_flavor_id', input.flavorId)
      if (error) {
        return { ok: false, error: 'Failed to update a step.' }
      }
      stepIdByIndex[index] = step.id
    } else {
      const { data: inserted, error } = await supabase
        .from('humor_flavor_steps')
        .insert({ humor_flavor_id: input.flavorId, ...common, ...insertAudit })
        .select('id')
        .single()
      if (error || !inserted) {
        return { ok: false, error: 'Failed to add a new step.' }
      }
      stepIdByIndex[index] = inserted.id
    }
  }

  // Delete steps that were removed in the matrix.
  const toDelete = [...existingIds].filter((id) => !keepIds.has(id))
  if (toDelete.length) {
    const { error } = await supabase
      .from('humor_flavor_steps')
      .delete()
      .in('id', toDelete)
      .eq('humor_flavor_id', input.flavorId)
    if (error) {
      return {
        ok: false,
        error:
          'Updated steps, but could not remove deleted ones (they may be referenced elsewhere).',
      }
    }
  }

  await supabase
    .from('humor_flavors')
    .update({ ...updateAudit })
    .eq('id', input.flavorId)

  const outputsOk = await persistLatestOutputs(supabase, {
    flavorId: input.flavorId,
    profileId: user.id,
    stepIdByIndex,
    steps: input.steps,
    outputs: input.outputs ?? [],
  })

  revalidatePath(`/humor-flavor/${input.flavorId}`)
  revalidatePath(`/humor-flavor/${input.flavorId}/matrix`)

  return {
    ok: true,
    outputsWarning: outputsOk
      ? undefined
      : 'Flavor updated, but some generated values could not be stored.',
  }
}

type RunStepInput = {
  imageId: string
  systemPrompt: string
  userPrompt: string
  providerModelId: string
  temperature: number | null
  includeImage: boolean
  isTemperatureSupported: boolean
  // step number (order_by) -> already-known output for that image
  priorOutputs: Record<string, string>
}

type ProviderType = 'openai' | 'grok' | 'gemini'

const providerFor = (providerModelId: string): ProviderType => {
  if (providerModelId.startsWith('grok')) return 'grok'
  if (providerModelId.startsWith('gemini')) return 'gemini'
  return 'openai'
}

const ENV_KEY: Record<ProviderType, string> = {
  openai: 'OPENAI_API_KEY',
  grok: 'X_AI_KEY',
  gemini: 'GOOGLE_AI_API_KEY',
}

const sample = <T,>(rows: T[], count: number): T[] => {
  if (rows.length <= count) return rows
  const copy = [...rows]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, count)
}

const VARIABLE_PATTERN = /\$\{([^}]+)\}/g

// Resolves every ${...} placeholder we know how to fill. Unknown placeholders
// are left untouched so the user can see they were not substituted.
const buildResolver = (opts: {
  priorOutputs: Record<string, string>
  imageDescription: string
  imageAdditionalContext: string
  terms: { term: string; definition: string }[]
  captionExamples: { caption: string; explanation: string }[]
  communityContexts: { content: string }[]
  studentBrainOutput: string | null
  topByVelocity: string | null
  topByVolume: string | null
  recentlyAdded: string | null
  activeMemories: string | null
  persistentMemories: string | null
  dormantMemories: string | null
}) => {
  const formatTerms = (rows: { term: string; definition: string }[]) =>
    rows.map((t) => `${t.term}: ${t.definition}`).join('\n')
  const formatCaptions = (rows: { caption: string; explanation: string }[]) =>
    rows.map((c) => `"${c.caption}" (${c.explanation})`).join('\n')
  const formatContexts = (rows: { content: string }[]) =>
    rows.map((c) => c.content).filter(Boolean).join('\n')

  return (variableName: string): string | null => {
    const stepMatch = variableName.match(/^step(\d+)Output$/)
    if (stepMatch) return opts.priorOutputs[stepMatch[1]] ?? ''

    switch (variableName) {
      case 'imageDescription':
        return opts.imageDescription
      case 'imageAdditionalContext':
        return opts.imageAdditionalContext
      case 'allTerms':
        return formatTerms(opts.terms)
      case 'tenRandomTerms':
        return formatTerms(sample(opts.terms, 10))
      case 'allCaptionExamples':
        return formatCaptions(opts.captionExamples)
      case 'tenRandomCaptionExamples':
        return formatCaptions(sample(opts.captionExamples, 10))
      case 'allCommunityContexts':
        return formatContexts(opts.communityContexts)
      case 'tenRandomCommunityContexts':
        return formatContexts(sample(opts.communityContexts, 10))
      case 'fiveRelevantCommunityContexts':
        return formatContexts(sample(opts.communityContexts, 5))
      case 'studentBrainOutput':
        return opts.studentBrainOutput
      case 'topByVelocity':
        return opts.topByVelocity
      case 'topByVolume':
        return opts.topByVolume
      case 'recentlyAdded':
        return opts.recentlyAdded
      case 'activeMemories':
        return opts.activeMemories
      case 'persistentMemories':
        return opts.persistentMemories
      case 'dormantMemories':
        return opts.dormantMemories
      case 'startRandomizeLines':
      case 'endRandomizeLines':
        return ''
      default:
        return null
    }
  }
}

const substitute = (
  text: string,
  resolve: (name: string) => string | null
): string =>
  text.replace(VARIABLE_PATTERN, (full, name: string) => {
    const value = resolve(name.trim())
    return value === null ? full : value
  })

const parseResponse = (data: unknown, provider: ProviderType): string => {
  const d = data as Record<string, unknown>
  if (provider === 'gemini') {
    const parts = (d?.candidates as { content?: { parts?: { text?: string }[] } }[])
      ?.[0]?.content?.parts
    const text = Array.isArray(parts)
      ? parts.map((p) => p?.text ?? '').filter(Boolean).join('\n')
      : ''
    return text.trim()
  }
  const choices = d?.choices as
    | { message?: { content?: string }; text?: string }[]
    | undefined
  return (choices?.[0]?.message?.content ?? choices?.[0]?.text ?? '').trim()
}

export async function runStepAction(
  input: RunStepInput
): Promise<RunStepResult> {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to run a step.' }
  }

  const provider = providerFor(input.providerModelId)
  const apiKey = process.env[ENV_KEY[provider]]
  if (!apiKey) {
    return {
      ok: false,
      error: `Missing ${ENV_KEY[provider]} in the server environment. Add it locally or to the deployed branch environment variables, then rebuild or restart, to run ${provider} steps.`,
    }
  }

  // Load the image plus the values to resolve image-based variables.
  const { data: image, error: imageError } = await supabase
    .from('images')
    .select('url, image_description, additional_context')
    .eq('id', input.imageId)
    .maybeSingle()
  if (imageError || !image) {
    return { ok: false, error: 'Unable to load the selected image.' }
  }

  // Sampling tables are small; pull them and sample in memory.
  const [terms, captionExamples, communityContexts] = await Promise.all([
    supabase.from('terms').select('term, definition'),
    supabase.from('caption_examples').select('caption, explanation'),
    supabase.from('community_contexts').select('content'),
  ])

  // The resolver is synchronous, so fetch the Student Brain payload up front —
  // and only when a prompt actually references it, since it's a network call.
  let studentBrainOutput: string | null = null
  if (
    input.userPrompt.includes('${studentBrainOutput}') ||
    input.systemPrompt.includes('${studentBrainOutput}')
  ) {
    try {
      studentBrainOutput = await getStudentBrainOutputText()
    } catch (e) {
      return {
        ok: false,
        error: `Unable to resolve \${studentBrainOutput}: ${
          e instanceof Error ? e.message : String(e)
        }. Set STUDENT_BRAIN_API_URL, STUDENT_BRAIN_CLIENT_ID, and STUDENT_BRAIN_CLIENT_SECRET in the server environment.`,
      }
    }
  }

  let topByVelocity: string | null = null
  if (
    input.userPrompt.includes('${topByVelocity}') ||
    input.systemPrompt.includes('${topByVelocity}')
  ) {
    try {
      topByVelocity = await getTopByVelocityText()
    } catch (e) {
      return {
        ok: false,
        error: `Unable to resolve \${topByVelocity}: ${
          e instanceof Error ? e.message : String(e)
        }. Set STUDENT_BRAIN_API_URL, STUDENT_BRAIN_CLIENT_ID, and STUDENT_BRAIN_CLIENT_SECRET in the server environment.`,
      }
    }
  }

  let topByVolume: string | null = null
  if (
    input.userPrompt.includes('${topByVolume}') ||
    input.systemPrompt.includes('${topByVolume}')
  ) {
    try {
      topByVolume = await getTopByVolumeText()
    } catch (e) {
      return {
        ok: false,
        error: `Unable to resolve \${topByVolume}: ${
          e instanceof Error ? e.message : String(e)
        }. Set STUDENT_BRAIN_API_URL, STUDENT_BRAIN_CLIENT_ID, and STUDENT_BRAIN_CLIENT_SECRET in the server environment.`,
      }
    }
  }

  let recentlyAdded: string | null = null
  if (
    input.userPrompt.includes('${recentlyAdded}') ||
    input.systemPrompt.includes('${recentlyAdded}')
  ) {
    try {
      recentlyAdded = await getRecentlyAddedText()
    } catch (e) {
      return {
        ok: false,
        error: `Unable to resolve \${recentlyAdded}: ${
          e instanceof Error ? e.message : String(e)
        }. Set STUDENT_BRAIN_API_URL, STUDENT_BRAIN_CLIENT_ID, and STUDENT_BRAIN_CLIENT_SECRET in the server environment.`,
      }
    }
  }

  let activeMemories: string | null = null
  if (
    input.userPrompt.includes('${activeMemories}') ||
    input.systemPrompt.includes('${activeMemories}')
  ) {
    try {
      activeMemories = await getActiveMemoriesText()
    } catch (e) {
      return {
        ok: false,
        error: `Unable to resolve \${activeMemories}: ${
          e instanceof Error ? e.message : String(e)
        }. Set STUDENT_BRAIN_API_URL, STUDENT_BRAIN_CLIENT_ID, and STUDENT_BRAIN_CLIENT_SECRET in the server environment.`,
      }
    }
  }

  let persistentMemories: string | null = null
  if (
    input.userPrompt.includes('${persistentMemories}') ||
    input.systemPrompt.includes('${persistentMemories}')
  ) {
    try {
      persistentMemories = await getPersistentMemoriesText()
    } catch (e) {
      return {
        ok: false,
        error: `Unable to resolve \${persistentMemories}: ${
          e instanceof Error ? e.message : String(e)
        }. Set STUDENT_BRAIN_API_URL, STUDENT_BRAIN_CLIENT_ID, and STUDENT_BRAIN_CLIENT_SECRET in the server environment.`,
      }
    }
  }

  let dormantMemories: string | null = null
  if (
    input.userPrompt.includes('${dormantMemories}') ||
    input.systemPrompt.includes('${dormantMemories}')
  ) {
    try {
      dormantMemories = await getDormantMemoriesText()
    } catch (e) {
      return {
        ok: false,
        error: `Unable to resolve \${dormantMemories}: ${
          e instanceof Error ? e.message : String(e)
        }. Set STUDENT_BRAIN_API_URL, STUDENT_BRAIN_CLIENT_ID, and STUDENT_BRAIN_CLIENT_SECRET in the server environment.`,
      }
    }
  }

  const resolve = buildResolver({
    priorOutputs: input.priorOutputs,
    imageDescription: image.image_description ?? '',
    imageAdditionalContext: image.additional_context ?? '',
    terms: (terms.data ?? []) as { term: string; definition: string }[],
    captionExamples: (captionExamples.data ?? []) as {
      caption: string
      explanation: string
    }[],
    communityContexts: (communityContexts.data ?? []) as { content: string }[],
    studentBrainOutput,
    topByVelocity,
    topByVolume,
    recentlyAdded,
    activeMemories,
    persistentMemories,
    dormantMemories,
  })

  const resolvedUserPrompt = substitute(input.userPrompt, resolve)
  const resolvedSystemPrompt = substitute(input.systemPrompt, resolve)

  const includeImage = input.includeImage && Boolean(image.url)
  const useTemperature = input.isTemperatureSupported
  const temperature = input.temperature ?? 0.7

  try {
    let url: string
    let headers: Record<string, string>
    let body: unknown

    if (provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${input.providerModelId}:generateContent?key=${apiKey}`
      headers = { 'Content-Type': 'application/json' }
      const parts: unknown[] = [
        {
          text: resolvedSystemPrompt
            ? `System: ${resolvedSystemPrompt}\n\nUser: ${resolvedUserPrompt}`
            : resolvedUserPrompt,
        },
      ]
      if (includeImage && image.url) {
        const res = await fetch(image.url)
        const buf = Buffer.from(await res.arrayBuffer()).toString('base64')
        parts.push({ inline_data: { mime_type: 'image/jpeg', data: buf } })
      }
      body = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          ...(useTemperature ? { temperature } : {}),
          // Gemini 2.5 models spend hidden "thinking" tokens from this same
          // budget — 2000 gets eaten by reasoning and the answer is cut off.
          maxOutputTokens: 8192,
        },
      }
    } else {
      url =
        provider === 'grok'
          ? 'https://api.x.ai/v1/chat/completions'
          : 'https://api.openai.com/v1/chat/completions'
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }
      const userContent: unknown[] = [{ type: 'text', text: resolvedUserPrompt }]
      if (includeImage && image.url) {
        userContent.push({ type: 'image_url', image_url: { url: image.url } })
      }
      const usesMaxCompletionTokens =
        /^o\d/.test(input.providerModelId) ||
        input.providerModelId.startsWith('gpt-5')
      body = {
        model: input.providerModelId,
        messages: [
          { role: 'system', content: resolvedSystemPrompt },
          { role: 'user', content: userContent },
        ],
        ...(useTemperature ? { temperature } : {}),
        // Reasoning models (o*/gpt-5*) pay for hidden reasoning out of
        // max_completion_tokens — 2000 leaves nothing for the answer.
        // Non-reasoning cap is a ceiling, not a target: multi-candidate JSON
        // steps (2 rated captions × 8 candidates) overflow 2000.
        ...(usesMaxCompletionTokens
          ? { max_completion_tokens: 16000 }
          : { max_tokens: 8000 }),
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text()
      let detail = errText
      try {
        const parsed = JSON.parse(errText)
        detail = parsed?.error?.message ?? parsed?.error ?? errText
      } catch {
        // keep raw text
      }
      return { ok: false, error: `${provider} API error: ${detail}` }
    }

    const data = await response.json()
    const text = parseResponse(data, provider)
    if (!text) {
      // OpenAI delivers safety refusals in message.refusal with content null —
      // surface the actual refusal text instead of a mystery empty output.
      const refusal = (data as { choices?: { message?: { refusal?: string } }[] })
        ?.choices?.[0]?.message?.refusal
      if (refusal) {
        return { ok: false, error: `${provider} refused: ${refusal}` }
      }
      return { ok: false, error: `${provider} returned no readable output.` }
    }
    // A response cut off by the token cap parses as broken JSON downstream
    // with no hint why — surface it as an explicit error instead.
    const finishReason =
      provider === 'gemini'
        ? (data as { candidates?: { finishReason?: string }[] })?.candidates?.[0]?.finishReason
        : (data as { choices?: { finish_reason?: string }[] })?.choices?.[0]?.finish_reason
    if (finishReason === 'MAX_TOKENS' || finishReason === 'length') {
      return {
        ok: false,
        error: `${provider} output was cut off by the max-token limit — the step's output (plus any hidden reasoning) needs a bigger budget or a shorter prompt.`,
      }
    }
    return { ok: true, text, resolvedUserPrompt }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.'
    return { ok: false, error: message }
  }
}
