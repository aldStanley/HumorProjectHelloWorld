'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createClient } from '@/utils/supabase/server'

const parseNumber = (value: FormDataEntryValue | null) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

const normalizeText = (value: FormDataEntryValue | null) => {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const parseStepOrder = (value: FormDataEntryValue | null) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return null
    }

    const ids = parsed
      .map((entry) => Number.parseInt(String(entry), 10))
      .filter((entry) => Number.isFinite(entry))

    return ids.length ? ids : null
  } catch {
    return null
  }
}

const getAuthenticatedSupabaseContext = async () => {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  return {
    supabase,
    userId: user.id,
  }
}

const buildInsertAuditFields = (userId: string) => ({
  created_by_user_id: userId,
  modified_by_user_id: userId,
})

const buildUpdateAuditFields = (userId: string) => ({
  modified_by_user_id: userId,
})

export type UpdateHumorFlavorStepState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  submittedAt?: number
}

export type UpdateStepPromptsResult = { ok: boolean; error?: string }

// Persist the ops-page "hide" toggle on the step row (is_hidden), so hidden
// steps are shared across browsers instead of living in localStorage.
export async function setStepHiddenAction(input: {
  stepId: number
  flavorId: number
  hidden: boolean
}): Promise<UpdateStepPromptsResult> {
  const { supabase, userId } = await getAuthenticatedSupabaseContext()

  const { error } = await supabase
    .from('humor_flavor_steps')
    .update({ is_hidden: input.hidden, ...buildUpdateAuditFields(userId) })
    .eq('id', input.stepId)
    .eq('humor_flavor_id', input.flavorId)

  if (error) {
    console.error('Failed to update step hidden flag.', error)
    return { ok: false, error: 'Unable to save the hidden state right now.' }
  }

  revalidatePath(`/humor-flavor/${input.flavorId}/ops`)
  return { ok: true }
}

// Focused save used by the ops page's detail side panel: update just one
// step's prompt text without the full step form.
export async function updateStepPromptsAction(input: {
  stepId: number
  flavorId: number
  systemPrompt?: string
  userPrompt?: string
}): Promise<UpdateStepPromptsResult> {
  const { supabase, userId } = await getAuthenticatedSupabaseContext()

  const patch: Record<string, unknown> = { ...buildUpdateAuditFields(userId) }
  if (input.systemPrompt !== undefined) patch.llm_system_prompt = input.systemPrompt
  if (input.userPrompt !== undefined) patch.llm_user_prompt = input.userPrompt

  const { error } = await supabase
    .from('humor_flavor_steps')
    .update(patch)
    .eq('id', input.stepId)
    .eq('humor_flavor_id', input.flavorId)

  if (error) {
    console.error('Failed to update step prompts.', error)
    return { ok: false, error: 'Unable to save the prompt right now.' }
  }

  revalidatePath(`/humor-flavor/${input.flavorId}/ops`)
  revalidatePath(`/humor-flavor/${input.flavorId}`)
  return { ok: true }
}

export async function updateHumorFlavorStep(
  _prevState: UpdateHumorFlavorStepState,
  formData: FormData
): Promise<UpdateHumorFlavorStepState> {
  const stepId = parseNumber(formData.get('stepId'))
  const flavorId = parseNumber(formData.get('flavorId'))
  const orderBy = parseNumber(formData.get('order_by'))
  const stepTypeId = parseNumber(formData.get('humor_flavor_step_type_id'))
  const inputTypeId = parseNumber(formData.get('llm_input_type_id'))
  const outputTypeId = parseNumber(formData.get('llm_output_type_id'))
  const modelId = parseNumber(formData.get('llm_model_id'))

  if (
    stepId === null ||
    flavorId === null ||
    orderBy === null ||
    stepTypeId === null ||
    inputTypeId === null ||
    outputTypeId === null ||
    modelId === null
  ) {
    return {
      status: 'error',
      message: 'Missing required step fields.',
      submittedAt: Date.now(),
    }
  }

  const temperatureValue = formData.get('llm_temperature')
  const temperatureParsed =
    typeof temperatureValue === 'string' && temperatureValue.trim() !== ''
      ? Number.parseFloat(temperatureValue)
      : null
  const llmTemperature = Number.isFinite(temperatureParsed)
    ? temperatureParsed
    : null

  const { supabase, userId } = await getAuthenticatedSupabaseContext()

  const { data: model, error: modelError } = await supabase
    .from('llm_models')
    .select('is_temperature_supported')
    .eq('id', modelId)
    .maybeSingle()

  if (modelError || !model) {
    console.error('Failed to load model temperature support.', modelError)
    return {
      status: 'error',
      message: 'Unable to load model details.',
      submittedAt: Date.now(),
    }
  }

  const resolvedTemperature = model.is_temperature_supported
    ? llmTemperature
    : null

  const { count: stepCount, error: stepCountError } = await supabase
    .from('humor_flavor_steps')
    .select('*', { count: 'exact', head: true })
    .eq('humor_flavor_id', flavorId)

  if (stepCountError || stepCount === null || stepCount < 1) {
    console.error('Failed to load humor flavor step count.', stepCountError)
    return {
      status: 'error',
      message: 'Unable to validate the step order right now.',
      submittedAt: Date.now(),
    }
  }

  if (orderBy < 1 || orderBy > stepCount) {
    return {
      status: 'error',
      message: `Step order must be between 1 and ${stepCount}.`,
      submittedAt: Date.now(),
    }
  }

  const { error } = await supabase
    .from('humor_flavor_steps')
    .update({
      order_by: orderBy,
      humor_flavor_step_type_id: stepTypeId,
      llm_input_type_id: inputTypeId,
      llm_output_type_id: outputTypeId,
      llm_model_id: modelId,
      llm_temperature: resolvedTemperature,
      llm_system_prompt: normalizeText(formData.get('llm_system_prompt')),
      llm_user_prompt: normalizeText(formData.get('llm_user_prompt')),
      description: normalizeText(formData.get('description')),
      ...buildUpdateAuditFields(userId),
    })
    .eq('id', stepId)
    .eq('humor_flavor_id', flavorId)

  if (error) {
    console.error('Failed to update humor flavor step.', error)
    return {
      status: 'error',
      message: 'Unable to update the step right now.',
      submittedAt: Date.now(),
    }
  }

  revalidatePath(`/humor-flavor/${flavorId}`)
  revalidatePath(`/humor-flavor-step/${stepId}`)

  return {
    status: 'success',
    message: 'Your changes to this step have been saved!',
    submittedAt: Date.now(),
  }
}

export async function createHumorFlavorStep(formData: FormData) {
  const flavorId = parseNumber(formData.get('flavorId'))
  const stepTypeId = parseNumber(formData.get('humor_flavor_step_type_id'))
  const inputTypeId = parseNumber(formData.get('llm_input_type_id'))
  const outputTypeId = parseNumber(formData.get('llm_output_type_id'))
  const modelId = parseNumber(formData.get('llm_model_id'))

  if (
    flavorId === null ||
    stepTypeId === null ||
    inputTypeId === null ||
    outputTypeId === null ||
    modelId === null
  ) {
    return
  }

  const temperatureValue = formData.get('llm_temperature')
  const temperatureParsed =
    typeof temperatureValue === 'string' && temperatureValue.trim() !== ''
      ? Number.parseFloat(temperatureValue)
      : null
  const llmTemperature = Number.isFinite(temperatureParsed)
    ? temperatureParsed
    : null

  const { supabase, userId } = await getAuthenticatedSupabaseContext()

  const { data: model, error: modelError } = await supabase
    .from('llm_models')
    .select('is_temperature_supported')
    .eq('id', modelId)
    .maybeSingle()

  if (modelError || !model) {
    console.error('Failed to load model temperature support.', modelError)
    return
  }

  const { data: lastStep, error: lastStepError } = await supabase
    .from('humor_flavor_steps')
    .select('order_by')
    .eq('humor_flavor_id', flavorId)
    .order('order_by', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastStepError) {
    console.error('Failed to load last step order.', lastStepError)
    return
  }

  const nextOrder = (lastStep?.order_by ?? 0) + 1
  const { data: newStep, error } = await supabase
    .from('humor_flavor_steps')
    .insert({
      humor_flavor_id: flavorId,
      order_by: nextOrder,
      humor_flavor_step_type_id: stepTypeId,
      llm_input_type_id: inputTypeId,
      llm_output_type_id: outputTypeId,
      llm_model_id: modelId,
      llm_temperature: model.is_temperature_supported ? llmTemperature : null,
      llm_system_prompt: normalizeText(formData.get('llm_system_prompt')),
      llm_user_prompt: normalizeText(formData.get('llm_user_prompt')),
      ...buildInsertAuditFields(userId),
    })
    .select('id')
    .single()

  if (error || !newStep) {
    console.error('Failed to create humor flavor step.', error)
    return
  }

  revalidatePath(`/humor-flavor/${flavorId}`)
  revalidatePath(`/humor-flavor-step/${newStep.id}`)
  redirect(`/humor-flavor-step/${newStep.id}`)
}

export async function reorderHumorFlavorSteps(formData: FormData) {
  const flavorId = parseNumber(formData.get('flavorId'))
  const stepOrder = parseStepOrder(formData.get('stepOrder'))

  if (flavorId === null || !stepOrder?.length) {
    return
  }

  const { supabase, userId } = await getAuthenticatedSupabaseContext()

  const { data: steps, error: stepsError } = await supabase
    .from('humor_flavor_steps')
    .select('id')
    .eq('humor_flavor_id', flavorId)

  if (stepsError || !steps) {
    console.error('Failed to load steps for reorder.', stepsError)
    return
  }

  const validIds = new Set(steps.map((step) => step.id))
  const filteredIds = stepOrder.filter((id) => validIds.has(id))

  if (filteredIds.length !== steps.length) {
    return
  }

  const updates = filteredIds.map((id, index) =>
    supabase
      .from('humor_flavor_steps')
      .update({
        order_by: index + 1,
        ...buildUpdateAuditFields(userId),
      })
      .eq('id', id)
      .eq('humor_flavor_id', flavorId)
  )

  const results = await Promise.all(updates)
  const updateError = results.find((result) => result.error)?.error

  if (updateError) {
    console.error('Failed to reorder humor flavor steps.', updateError)
    return
  }

  revalidatePath(`/humor-flavor/${flavorId}`)
  filteredIds.forEach((id) => {
    revalidatePath(`/humor-flavor-step/${id}`)
  })
}

export async function deleteHumorFlavorStep(formData: FormData) {
  const flavorId = parseNumber(formData.get('flavorId'))
  const stepId = parseNumber(formData.get('deleteStepId'))

  if (flavorId === null || stepId === null) {
    return
  }

  const { supabase, userId } = await getAuthenticatedSupabaseContext()

  const { data: step, error: stepError } = await supabase
    .from('humor_flavor_steps')
    .select('id, order_by')
    .eq('id', stepId)
    .eq('humor_flavor_id', flavorId)
    .maybeSingle()

  if (stepError || !step) {
    console.error('Failed to load humor flavor step for deletion.', stepError)
    return
  }

  const { error: deleteError } = await supabase
    .from('humor_flavor_steps')
    .delete()
    .eq('id', stepId)
    .eq('humor_flavor_id', flavorId)

  if (deleteError) {
    console.error('Failed to delete humor flavor step.', deleteError)
    return
  }

  const { data: remainingSteps, error: remainingError } = await supabase
    .from('humor_flavor_steps')
    .select('id, order_by')
    .eq('humor_flavor_id', flavorId)
    .order('order_by', { ascending: true })

  if (remainingError || !remainingSteps) {
    console.error(
      'Failed to load humor flavor steps for reorder after deletion.',
      remainingError
    )
    return
  }

  const updates = remainingSteps.map((remainingStep, index) =>
    supabase
      .from('humor_flavor_steps')
      .update({
        order_by: index + 1,
        ...buildUpdateAuditFields(userId),
      })
      .eq('id', remainingStep.id)
      .eq('humor_flavor_id', flavorId)
  )

  const updateResults = await Promise.all(updates)
  const updateError = updateResults.find((result) => result.error)?.error

  if (updateError) {
    console.error('Failed to reorder humor flavor steps.', updateError)
    return
  }

  revalidatePath(`/humor-flavor/${flavorId}`)
  remainingSteps.forEach((remainingStep) => {
    revalidatePath(`/humor-flavor-step/${remainingStep.id}`)
  })
}

export async function duplicateHumorFlavor(
  _: { message: string },
  formData: FormData
) {
  const flavorId = parseNumber(formData.get('flavorId'))
  const slug = normalizeText(formData.get('slug'))
  const description = normalizeText(formData.get('description'))

  if (flavorId === null || !slug) {
    return { message: 'Slug is required.' }
  }

  const { supabase, userId } = await getAuthenticatedSupabaseContext()

  const { data: flavor, error: flavorError } = await supabase
    .from('humor_flavors')
    .select('id')
    .eq('id', flavorId)
    .maybeSingle()

  if (flavorError || !flavor) {
    return
  }

  const { data: newFlavor, error: insertFlavorError } = await supabase
    .from('humor_flavors')
    .insert({
      slug,
      description,
      ...buildInsertAuditFields(userId),
    })
    .select('id')
    .single()

  if (insertFlavorError || !newFlavor) {
    if (insertFlavorError?.code === '23505') {
      return { message: 'That slug already exists. Pick a new one.' }
    }
    console.error('Failed to duplicate humor flavor.', insertFlavorError)
    return { message: 'Unable to duplicate flavor. Please try again.' }
  }

  type DupStepRow = Record<string, unknown> & { is_hidden?: boolean | null }
  const dupColumns =
    'order_by, llm_temperature, llm_system_prompt, llm_user_prompt, humor_flavor_step_type_id, llm_input_type_id, llm_model_id, llm_output_type_id'
  let { data: steps, error: stepsError } = (await supabase
    .from('humor_flavor_steps')
    .select(`${dupColumns}, is_hidden`)
    .eq('humor_flavor_id', flavor.id)
    .order('order_by', { ascending: true })) as {
    data: DupStepRow[] | null
    error: { message?: string } | null
  }
  if (stepsError) {
    // is_hidden migration not applied yet — fall back to the legacy columns.
    ;({ data: steps, error: stepsError } = (await supabase
      .from('humor_flavor_steps')
      .select(dupColumns)
      .eq('humor_flavor_id', flavor.id)
      .order('order_by', { ascending: true })) as {
      data: DupStepRow[] | null
      error: { message?: string } | null
    })
  }

  if (stepsError) {
    console.error('Failed to load steps for duplication.', stepsError)
  } else if (steps && steps.length) {
    const stepInserts = steps.map(
      (step: DupStepRow) => ({
        humor_flavor_id: newFlavor.id,
        order_by: step.order_by,
        llm_temperature: step.llm_temperature,
        llm_system_prompt: step.llm_system_prompt,
        llm_user_prompt: step.llm_user_prompt,
        humor_flavor_step_type_id: step.humor_flavor_step_type_id,
        llm_input_type_id: step.llm_input_type_id,
        llm_model_id: step.llm_model_id,
        llm_output_type_id: step.llm_output_type_id,
        ...(step.is_hidden != null ? { is_hidden: step.is_hidden } : {}),
        ...buildInsertAuditFields(userId),
      })
    )

    const { error: insertStepsError } = await supabase
      .from('humor_flavor_steps')
      .insert(stepInserts)

    if (insertStepsError) {
      console.error('Failed to duplicate humor flavor steps.', insertStepsError)
    }
  }

  revalidatePath('/')
  revalidatePath(`/humor-flavor/${newFlavor.id}`)
  redirect(`/humor-flavor/${newFlavor.id}`)
}

export type SaveFlavorFavoriteResult = { ok: boolean; error?: string }

// Upsert the current user's favorite flag + comment for a flavor. One row per
// (user, flavor) via the unique constraint, so this both creates and updates.
export async function saveFlavorFavorite(input: {
  flavorId: number
  isFavorite: boolean
  // undefined = leave the existing comment untouched (heart-only toggles)
  comment?: string | null
}): Promise<SaveFlavorFavoriteResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in.' }
  }

  const row: Record<string, unknown> = {
    flavor_id: input.flavorId,
    profile_id: user.id,
    is_favorite: input.isFavorite,
    modified_datetime_utc: new Date().toISOString(),
  }
  if (input.comment !== undefined) {
    row.comment = input.comment?.trim() ? input.comment.trim() : null
  }
  const { error } = await supabase
    .from('humor_flavor_favorites')
    .upsert(row, { onConflict: 'flavor_id,profile_id' })

  if (error) {
    return { ok: false, error: 'Could not save. Is the favorites table created?' }
  }

  revalidatePath(`/humor-flavor/${input.flavorId}`)
  return { ok: true }
}

export type FlavorNote = {
  id: number
  body: string
  createdAt: string
}

export type AddFlavorNoteResult = {
  ok: boolean
  note?: FlavorNote
  error?: string
}

// Append one note to the flavor's log. Append-only by design: the table has
// no update/delete RLS policies, so a posted note is permanent.
export async function addFlavorNote(input: {
  flavorId: number
  body: string
}): Promise<AddFlavorNoteResult> {
  const body = input.body.trim()
  if (!body) {
    return { ok: false, error: 'Write something first.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in.' }
  }

  const { data: note, error } = await supabase
    .from('humor_flavor_notes')
    .insert({ flavor_id: input.flavorId, profile_id: user.id, body })
    .select('id, body, created_datetime_utc')
    .single()

  if (error || !note) {
    console.error('Failed to add flavor note.', error)
    return { ok: false, error: 'Could not save. Is the notes table created?' }
  }

  revalidatePath(`/humor-flavor/${input.flavorId}/ops`)
  revalidatePath(`/humor-flavor/${input.flavorId}/ops-reverse`)
  return {
    ok: true,
    note: { id: note.id, body: note.body, createdAt: note.created_datetime_utc },
  }
}

// One scoped update keeps bulk model changes atomic under the user's RLS policies.
export async function updateAllStepModelsAction(input: {
  flavorId: number
  modelId: number
}): Promise<UpdateStepPromptsResult> {
  if (!Number.isSafeInteger(input.flavorId) || input.flavorId <= 0 ||
      !Number.isSafeInteger(input.modelId) || input.modelId <= 0) {
    return { ok: false, error: 'Choose a valid flavor and model.' }
  }
  const { supabase, userId } = await getAuthenticatedSupabaseContext()
  const { data: model, error: modelError } = await supabase
    .from('llm_models').select('id, is_temperature_supported')
    .eq('id', input.modelId).maybeSingle()
  if (modelError || !model) return { ok: false, error: 'This model is unavailable.' }

  const { data, error } = await supabase.from('humor_flavor_steps')
    .update({
      llm_model_id: model.id,
      ...(!model.is_temperature_supported ? { llm_temperature: null } : {}),
      ...buildUpdateAuditFields(userId),
    })
    .eq('humor_flavor_id', input.flavorId).select('id')
  if (error) return { ok: false, error: 'Unable to update the step models.' }
  if (!data?.length) return { ok: false, error: 'No editable steps were found for this flavor.' }
  revalidatePath(`/humor-flavor/${input.flavorId}`, 'layout')
  return { ok: true }
}
