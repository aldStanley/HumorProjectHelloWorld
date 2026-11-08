'use server'

import { request as httpsRequest } from 'node:https'

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
  // The prompts exactly as sent (variables substituted) — the ops batch runner
  // archives these so a run can be analyzed or recreated later.
  resolvedUserPrompt?: string
  resolvedSystemPrompt?: string
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

export type RunStepInput = {
  // null for surfaces with no image at all (the POV Joke Maker runs a moment
  // through text-only steps) — image variables then resolve to empty strings.
  imageId: string | null
  systemPrompt: string
  userPrompt: string
  providerModelId: string
  temperature: number | null
  includeImage: boolean
  isTemperatureSupported: boolean
  // step number (order_by) -> already-known output for that image
  priorOutputs: Record<string, string>
  // OpenAI reasoning models only; omitted leaves the provider default.
  reasoningEffort?: 'low' | 'medium' | 'high' | null
  // Raises the per-call output budget for steps whose answer (plus hidden
  // reasoning) does not fit the defaults below.
  maxOutputTokens?: number | null
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
    // An explicit named binding (used by the typed-operations surface) wins
    // first — INCLUDING names that look like step tokens: the ops page's
    // flavor-derived pipelines pass slots like "step1Output" verbatim, and the
    // legacy number-keyed lookup below would miss them and silently return ''.
    if (Object.prototype.hasOwnProperty.call(opts.priorOutputs, variableName)) {
      return opts.priorOutputs[variableName]
    }

    // Legacy chiltrix convention: priorOutputs keyed by step number — the
    // token may be a plain number ("8") or a letter-suffixed insert ("7a").
    const stepMatch = variableName.match(/^step(\d+[a-z]*)Output$/)
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

// A transport failure — the request never got an HTTP response — reaches us
// from undici as the single opaque word pair "fetch failed", with the actual
// reason hidden on `err.cause`. Unwrapping it is the difference between a
// diagnosable failure and a shrug: UND_ERR_HEADERS_TIMEOUT means the model
// took longer than the client would wait, ECONNRESET means the connection was
// dropped, ENOTFOUND means DNS.
const describeTransportFailure = (err: unknown, elapsedMs: number): string => {
  const error = err as {
    message?: string
    cause?: { code?: string; message?: string }
  }
  const code = error?.cause?.code
  const causeMessage = error?.cause?.message
  const seconds = Math.round(elapsedMs / 1000)
  const base =
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
      ? `the model did not answer within ${seconds}s`
      : code === 'ECONNRESET' || code === 'UND_ERR_SOCKET'
        ? `the connection was dropped after ${seconds}s`
        : code === 'ENOTFOUND' || code === 'EAI_AGAIN'
          ? 'the provider host could not be resolved — check the network'
          : `the request failed after ${seconds}s`
  const detail = [code, causeMessage].filter(Boolean).join(' — ')
  const advice =
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_BODY_TIMEOUT'
      ? ' Even for a large step that is a long time: try a lower reasoning effort, a smaller max-output budget, or a shorter prompt. Nothing was saved, so re-running is safe.'
      : ' Nothing was saved, so re-running is safe.'
  return `Could not reach the model: ${base}${detail ? ` (${detail})` : ''}.${advice}`
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

// How long a single model call may take. This is deliberately far past any
// normal step: a large reasoning step (a discovery prompt asking for a dozen
// personas with their premises, at high effort) genuinely runs for many
// minutes, and the whole call is billed whether or not we are still listening.
const MODEL_TIMEOUT_MS = 15 * 60 * 1000

// Provider POSTs go through node:https rather than fetch, for one specific
// reason: fetch is undici, and undici gives up waiting for response HEADERS
// after 300s, which cannot be raised per request. A step that reasons for six
// minutes therefore died as the opaque error "fetch failed" with the call
// already paid for. node:https has no such cap, so the timeout here is one we
// choose, and the socket's idle timer is set to it explicitly.
const postJson = (
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = httpsRequest(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }))
        res.on('error', reject)
      }
    )
    // An LLM call is silent while it thinks, so this is an inactivity timer on
    // a deliberately long fuse rather than a response deadline.
    req.setTimeout(MODEL_TIMEOUT_MS, () => {
      req.destroy(
        Object.assign(new Error('Model call timed out'), {
          cause: { code: 'ETIMEDOUT', message: `no response within ${MODEL_TIMEOUT_MS / 1000}s` },
        })
      )
    })
    req.on('error', reject)
    req.end(body)
  })

// One retry for transport failures only. A request that never produced a
// response has no result to lose, and these steps are expensive enough that
// throwing away a multi-minute call over one dropped socket is worse than
// paying for a second attempt. An HTTP error response is NOT retried here —
// it is returned and reported, because retrying a 400 just wastes time.
const postJsonWithOneRetry = async (
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<{ status: number; text: string }> => {
  try {
    return await postJson(url, headers, body)
  } catch (first) {
    await sleep(2000)
    try {
      return await postJson(url, headers, body)
    } catch {
      throw first
    }
  }
}

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

// Refreshes the auth cookie and returns at once. A step call takes a minute
// and its response, which is what carries a refreshed cookie back to the
// browser, is a minute away; calls started in between carry a refresh token
// Supabase has already rotated and rejects after ten seconds. Calling this
// right before a long call, with a client that is allowed to write cookies,
// puts a fresh token in the browser first. See pov-jokes/run-step.ts.
export async function touchSessionAction(): Promise<{ ok: boolean }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return { ok: Boolean(user) }
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

  // Load the image plus the values to resolve image-based variables. Steps run
  // without an image (imageId null) skip this entirely.
  let image: {
    url: string | null
    image_description: string | null
    additional_context: string | null
  } = { url: null, image_description: null, additional_context: null }
  if (input.imageId) {
    const { data: imageRow, error: imageError } = await supabase
      .from('images')
      .select('url, image_description, additional_context')
      .eq('id', input.imageId)
      .maybeSingle()
    if (imageError || !imageRow) {
      return { ok: false, error: 'Unable to load the selected image.' }
    }
    image = imageRow
  }

  // Sampling tables are small; pull them and sample in memory.
  const [terms, captionExamples, communityContexts] = await Promise.all([
    supabase.from('terms').select('term, definition'),
    supabase.from('caption_examples').select('caption, explanation'),
    supabase.from('community_contexts').select('content'),
  ])

  // The resolver is synchronous, so fetch the Student Brain payload up front —
  // and only when a prompt actually references it, since it's a network call.
  // The ops page can send the slot itself (switched off, or a saved Sidechat
  // clustering); the resolver reads priorOutputs first, so skip the fetch.
  let studentBrainOutput: string | null = null
  if (
    !Object.prototype.hasOwnProperty.call(input.priorOutputs, 'studentBrainOutput') &&
    (input.userPrompt.includes('${studentBrainOutput}') ||
      input.systemPrompt.includes('${studentBrainOutput}'))
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
          // budget. 8192 was enough until multi-set caption steps (3 register
          // sets × per-caption cast/allusion JSON) — thinking + full answer
          // overflowed it. Ceiling, not target: unused budget costs nothing.
          maxOutputTokens: 32768,
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
        ...(input.reasoningEffort && usesMaxCompletionTokens
          ? { reasoning_effort: input.reasoningEffort }
          : {}),
        // Reasoning models (o*/gpt-5*) also pay for hidden reasoning out of
        // max_completion_tokens — same larger budget as diagnoseJokeAction.
        // Non-reasoning cap is a ceiling, not a target: multi-candidate JSON
        // steps (2 rated captions × 8 candidates) overflow 2000.
        ...(usesMaxCompletionTokens
          ? { max_completion_tokens: input.maxOutputTokens ?? 16000 }
          : { max_tokens: input.maxOutputTokens ?? 8000 }),
      }
    }

    const startedAt = Date.now()
    let response: { status: number; text: string }
    try {
      response = await postJsonWithOneRetry(url, headers, JSON.stringify(body))
    } catch (err) {
      return {
        ok: false,
        error: describeTransportFailure(err, Date.now() - startedAt),
        resolvedUserPrompt,
        resolvedSystemPrompt,
      }
    }

    if (response.status < 200 || response.status >= 300) {
      let detail = response.text
      try {
        const parsed = JSON.parse(response.text)
        detail = parsed?.error?.message ?? parsed?.error ?? response.text
      } catch {
        // keep raw text
      }
      return {
        ok: false,
        error: `${provider} API error: ${detail}`,
        resolvedUserPrompt,
        resolvedSystemPrompt,
      }
    }

    let data: unknown
    try {
      data = JSON.parse(response.text)
    } catch {
      return {
        ok: false,
        error: `${provider} returned a ${response.status} whose body was not JSON: ${response.text.slice(0, 300)}`,
        resolvedUserPrompt,
        resolvedSystemPrompt,
      }
    }
    const text = parseResponse(data, provider)
    if (!text) {
      // OpenAI delivers safety refusals in message.refusal with content null —
      // surface the actual refusal text instead of a mystery empty output.
      const refusal = (data as { choices?: { message?: { refusal?: string } }[] })
        ?.choices?.[0]?.message?.refusal
      if (refusal) {
        return {
          ok: false,
          error: `${provider} refused: ${refusal}`,
          resolvedUserPrompt,
          resolvedSystemPrompt,
        }
      }
      return {
        ok: false,
        error: `${provider} returned no readable output.`,
        resolvedUserPrompt,
        resolvedSystemPrompt,
      }
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
        resolvedUserPrompt,
        resolvedSystemPrompt,
      }
    }
    return { ok: true, text, resolvedUserPrompt, resolvedSystemPrompt }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.'
    return { ok: false, error: message }
  }
}

export type DiagnoseJokeResult = { ok: boolean; text?: string; error?: string }

// Conversational root-cause helper. Given the full per-step trail (prompt +
// output for each step) that produced ONE joke as fixed context, plus the
// running conversation (the user's complaint and any follow-up feedback), it
// helps localize the faulty step and refine that diagnosis as the user pushes
// back. No image / no variable substitution.
export async function diagnoseJokeAction(input: {
  providerModelId?: string
  caption: string
  steps: { title: string; scope: string; prompt: string; output: string }[]
  messages: { role: 'user' | 'assistant'; content: string }[]
}): Promise<DiagnoseJokeResult> {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in.' }
  }

  const providerModelId = input.providerModelId ?? 'gpt-4o-2024-08-06'
  const provider = providerFor(providerModelId)
  const apiKey = process.env[ENV_KEY[provider]]
  if (!apiKey) {
    return { ok: false, error: `Missing ${ENV_KEY[provider]} in the environment.` }
  }

  const trace = input.steps
    .map(
      (s, i) =>
        `### Step ${i + 1}: ${s.title} (${s.scope})\n` +
        `PROMPT:\n${s.prompt || '(code step — no prompt)'}\n\n` +
        `OUTPUT:\n${s.output || '(no output)'}`
    )
    .join('\n\n')

  const systemPrompt =
    'You are debugging a multi-step joke-generation pipeline (image → recognition ' +
    '→ description → tone → moment selection → reaction → caption → scoring → ' +
    'ranking). Below is ONE final joke and, in order, every step that produced it ' +
    'with that step’s PROMPT and OUTPUT.\n\n' +
    `THE JOKE / CAPTION:\n"${input.caption}"\n\n` +
    `EVERY STEP THAT PRODUCED IT:\n\n${trace}\n\n` +
    'The user will tell you what they dislike and discuss it with you. Help them ' +
    'find WHICH step introduced the problem — the flaw is usually UPSTREAM of where ' +
    'it becomes visible, so look for where it FIRST appears. Reference steps by ' +
    'their exact titles above, and quote the specific step OUTPUT that reveals the ' +
    'fault. Suggest a concrete change to that step’s PROMPT. This is a conversation: ' +
    'if the user pushes back or gives new information, genuinely reconsider — do not ' +
    'just restate your previous answer. Be concise and specific; no JSON, plain prose.'

  try {
    let url: string
    let headers: Record<string, string>
    let body: unknown

    if (provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${providerModelId}:generateContent?key=${apiKey}`
      headers = { 'Content-Type': 'application/json' }
      body = {
        contents: [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'model', parts: [{ text: 'Understood — what’s wrong with it?' }] },
          ...input.messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
        ],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1200 },
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
      // Reasoning models (o-series: o1/o3/o4/…, and gpt-5*) reject `temperature`
      // and use `max_completion_tokens`, with a larger budget since reasoning
      // tokens count against it.
      const isReasoning =
        /^o\d/.test(providerModelId) || providerModelId.startsWith('gpt-5')
      body = {
        model: providerModelId,
        messages: [
          { role: isReasoning ? 'developer' : 'system', content: systemPrompt },
          ...input.messages,
        ],
        ...(isReasoning ? {} : { temperature: 0.3 }),
        ...(isReasoning
          ? { max_completion_tokens: 16000 }
          : { max_tokens: 1200 }),
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const errText = await response.text()
      return { ok: false, error: `${provider} API error: ${errText.slice(0, 300)}` }
    }
    const data = await response.json()
    const text = parseResponse(data, provider)
    if (!text) return { ok: false, error: `${provider} returned no readable output.` }
    return { ok: true, text }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error.' }
  }
}

export type SaveOutputResult = { ok: boolean; error?: string }

// Auto-save a single generated cell value to the current flavor (latest only:
// replaces any prior response for this flavor + step + image).
export async function saveOneOutputAction(input: {
  flavorId: number
  stepId: number
  imageId: string
  output: string
  modelId: number
  systemPrompt: string
  userPrompt: string
  temperature: number | null
}): Promise<SaveOutputResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to save.' }
  }
  const profileId = user.id

  try {
    const { data: crs } = await supabase
      .from('caption_requests')
      .select('id')
      .eq('image_id', input.imageId)
      .eq('profile_id', profileId)
    const crIds = (crs ?? []).map((c) => c.id)

    if (crIds.length) {
      await supabase
        .from('llm_model_responses')
        .delete()
        .eq('humor_flavor_id', input.flavorId)
        .eq('humor_flavor_step_id', input.stepId)
        .in('caption_request_id', crIds)
    }

    let captionRequestId = crIds[0]
    if (captionRequestId == null) {
      const { data: newCr, error } = await supabase
        .from('caption_requests')
        .insert({ image_id: input.imageId, profile_id: profileId })
        .select('id')
        .single()
      if (error || !newCr) {
        return { ok: false, error: 'Could not create caption request.' }
      }
      captionRequestId = newCr.id
    }

    const { error } = await supabase.from('llm_model_responses').insert({
      caption_request_id: captionRequestId,
      humor_flavor_id: input.flavorId,
      humor_flavor_step_id: input.stepId,
      llm_model_id: input.modelId,
      llm_system_prompt: input.systemPrompt ?? '',
      llm_user_prompt: input.userPrompt ?? '',
      llm_model_response: input.output,
      llm_temperature: input.temperature,
      processing_time_seconds: 0,
      profile_id: profileId,
    })
    if (error) {
      return { ok: false, error: 'Could not save output.' }
    }
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.'
    return { ok: false, error: message }
  }
}

export type SavePromptResult = { ok: boolean; error?: string }

// Persist a single step's system or user prompt to the current flavor.
export async function saveStepPromptAction(input: {
  flavorId: number
  stepId: number
  kind: 'system' | 'user'
  value: string
}): Promise<SavePromptResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to save.' }
  }

  const patch =
    input.kind === 'system'
      ? { llm_system_prompt: input.value, modified_by_user_id: user.id }
      : { llm_user_prompt: input.value, modified_by_user_id: user.id }

  const { error } = await supabase
    .from('humor_flavor_steps')
    .update(patch)
    .eq('id', input.stepId)
    .eq('humor_flavor_id', input.flavorId)
  if (error) {
    return { ok: false, error: 'Could not save the prompt.' }
  }

  revalidatePath(`/humor-flavor/${input.flavorId}/chiltrix`)
  return { ok: true }
}

export type ChatResult = { ok: boolean; text?: string; error?: string }

// A plain multi-turn chat: a fixed system prompt (whatever context the
// caller assembled) and the running conversation. Used by the Reaction Joke
// Maker's workshop pane (Lydia, 2026-09-09: "click on a meme and open a
// pane to workshop it ... just have a chat with gpt 5.6 sol medium
// reasoning"). No image, no variable substitution, no saving.
export async function chatAction(input: {
  providerModelId: string
  systemPrompt: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  reasoningEffort?: 'low' | 'medium' | 'high' | null
  maxOutputTokens?: number | null
}): Promise<ChatResult> {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in.' }
  }
  const providerModelId = input.providerModelId
  const provider = providerFor(providerModelId)
  const apiKey = process.env[ENV_KEY[provider]]
  if (!apiKey) return { ok: false, error: `Missing ${ENV_KEY[provider]} in the environment.` }
  if (provider === 'gemini') return { ok: false, error: 'The workshop chat runs on OpenAI-style models only.' }
  const isReasoning = /^o\d/.test(providerModelId) || providerModelId.startsWith('gpt-5')
  const body = {
    model: providerModelId,
    messages: [{ role: isReasoning ? 'developer' : 'system', content: input.systemPrompt }, ...input.messages],
    ...(isReasoning ? {} : { temperature: 0.5 }),
    ...(isReasoning
      ? {
          max_completion_tokens: input.maxOutputTokens ?? 16000,
          ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
        }
      : { max_tokens: input.maxOutputTokens ?? 2000 }),
  }
  try {
    const response = await fetch(
      provider === 'grok' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      }
    )
    if (!response.ok) {
      const errText = await response.text()
      return { ok: false, error: `${provider} API error: ${errText.slice(0, 300)}` }
    }
    const data = await response.json()
    const text = parseResponse(data, provider)
    if (!text) return { ok: false, error: `${provider} returned no readable output.` }
    return { ok: true, text }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error.' }
  }
}
