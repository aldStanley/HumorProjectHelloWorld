import { createClient } from '@/utils/supabase/server'

import type { PovStep } from './pov-jokes-client'

// Server-side loader for the POV Joke Maker (/pov-jokes). The surface needs
// nothing but the flavor and its two steps: there is no image set, no image
// catalog, and no cached preprocessing — the only input is a moment.

type StepRow = {
  id: number
  order_by: number
  description: string | null
  llm_system_prompt: string | null
  llm_user_prompt: string | null
  llm_temperature: number | null
  llm_model_id: number | null
}

type ModelRow = {
  id: number
  name: string
  provider_model_id: string
  is_temperature_supported: boolean
}

export type PovJokesData = {
  flavor: { id: number; slug: string; description: string }
  steps: PovStep[]
}

export async function loadPovJokesData(
  flavorId: number
): Promise<PovJokesData | null> {
  const supabase = await createClient({ readOnly: true })

  const { data: flavor, error: flavorError } = await supabase
    .from('humor_flavors')
    .select('id, slug, description')
    .eq('id', flavorId)
    .maybeSingle()
  if (flavorError || !flavor) return null

  const { data: stepRows } = await supabase
    .from('humor_flavor_steps')
    .select(
      'id, order_by, description, llm_system_prompt, llm_user_prompt, llm_temperature, llm_model_id'
    )
    .eq('humor_flavor_id', flavor.id)
    .order('order_by', { ascending: true })

  const { data: modelRows } = await supabase
    .from('llm_models')
    .select('id, name, provider_model_id, is_temperature_supported')
  const modelsById = new Map<number, ModelRow>()
  ;((modelRows ?? []) as ModelRow[]).forEach((m) => modelsById.set(m.id, m))

  const steps: PovStep[] = ((stepRows ?? []) as StepRow[]).map((s) => {
    const model = s.llm_model_id ? modelsById.get(s.llm_model_id) : null
    return {
      id: s.id,
      orderBy: s.order_by,
      description: s.description ?? '',
      systemPrompt: s.llm_system_prompt ?? '',
      userPrompt: s.llm_user_prompt ?? '',
      modelName: model?.name ?? 'no model set',
      providerModelId: model?.provider_model_id ?? '',
      isTemperatureSupported: model?.is_temperature_supported ?? false,
      temperature: s.llm_temperature,
    }
  })

  return {
    flavor: {
      id: flavor.id,
      slug: flavor.slug,
      description: flavor.description ?? '',
    },
    steps,
  }
}
