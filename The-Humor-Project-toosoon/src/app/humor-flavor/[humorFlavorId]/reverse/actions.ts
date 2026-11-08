'use server'

// Server actions for the reverse (context → image) surface: reading and
// writing the cached per-image reaction profiles. LLM execution reuses the
// shared runStepAction from the chiltrix actions — the reverse client passes
// its variables (momentInput, imageCatalog, ...) as named priorOutputs.
import { getStudentBrainOutputText } from '@/utils/student-brain'
import { createClient } from '@/utils/supabase/server'

export type ReverseProfile = {
  imageId: string
  // raw text output of each preprocessing step, keyed by order_by ("1".."4")
  stepOutputs: Record<string, string>
  // parsed JSON of the Search Card step (null if it failed to parse)
  searchCard: unknown
  promptHash: string
  modifiedAt: string | null
}

const MISSING_TABLE_HINT =
  'The image_reaction_profiles table does not exist yet — run ' +
  'supabase/migrations/20260719000000_image_reaction_profiles.sql in the ' +
  'Supabase SQL editor, then reload.'

const isMissingTable = (error: { code?: string; message?: string }): boolean =>
  error.code === '42P01' ||
  error.code === 'PGRST205' ||
  (error.message ?? '').includes('image_reaction_profiles')

type ProfileRow = {
  image_id: string
  step_outputs: Record<string, string> | null
  search_card: unknown
  prompt_hash: string
  modified_datetime_utc: string | null
}

export type ListProfilesResult =
  | { ok: true; profiles: ReverseProfile[] }
  | { ok: false; error: string; missingTable: boolean }

export async function listProfilesAction(input: {
  flavorId: number
}): Promise<ListProfilesResult> {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in.', missingTable: false }
  }

  const { data, error } = await supabase
    .from('image_reaction_profiles')
    .select('image_id, step_outputs, search_card, prompt_hash, modified_datetime_utc')
    .eq('humor_flavor_id', input.flavorId)
  if (error) {
    const missing = isMissingTable(error)
    return {
      ok: false,
      error: missing ? MISSING_TABLE_HINT : 'Could not load profiles.',
      missingTable: missing,
    }
  }

  return {
    ok: true,
    profiles: ((data ?? []) as ProfileRow[]).map((row) => ({
      imageId: row.image_id,
      stepOutputs: row.step_outputs ?? {},
      searchCard: row.search_card,
      promptHash: row.prompt_hash,
      modifiedAt: row.modified_datetime_utc,
    })),
  }
}

export type SaveProfileResult = { ok: boolean; error?: string }

export async function saveProfileAction(input: {
  flavorId: number
  imageId: string
  stepOutputs: Record<string, string>
  searchCard: unknown
  promptHash: string
}): Promise<SaveProfileResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to save.' }
  }

  const { error } = await supabase.from('image_reaction_profiles').upsert(
    {
      image_id: input.imageId,
      humor_flavor_id: input.flavorId,
      step_outputs: input.stepOutputs,
      search_card: input.searchCard,
      prompt_hash: input.promptHash,
      profile_id: user.id,
      modified_datetime_utc: new Date().toISOString(),
    },
    { onConflict: 'image_id,humor_flavor_id' }
  )
  if (error) {
    return {
      ok: false,
      error: isMissingTable(error) ? MISSING_TABLE_HINT : 'Could not save the profile.',
    }
  }
  return { ok: true }
}

export type CopyProfilesResult = {
  ok: boolean
  copiedCount?: number
  missingCount?: number
  error?: string
}

// Copy another flavor's cached reaction profiles into this flavor, instead of
// re-running preprocessing. Rows are copied verbatim (including prompt_hash):
// if the target flavor's P-step prompts match the source's — the usual case
// for a duplicated flavor — the copies show as fresh; otherwise as stale.
// Only the requested image ids are touched, so callers pass the missing/stale
// ones and fresh target profiles are never overwritten.
export async function copyProfilesAction(input: {
  targetFlavorId: number
  sourceFlavorId: number
  imageIds: string[]
}): Promise<CopyProfilesResult> {
  if (!input.imageIds.length) {
    return { ok: false, error: 'No images need a profile.' }
  }
  if (input.sourceFlavorId === input.targetFlavorId) {
    return { ok: false, error: 'Source and target flavor are the same.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in.' }
  }

  const { data: sourceRows, error: sourceError } = await supabase
    .from('image_reaction_profiles')
    .select('image_id, step_outputs, search_card, prompt_hash')
    .eq('humor_flavor_id', input.sourceFlavorId)
    .in('image_id', input.imageIds)
  if (sourceError) {
    return {
      ok: false,
      error: isMissingTable(sourceError)
        ? MISSING_TABLE_HINT
        : 'Could not load the source profiles.',
    }
  }
  const rows = (sourceRows ?? []) as Omit<
    ProfileRow,
    'modified_datetime_utc'
  >[]
  if (!rows.length) {
    return {
      ok: false,
      error: `Flavor ${input.sourceFlavorId} has no profiles for these images.`,
    }
  }

  const now = new Date().toISOString()
  const { error: upsertError } = await supabase
    .from('image_reaction_profiles')
    .upsert(
      rows.map((row) => ({
        image_id: row.image_id,
        humor_flavor_id: input.targetFlavorId,
        step_outputs: row.step_outputs ?? {},
        search_card: row.search_card,
        prompt_hash: row.prompt_hash,
        profile_id: user.id,
        modified_datetime_utc: now,
      })),
      { onConflict: 'image_id,humor_flavor_id' }
    )
  if (upsertError) {
    return { ok: false, error: 'Could not save the copied profiles.' }
  }

  return {
    ok: true,
    copiedCount: rows.length,
    missingCount: input.imageIds.length - rows.length,
  }
}

export type StudentBrainContext = {
  topicId: number
  rank: number
  title: string
  summary: string
  primaryEmotion: string
  retrievalScore: number
}

export type LoadStudentBrainContextsResult = {
  ok: boolean
  contexts?: StudentBrainContext[]
  error?: string
}

// Fetch recent contexts from the Student Brain API — the same source the ops
// pipeline's ${studentBrainOutput} resolves to — parsed into individual
// selected_memories entries so the client can list them as pickable moments.
export async function loadStudentBrainContextsAction(input?: {
  topK?: number
}): Promise<LoadStudentBrainContextsResult> {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in.' }
  }

  let raw: string
  try {
    raw = await getStudentBrainOutputText(input?.topK)
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : 'Student Brain retrieval failed.',
    }
  }

  let memories: unknown
  try {
    const parsed = JSON.parse(raw) as {
      result?: { selected_memories?: unknown }
    }
    memories = parsed.result?.selected_memories
  } catch {
    return { ok: false, error: 'Student Brain returned unparsable JSON.' }
  }
  if (!Array.isArray(memories)) {
    return {
      ok: false,
      error: 'Student Brain response had no selected_memories list.',
    }
  }

  const contexts = memories
    .map((m) => {
      const mem = m as Record<string, unknown>
      const summary = String(mem.summary ?? '').trim()
      if (!summary) return null
      return {
        topicId: Number(mem.topic_id ?? 0),
        rank: Number(mem.rank ?? 0),
        title: String(mem.title ?? '').trim(),
        summary,
        primaryEmotion: String(mem.primary_emotion ?? ''),
        retrievalScore: Number(mem.retrieval_score ?? 0),
      }
    })
    .filter((c): c is StudentBrainContext => c !== null)
  return { ok: true, contexts }
}

export type StudyResultInput = {
  imageId: string
  caption: string
  rank: number
  entity: string
  emotionalAlignment: number
}

export type SaveStudyResultsResult = {
  ok: boolean
  savedCount?: number
  error?: string
}

// Persist one moment's ranked results for a study: a captions row per
// image+caption pair (so the existing captions surfaces can show and rate
// them), plus an llm_model_responses row per pair recording WHICH moment
// produced it — captions have no moment column, so this is the moment ↔
// caption mapping for analysis (llm_user_prompt = the moment,
// llm_model_response = the full result JSON). Unlike saveOneOutputAction this
// never deletes prior rows: the same image may win for many moments.
export async function saveStudyResultsAction(input: {
  flavorId: number
  rankStepId: number
  moment: string
  results: StudyResultInput[]
}): Promise<SaveStudyResultsResult> {
  const moment = input.moment.trim()
  if (!moment) return { ok: false, error: 'Missing the moment text.' }
  if (!input.results.length) return { ok: false, error: 'No results to save.' }

  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to save.' }
  }

  // The ranking step supplies the model id recorded on the provenance rows.
  const { data: step, error: stepError } = await supabase
    .from('humor_flavor_steps')
    .select('id, llm_model_id')
    .eq('id', input.rankStepId)
    .eq('humor_flavor_id', input.flavorId)
    .maybeSingle()
  if (stepError || !step) {
    return { ok: false, error: 'Could not load the ranking step.' }
  }

  const captionRequestByImage = new Map<string, number>()
  const getCaptionRequestId = async (imageId: string): Promise<number | null> => {
    const cached = captionRequestByImage.get(imageId)
    if (cached != null) return cached
    const { data: existing } = await supabase
      .from('caption_requests')
      .select('id')
      .eq('image_id', imageId)
      .eq('profile_id', user.id)
      .limit(1)
    let id = existing?.[0]?.id as number | undefined
    if (id == null) {
      const { data: created, error } = await supabase
        .from('caption_requests')
        .insert({ image_id: imageId, profile_id: user.id })
        .select('id')
        .single()
      if (error || !created) return null
      id = created.id
    }
    captionRequestByImage.set(imageId, id)
    return id
  }

  let savedCount = 0
  for (const result of input.results) {
    const captionRequestId = await getCaptionRequestId(result.imageId)
    if (captionRequestId == null) continue

    const { error: captionError } = await supabase.from('captions').insert({
      content: result.caption,
      image_id: result.imageId,
      humor_flavor_id: input.flavorId,
      caption_request_id: captionRequestId,
      profile_id: user.id,
      is_public: false,
    })
    if (captionError) continue

    await supabase.from('llm_model_responses').insert({
      caption_request_id: captionRequestId,
      humor_flavor_id: input.flavorId,
      humor_flavor_step_id: step.id,
      llm_model_id: step.llm_model_id,
      llm_system_prompt: 'reverse-study-result',
      llm_user_prompt: moment,
      llm_model_response: JSON.stringify({
        moment,
        caption: result.caption,
        rank: result.rank,
        entity: result.entity,
        emotional_alignment: result.emotionalAlignment,
      }),
      llm_temperature: null,
      processing_time_seconds: 0,
      profile_id: user.id,
    })
    savedCount += 1
  }

  if (!savedCount) {
    return { ok: false, error: 'No results could be saved.' }
  }
  return { ok: true, savedCount }
}
