import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import MemeClient, {
  type MemeImage,
  type MemeImageSet,
  type MemeStep,
} from './meme-client'

type StepTypeRel = { slug: string } | { slug: string }[] | null

type StepRow = {
  id: number
  order_by: number
  description: string | null
  llm_system_prompt: string | null
  llm_user_prompt: string | null
  llm_temperature: number | null
  llm_input_type_id: number | null
  llm_model_id: number | null
  step_type: StepTypeRel
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
      image_description: string | null
      celebrity_recognition: string | null
    }
  | {
      id: string
      url: string | null
      additional_context: string | null
      image_description: string | null
      celebrity_recognition: string | null
    }[]
  | null

type MappingRow = { study_image_set_id: number; image: ImageRel }

const firstOf = <T,>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? value[0] ?? null : value

export const generateMetadata = flavorPageMetadata('meme')

export default async function HumorFlavorMemePage({
  params,
}: {
  params: Promise<{ humorFlavorId: string }>
}) {
  const { humorFlavorId } = await params
  const flavorId = Number.parseInt(humorFlavorId, 10)
  if (!Number.isFinite(flavorId)) {
    notFound()
  }

  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  const { data: flavor, error: flavorError } = await supabase
    .from('humor_flavors')
    .select('id, slug')
    .eq('id', flavorId)
    .maybeSingle()
  if (flavorError || !flavor) {
    notFound()
  }

  const { data: stepRows } = await supabase
    .from('humor_flavor_steps')
    .select(
      'id, order_by, description, llm_system_prompt, llm_user_prompt, llm_temperature, llm_input_type_id, llm_model_id, step_type:humor_flavor_step_types ( slug )'
    )
    .eq('humor_flavor_id', flavor.id)
    .order('order_by', { ascending: true })

  const { data: modelRows } = await supabase
    .from('llm_models')
    .select('id, provider_model_id, is_temperature_supported')

  const modelsById = new Map<number, ModelRow>()
  ;((modelRows ?? []) as ModelRow[]).forEach((m) => modelsById.set(m.id, m))

  const steps: MemeStep[] = ((stepRows ?? []) as StepRow[]).map((s) => {
    const model = s.llm_model_id ? modelsById.get(s.llm_model_id) : null
    return {
      id: s.id,
      orderBy: s.order_by,
      description: s.description ?? '',
      stepTypeSlug: firstOf(s.step_type)?.slug ?? null,
      systemPrompt: s.llm_system_prompt ?? '',
      userPrompt: s.llm_user_prompt ?? '',
      providerModelId: model?.provider_model_id ?? '',
      isTemperatureSupported: model?.is_temperature_supported ?? false,
      temperature: s.llm_temperature,
      includeImage: s.llm_input_type_id === 1,
    }
  })

  // Image sets (same source as the ops and reverse pages).
  const { data: imageSetRows } = await supabase
    .from('study_image_sets')
    .select('id, slug')
    .order('slug', { ascending: true })

  const imageSetMeta = (imageSetRows ?? []) as { id: number; slug: string }[]
  const imagesBySet = new Map<number, MemeImage[]>()
  if (imageSetMeta.length) {
    const { data: mappingRows } = await supabase
      .from('study_image_set_image_mappings')
      .select(
        'study_image_set_id, image:images ( id, url, additional_context, image_description, celebrity_recognition )'
      )
      .in(
        'study_image_set_id',
        imageSetMeta.map((set) => set.id)
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
        imageDescription: image.image_description,
        celebrityRecognition: image.celebrity_recognition,
      })
      imagesBySet.set(mapping.study_image_set_id, list)
    })
  }

  const imageSets: MemeImageSet[] = imageSetMeta
    .map((set) => ({
      id: set.id,
      slug: set.slug,
      images: imagesBySet.get(set.id) ?? [],
    }))
    .filter((set) => set.images.length > 0)

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex w-full flex-1 flex-col px-6 py-12">
        <div className="max-w-3xl space-y-3">
          <Link
            href={`/humor-flavor/${flavor.id}`}
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
          >
            Back to flavor
          </Link>
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
            Meme (image → captions) · Flavor #{flavor.id}
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
              {flavor.slug}
            </span>
          </h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            The forward pipeline: pick reaction images and run every step of
            this flavor on each one — recognize what&rsquo;s in the image, read
            its emotional tone, map it to a community moment, and write
            captions. The finished memes collect below.
          </p>
        </div>

        <div className="mt-8">
          <MemeClient flavorId={flavor.id} steps={steps} imageSets={imageSets} />
        </div>
      </div>
    </main>
  )
}
