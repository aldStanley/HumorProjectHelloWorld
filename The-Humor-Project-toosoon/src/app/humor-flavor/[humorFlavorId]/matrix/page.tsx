import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import MatrixClient, {
  type MatrixImage,
  type MatrixImageSet,
  type MatrixOptions,
  type MatrixSavedOutput,
  type MatrixStep,
} from './matrix-client'

type StepTypeRel = { slug: string } | { slug: string }[] | null

type StepRow = {
  id: number
  order_by: number
  description: string | null
  llm_system_prompt: string | null
  llm_user_prompt: string | null
  llm_temperature: number | null
  llm_input_type_id: number | null
  llm_output_type_id: number | null
  llm_model_id: number | null
  humor_flavor_step_type_id: number | null
  step_type: StepTypeRel
}

type ModelRow = {
  id: number
  name: string
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

const prefillSourceFor = (
  slug: string | null
): MatrixStep['prefillSource'] => {
  if (slug === 'celebrity-recognition') return 'celebrity-recognition'
  if (slug === 'image-description') return 'image-description'
  return null
}

export const generateMetadata = flavorPageMetadata('matrix')

export default async function HumorFlavorMatrixPage({
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
    .select('id, slug, description')
    .eq('id', flavorId)
    .maybeSingle()
  if (flavorError || !flavor) {
    notFound()
  }

  const { data: stepRows } = await supabase
    .from('humor_flavor_steps')
    .select(
      'id, order_by, description, llm_system_prompt, llm_user_prompt, llm_temperature, llm_input_type_id, llm_output_type_id, llm_model_id, humor_flavor_step_type_id, step_type:humor_flavor_step_types ( slug )'
    )
    .eq('humor_flavor_id', flavor.id)
    .order('order_by', { ascending: true })

  const steps = (stepRows ?? []) as StepRow[]

  // Option lists used by the matrix to render selects and to add new steps.
  const [modelRowsRes, stepTypesRes, inputTypesRes, outputTypesRes] =
    await Promise.all([
      supabase
        .from('llm_models')
        .select('id, name, provider_model_id, is_temperature_supported')
        .order('id', { ascending: true }),
      supabase
        .from('humor_flavor_step_types')
        .select('id, slug')
        .order('id', { ascending: true }),
      supabase
        .from('llm_input_types')
        .select('id, slug')
        .order('id', { ascending: true }),
      supabase
        .from('llm_output_types')
        .select('id, slug')
        .order('id', { ascending: true }),
    ])

  const modelsById = new Map<number, ModelRow>()
  ;((modelRowsRes.data ?? []) as ModelRow[]).forEach((m) =>
    modelsById.set(m.id, m)
  )

  const options: MatrixOptions = {
    models: ((modelRowsRes.data ?? []) as ModelRow[])
      .filter((m) => m.provider_model_id?.trim())
      .map((m) => ({
        id: m.id,
        name: m.name,
        providerModelId: m.provider_model_id,
        isTemperatureSupported: m.is_temperature_supported,
      })),
    stepTypes: ((stepTypesRes.data ?? []) as { id: number; slug: string }[]).map(
      (t) => ({ id: t.id, slug: t.slug })
    ),
    inputTypes: (
      (inputTypesRes.data ?? []) as { id: number; slug: string }[]
    ).map((t) => ({ id: t.id, slug: t.slug })),
    outputTypes: (
      (outputTypesRes.data ?? []) as { id: number; slug: string }[]
    ).map((t) => ({ id: t.id, slug: t.slug })),
  }

  const matrixSteps: MatrixStep[] = steps.map((step, index) => {
    const slug = firstOf(step.step_type)?.slug ?? null
    const model = step.llm_model_id ? modelsById.get(step.llm_model_id) : null
    return {
      id: step.id,
      stepNumber: index + 1,
      orderBy: step.order_by,
      stepTypeId: step.humor_flavor_step_type_id ?? options.stepTypes[0]?.id ?? 0,
      stepTypeSlug: slug,
      description: step.description ?? '',
      inputTypeId: step.llm_input_type_id ?? 2,
      outputTypeId: step.llm_output_type_id ?? 1,
      modelId: step.llm_model_id ?? 0,
      systemPrompt: step.llm_system_prompt ?? '',
      userPrompt: step.llm_user_prompt ?? '',
      temperature: step.llm_temperature,
      includeImage: step.llm_input_type_id === 1,
      modelName: model?.name ?? 'Unknown model',
      providerModelId: model?.provider_model_id ?? '',
      isTemperatureSupported: model?.is_temperature_supported ?? false,
      prefillSource: prefillSourceFor(slug),
    }
  })

  // Image sets (same source as the Test page) with the cached per-image fields.
  const { data: imageSetRows } = await supabase
    .from('study_image_sets')
    .select('id, slug, description')
    .order('slug', { ascending: true })

  const imageSetMeta = (imageSetRows ?? []) as {
    id: number
    slug: string
    description: string | null
  }[]

  const imagesBySet = new Map<number, MatrixImage[]>()
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

  const imageSets: MatrixImageSet[] = imageSetMeta
    .map((set) => ({
      id: set.id,
      slug: set.slug,
      description: set.description,
      images: imagesBySet.get(set.id) ?? [],
    }))
    .filter((set) => set.images.length > 0)

  // Latest saved generation per (step, image) for this flavor. Rows are ordered
  // newest-first, so the first one seen for a key is the latest.
  type ResponseRow = {
    humor_flavor_step_id: number | null
    llm_model_response: string | null
    caption_request:
      | { image_id: string }
      | { image_id: string }[]
      | null
  }
  const { data: responseRows } = await supabase
    .from('llm_model_responses')
    .select(
      'humor_flavor_step_id, llm_model_response, created_datetime_utc, caption_request:caption_requests ( image_id )'
    )
    .eq('humor_flavor_id', flavor.id)
    .order('created_datetime_utc', { ascending: false })

  const seenOutputKeys = new Set<string>()
  const savedOutputs: MatrixSavedOutput[] = []
  ;((responseRows ?? []) as ResponseRow[]).forEach((row) => {
    const stepId = row.humor_flavor_step_id
    const imageId = firstOf(row.caption_request)?.image_id
    const output = row.llm_model_response
    if (stepId == null || !imageId || output == null) return
    const key = `${stepId}:${imageId}`
    if (seenOutputKeys.has(key)) return
    seenOutputKeys.add(key)
    savedOutputs.push({ stepId, imageId, output })
  })

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.5),transparent_48%),radial-gradient(circle_at_82%_8%,rgb(var(--ambient-spot-2)/0.32),transparent_42%),radial-gradient(circle_at_30%_85%,rgb(var(--ambient-spot-3)/0.38),transparent_55%),linear-gradient(130deg,rgb(var(--ambient-base-1)/1),rgb(var(--ambient-base-2)/0.7),rgb(var(--ambient-base-3)/0.45))] dark:bg-[linear-gradient(140deg,rgb(var(--ambient-base-1)/0.98),rgb(var(--ambient-base-2)/0.98),rgb(var(--ambient-base-3)/0.99))]" />

      <AppHeader />

      <div className="flex w-full flex-1 flex-col justify-start px-6 py-12">
        <div className="flex w-full flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl space-y-3">
            <Link
              href={`/humor-flavor/${flavor.id}`}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
            >
              Back to flavor
            </Link>
            <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
              Matrix
            </p>
            <h1 className="text-3xl font-semibold sm:text-4xl">
              <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
                {flavor.slug}
              </span>
            </h1>
            <p className="text-sm text-[rgb(var(--muted))]">
              Pick images, then run each pipeline step to see its value per image.
            </p>
          </div>
        </div>

        <div className="mt-8">
          <MatrixClient
            flavorId={flavor.id}
            flavorSlug={flavor.slug}
            steps={matrixSteps}
            imageSets={imageSets}
            options={options}
            savedOutputs={savedOutputs}
          />
        </div>
      </div>
    </main>
  )
}
