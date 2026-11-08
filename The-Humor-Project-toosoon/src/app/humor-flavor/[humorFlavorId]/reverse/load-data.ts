import { createClient } from '@/utils/supabase/server'

import type { ReverseProfile } from './actions'
import type {
  ReverseCommunityContext,
  ReverseImage,
  ReverseImageSet,
  ReverseStep,
} from './reverse-client'

// Shared server-side loader for the reverse surfaces (/reverse and /ops-reverse):
// flavor, steps (with is_hidden), image sets, community contexts, and the
// cached reaction profiles. Auth is the caller's concern.

type StepRow = {
  id: number
  order_by: number
  description: string | null
  llm_system_prompt: string | null
  llm_user_prompt: string | null
  llm_temperature: number | null
  llm_input_type_id: number | null
  llm_model_id: number | null
  is_hidden: boolean | null
}

type ModelRow = {
  id: number
  provider_model_id: string
  is_temperature_supported: boolean
}

type ImageRel =
  | {
      id: string
      url: string | null
      additional_context: string | null
      celebrity_recognition: string | null
    }
  | {
      id: string
      url: string | null
      additional_context: string | null
      celebrity_recognition: string | null
    }[]
  | null

type MappingRow = { study_image_set_id: number; image: ImageRel }

type ProfileRow = {
  image_id: string
  step_outputs: Record<string, string> | null
  search_card: unknown
  prompt_hash: string
  modified_datetime_utc: string | null
}

const firstOf = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? value[0] ?? null : value

// The image set selected when the URL has no ?set= param.
export const DEFAULT_IMAGE_SET_ID = 69

export type ReverseData = {
  flavor: { id: number; slug: string }
  steps: ReverseStep[]
  imageSets: ReverseImageSet[]
  initialSetId: number | null
  contexts: ReverseCommunityContext[]
  profiles: ReverseProfile[]
  profilesTableMissing: boolean
}

export async function loadReverseData(
  flavorId: number,
  set?: string
): Promise<ReverseData | null> {
  const supabase = await createClient({ readOnly: true })

  const { data: flavor, error: flavorError } = await supabase
    .from('humor_flavors')
    .select('id, slug')
    .eq('id', flavorId)
    .maybeSingle()
  if (flavorError || !flavor) return null

  const { data: stepRows } = await supabase
    .from('humor_flavor_steps')
    .select(
      'id, order_by, description, llm_system_prompt, llm_user_prompt, llm_temperature, llm_input_type_id, llm_model_id, is_hidden'
    )
    .eq('humor_flavor_id', flavor.id)
    .order('order_by', { ascending: true })

  const { data: modelRows } = await supabase
    .from('llm_models')
    .select('id, provider_model_id, is_temperature_supported')

  const modelsById = new Map<number, ModelRow>()
  ;((modelRows ?? []) as ModelRow[]).forEach((m) => modelsById.set(m.id, m))

  const steps: ReverseStep[] = ((stepRows ?? []) as StepRow[]).map((s) => {
    const model = s.llm_model_id ? modelsById.get(s.llm_model_id) : null
    return {
      id: s.id,
      orderBy: s.order_by,
      description: s.description ?? '',
      systemPrompt: s.llm_system_prompt ?? '',
      userPrompt: s.llm_user_prompt ?? '',
      providerModelId: model?.provider_model_id ?? '',
      isTemperatureSupported: model?.is_temperature_supported ?? false,
      temperature: s.llm_temperature,
      includeImage: s.llm_input_type_id === 1,
      isHidden: s.is_hidden ?? false,
    }
  })

  // Image sets (same source as the ops page).
  const { data: imageSetRows } = await supabase
    .from('study_image_sets')
    .select('id, slug')
    .order('slug', { ascending: true })

  const imageSetMeta = (imageSetRows ?? []) as { id: number; slug: string }[]
  const imagesBySet = new Map<number, ReverseImage[]>()
  if (imageSetMeta.length) {
    const { data: mappingRows } = await supabase
      .from('study_image_set_image_mappings')
      .select(
        'study_image_set_id, image:images ( id, url, additional_context, celebrity_recognition )'
      )
      .in(
        'study_image_set_id',
        imageSetMeta.map((s) => s.id)
      )
      .order('id', { ascending: true })

    ;((mappingRows ?? []) as MappingRow[]).forEach((mapping) => {
      const image = firstOf(mapping.image)
      if (!image?.url) return
      const list = imagesBySet.get(mapping.study_image_set_id) ?? []
      list.push({
        id: image.id,
        url: image.url,
        additionalContext: image.additional_context,
        celebrityRecognition: image.celebrity_recognition,
      })
      imagesBySet.set(mapping.study_image_set_id, list)
    })
  }

  const imageSets: ReverseImageSet[] = imageSetMeta
    .map((s) => ({
      id: s.id,
      slug: s.slug,
      images: imagesBySet.get(s.id) ?? [],
    }))
    .filter((s) => s.images.length > 0)

  // ?set= wins; otherwise the pinned default; otherwise the client falls
  // back to the first set in the list.
  const requestedSetId = Number.parseInt(set ?? '', 10)
  const initialSetId =
    imageSets.find((s) => s.id === requestedSetId)?.id ??
    imageSets.find((s) => s.id === DEFAULT_IMAGE_SET_ID)?.id ??
    null

  // The community-context corpus, for the moment picker.
  const { data: contextRows } = await supabase
    .from('community_contexts')
    .select('id, content')
    .order('id', { ascending: true })
  const contexts: ReverseCommunityContext[] = (
    (contextRows ?? []) as { id: number; content: string | null }[]
  )
    .filter((c) => (c.content ?? '').trim().length > 0)
    .map((c) => ({ id: c.id, content: (c.content ?? '').trim() }))

  // Cached profiles for this flavor. A missing table is expected until the
  // migration has been run — the clients show how to fix it.
  const { data: profileRows, error: profilesError } = await supabase
    .from('image_reaction_profiles')
    .select('image_id, step_outputs, search_card, prompt_hash, modified_datetime_utc')
    .eq('humor_flavor_id', flavor.id)
  const profilesTableMissing = Boolean(profilesError)
  const profiles: ReverseProfile[] = ((profileRows ?? []) as ProfileRow[]).map(
    (row) => ({
      imageId: row.image_id,
      stepOutputs: row.step_outputs ?? {},
      searchCard: row.search_card,
      promptHash: row.prompt_hash,
      modifiedAt: row.modified_datetime_utc,
    })
  )

  return {
    flavor,
    steps,
    imageSets,
    initialSetId,
    contexts,
    profiles,
    profilesTableMissing,
  }
}
