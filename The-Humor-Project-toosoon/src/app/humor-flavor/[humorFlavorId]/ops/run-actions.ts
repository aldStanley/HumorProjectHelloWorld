'use server'

// Server actions that archive an ops batch run (see
// supabase/migrations/20260731000000_ops_runs.sql). The run itself executes in
// the browser — the same per-step runStepAction the single-image ops page uses
// — and calls these to persist as it goes, so a run that dies halfway still
// leaves every finished image on the record.
import { createClient } from '@/utils/supabase/server'

const MISSING_TABLE_HINT =
  'The ops_runs tables do not exist yet — run ' +
  'supabase/migrations/20260731000000_ops_runs.sql in the Supabase SQL ' +
  'editor, then reload.'

// Only these mean "the table isn't there". Matching on the table name in the
// message would also swallow RLS denials and foreign-key violations — which
// mention the table too — and report them as a missing migration.
const isMissingTable = (error: {
  code?: string
  message?: string
}): boolean =>
  error.code === '42P01' ||
  error.code === 'PGRST205' ||
  /could not find the table/i.test(error.message ?? '')

const failure = (
  error: { code?: string; message?: string; details?: string },
  fallback: string
) => ({
  ok: false as const,
  error: isMissingTable(error)
    ? MISSING_TABLE_HINT
    : // Carry the code and details through: everything else is a real database
      // error and the exact text is what makes it diagnosable.
      `${fallback} ${error.message ?? ''}${error.code ? ` [${error.code}]` : ''}${
        error.details ? ` — ${error.details}` : ''
      }`.trim(),
  missingTable: isMissingTable(error),
})

export type OpsRunStepRecord = {
  opKey: string
  opTitle?: string | null
  position: number
  branchIndex?: number | null
  branchLabel?: string | null
  humorFlavorStepId?: number | null
  stepOrderBy?: number | null
  providerModelId?: string | null
  temperature?: number | null
  includeImage?: boolean | null
  systemPrompt?: string | null
  userPrompt?: string | null
  priorOutputs?: Record<string, unknown> | null
  output?: string | null
  error?: string | null
  durationMs?: number | null
}

// One flat shape rather than a discriminated union: this project compiles with
// strict: false, where narrowing on an `ok: true | false` discriminant doesn't
// apply, so callers would still see the union in the error branch.
export type CreateRunResult = {
  ok: boolean
  runId?: string
  error?: string
  missingTable?: boolean
}

export async function createOpsRunAction(input: {
  flavorId: number
  flavorSlug: string
  setId: number | null
  setSlug: string | null
  label: string | null
  imageCount: number
  // Pipeline snapshot (ops + prompt templates + bindings + pinned + hidden).
  spec: unknown
}): Promise<CreateRunResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to run a batch.', missingTable: false }
  }

  const { data, error } = await supabase
    .from('ops_runs')
    .insert({
      humor_flavor_id: input.flavorId,
      flavor_slug: input.flavorSlug,
      study_image_set_id: input.setId,
      study_image_set_slug: input.setSlug,
      label: input.label,
      status: 'running',
      image_count: input.imageCount,
      spec: input.spec ?? {},
      profile_id: user.id,
    })
    .select('id')
    .single()
  if (error || !data) {
    return failure(error ?? { message: '' }, 'Could not create the run.')
  }
  return { ok: true, runId: data.id as string }
}

export type StartRunImageResult = {
  ok: boolean
  runImageId?: string
  error?: string
  missingTable?: boolean
}

// imageId/imageUrl are null for reverse runs: there the archived unit is a
// MOMENT, not an image — the moment text lives in outputs.momentInput.
export async function startOpsRunImageAction(input: {
  runId: string
  imageId: string | null
  imageUrl: string | null
  position: number
}): Promise<StartRunImageResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in.', missingTable: false }
  }

  const { data, error } = await supabase
    .from('ops_run_images')
    .insert({
      ops_run_id: input.runId,
      image_id: input.imageId,
      image_url: input.imageUrl,
      position: input.position,
      status: 'running',
    })
    .select('id')
    .single()
  if (error || !data) {
    return failure(error ?? { message: '' }, 'Could not start the image run.')
  }
  return { ok: true, runImageId: data.id as string }
}

export type SimpleResult = { ok: boolean; error?: string }

// Steps are flushed in chunks while an image runs, so a long run doesn't hold
// everything in one oversized final request.
export async function saveOpsRunStepsAction(input: {
  runId: string
  runImageId: string
  steps: OpsRunStepRecord[]
}): Promise<SimpleResult> {
  if (!input.steps.length) return { ok: true }
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'You must be signed in.' }

  const { error } = await supabase.from('ops_run_steps').insert(
    input.steps.map((s) => ({
      ops_run_id: input.runId,
      ops_run_image_id: input.runImageId,
      op_key: s.opKey,
      op_title: s.opTitle ?? null,
      position: s.position,
      branch_index: s.branchIndex ?? null,
      branch_label: s.branchLabel ?? null,
      humor_flavor_step_id: s.humorFlavorStepId ?? null,
      step_order_by: s.stepOrderBy ?? null,
      provider_model_id: s.providerModelId ?? null,
      llm_temperature: s.temperature ?? null,
      include_image: s.includeImage ?? null,
      system_prompt: s.systemPrompt ?? null,
      user_prompt: s.userPrompt ?? null,
      prior_outputs: s.priorOutputs ?? null,
      output: s.output ?? null,
      error: s.error ?? null,
      duration_ms: s.durationMs ?? null,
    }))
  )
  if (error) return failure(error, 'Could not save the run steps.')
  return { ok: true }
}

export async function finishOpsRunImageAction(input: {
  runImageId: string
  status: 'done' | 'error'
  error?: string | null
  outputs: Record<string, unknown>
  finalOutput?: string | null
  captions?: string[] | null
  // Reverse runs discover their image at the END (the top-ranked pick), so the
  // row's image is settable here too. Omitted = untouched.
  imageId?: string | null
  imageUrl?: string | null
}): Promise<SimpleResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'You must be signed in.' }

  const { error } = await supabase
    .from('ops_run_images')
    .update({
      status: input.status,
      error: input.error ?? null,
      outputs: input.outputs ?? {},
      final_output: input.finalOutput ?? null,
      captions: input.captions ?? null,
      ...(input.imageId !== undefined ? { image_id: input.imageId } : {}),
      ...(input.imageUrl !== undefined ? { image_url: input.imageUrl } : {}),
      finished_datetime_utc: new Date().toISOString(),
    })
    .eq('id', input.runImageId)
  if (error) return failure(error, 'Could not finish the image run.')
  return { ok: true }
}

export async function finishOpsRunAction(input: {
  runId: string
  status: 'done' | 'error' | 'canceled'
  exportJson: unknown
  exportWarning: string | null
  captionCount: number
}): Promise<SimpleResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'You must be signed in.' }

  const { error } = await supabase
    .from('ops_runs')
    .update({
      status: input.status,
      export_json: input.exportJson ?? null,
      export_warning: input.exportWarning,
      caption_count: input.captionCount,
      finished_datetime_utc: new Date().toISOString(),
    })
    .eq('id', input.runId)
  if (error) return failure(error, 'Could not finish the run.')
  return { ok: true }
}

// Runs execute in the browser, so a closed tab leaves the row stuck at
// 'running' forever — nothing is actually running. This lets anyone mark such
// a row canceled. Guarded to running rows so a finished run can't be clobbered.
export async function cancelOpsRunAction(input: {
  runId: string
}): Promise<SimpleResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'You must be signed in.' }

  const { error } = await supabase
    .from('ops_runs')
    .update({ status: 'canceled', finished_datetime_utc: new Date().toISOString() })
    .eq('id', input.runId)
    .eq('status', 'running')
  if (error) return failure(error, 'Could not cancel the run.')
  return { ok: true }
}

export async function deleteOpsRunAction(input: {
  runId: string
}): Promise<SimpleResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'You must be signed in.' }

  const { error } = await supabase.from('ops_runs').delete().eq('id', input.runId)
  if (error) return failure(error, 'Could not delete the run.')
  return { ok: true }
}
