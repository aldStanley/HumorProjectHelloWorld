'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/utils/supabase/server'

export type UpdateStepPromptsResult = { ok: boolean; error?: string }

// Focused save used by the meme page's prompt editors: update just one step's
// prompt text. Self-contained so the page works on branches that predate the
// ops page's updateStepPromptsAction.
export async function updateMemeStepPromptsAction(input: {
  stepId: number
  flavorId: number
  systemPrompt?: string
  userPrompt?: string
}): Promise<UpdateStepPromptsResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return { ok: false, error: 'You must be signed in to save a prompt.' }
  }

  const patch: Record<string, unknown> = { modified_by_user_id: user.id }
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

  revalidatePath(`/humor-flavor/${input.flavorId}/meme`)
  revalidatePath(`/humor-flavor/${input.flavorId}`)
  return { ok: true }
}
