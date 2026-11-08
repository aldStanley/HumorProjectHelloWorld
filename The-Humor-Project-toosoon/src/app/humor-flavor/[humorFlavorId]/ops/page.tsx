import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import type { FlavorNote } from '../actions'
import FlavorHeart from '../flavor-heart'
import FlavorNotes from '../flavor-notes'

import OpsClient, {
  type OpsImage,
  type OpsImageSet,
  type OpsStep,
} from './ops-client'

type StepRow = {
  id: number
  order_by: number
  description: string | null
  llm_system_prompt: string | null
  llm_user_prompt: string | null
  llm_temperature: number | null
  llm_input_type_id: number | null
  llm_model_id: number | null
  is_hidden?: boolean | null
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

// Normal-case pill links for the page-top nav — no uppercase, no letterspacing.
const navLink =
  'inline-flex items-center gap-1.5 rounded-lg border border-[rgb(var(--gloss)/0.6)] px-3 py-1.5 text-sm font-medium transition hover:border-[rgb(var(--primary))] hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.2)]'

export const generateMetadata = flavorPageMetadata('ops')

export default async function HumorFlavorOpsPage({
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

  // The current user's heart for this flavor (shared with the flavor page).
  const { data: favoriteRow } = await supabase
    .from('humor_flavor_favorites')
    .select('is_favorite')
    .eq('flavor_id', flavor.id)
    .eq('profile_id', user.id)
    .maybeSingle()

  // Append-only notes log (missing-table safe: falls back to an empty log).
  const { data: noteRows } = await supabase
    .from('humor_flavor_notes')
    .select('id, body, created_datetime_utc')
    .eq('flavor_id', flavor.id)
    .order('created_datetime_utc', { ascending: false })
  const notes: FlavorNote[] = (
    (noteRows ?? []) as { id: number; body: string; created_datetime_utc: string }[]
  ).map((n) => ({ id: n.id, body: n.body, createdAt: n.created_datetime_utc }))

  const stepColumns =
    'id, order_by, description, llm_system_prompt, llm_user_prompt, llm_temperature, llm_input_type_id, llm_model_id'
  let stepRows = (
    await supabase
      .from('humor_flavor_steps')
      .select(`${stepColumns}, is_hidden`)
      .eq('humor_flavor_id', flavor.id)
      .order('order_by', { ascending: true })
  ).data as StepRow[] | null
  if (!stepRows) {
    // is_hidden migration not applied yet — fall back to the legacy columns.
    stepRows = (
      await supabase
        .from('humor_flavor_steps')
        .select(stepColumns)
        .eq('humor_flavor_id', flavor.id)
        .order('order_by', { ascending: true })
    ).data as StepRow[] | null
  }

  const { data: modelRows } = await supabase
    .from('llm_models')
    .select('id, name, provider_model_id, is_temperature_supported').order('name')

  const modelsById = new Map<number, ModelRow>()
  ;((modelRows ?? []) as ModelRow[]).forEach((m) => modelsById.set(m.id, m))

  const steps: OpsStep[] = ((stepRows ?? []) as StepRow[]).map((s) => {
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

  // Image sets (same source as the Test / Chiltrix pages).
  const { data: imageSetRows } = await supabase
    .from('study_image_sets')
    .select('id, slug')
    .order('slug', { ascending: true })

  const imageSetMeta = (imageSetRows ?? []) as { id: number; slug: string }[]
  const imagesBySet = new Map<number, OpsImage[]>()
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

  const imageSets: OpsImageSet[] = imageSetMeta
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
        {/* Header + notes log side by side (stacked on narrow screens). */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="max-w-3xl flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/humor-flavor/${flavor.id}`} className={navLink}>
                ← Back to flavor
              </Link>
              {/* Every saved batch run of this pipeline, and its results. */}
              <Link href={`/humor-flavor/${flavor.id}/ops/runs`} className={navLink}>
                🗂 Saved runs &amp; results
              </Link>
            </div>
            <p className="text-sm font-medium text-[rgb(var(--muted))]">
              Flavor Maker · typed · composable
            </p>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-semibold sm:text-4xl">
                <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
                  {flavor.slug}
                </span>
              </h1>
              <FlavorHeart
                flavorId={flavor.id}
                flavorSlug={flavor.slug}
                initialIsFavorite={favoriteRow?.is_favorite ?? false}
              />
            </div>
            <p className="text-sm text-[rgb(var(--muted))]">
              A first slice of the dataflow model: each step is a typed
              operation with described inputs &amp; outputs. Inputs are{' '}
              <strong>bound</strong> to a source (an upstream operation&rsquo;s
              output or a built-in image field) — not a step number — so
              operations become portable and the wiring forms a DAG.
            </p>
          </div>

          <div className="w-full lg:max-w-xl lg:flex-1">
            <FlavorNotes flavorId={flavor.id} initialNotes={notes} />
          </div>
        </div>

        <div className="mt-8">
          <OpsClient
            flavorId={flavor.id}
            flavorSlug={flavor.slug}
            userId={user.id}
            models={modelRows ?? []}
            steps={steps}
            imageSets={imageSets}
          />
        </div>
      </div>
    </main>
  )
}
