import { pageMetadata } from '@/utils/page-metadata'
import { redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import type { OpsImage, OpsImageSet, OpsStep } from '../humor-flavor/[humorFlavorId]/ops/ops-client'

import DailyJokesClient, {
  type CardFlavor,
  type StudyStat,
} from './daily-client'

// ---------------------------------------------------------------------------
// THE GOOD FLAVORS. This list is the whole point of the page — edit it here.
// Forward flavors run end-to-end on this page; reverse flavors need a moment
// as input, so their cards link to their own /reverse surface instead.
// ---------------------------------------------------------------------------
const GOOD_FLAVORS: { id: number; kind: 'forward' | 'reverse'; why: string }[] = [
  {
    id: 1517,
    kind: 'forward',
    why: 'Reaction pipeline — speaker selection + the ≥0.8 emotional-alignment gate.',
  },
  {
    id: 1528,
    kind: 'forward',
    why: 'Multi-person scene pipeline — physical-analog casting.',
  },
  {
    id: 1545,
    kind: 'forward',
    why: 'Sad-girl v3 — working copy; weakest-link scoring + who-pays.',
  },
  {
    id: 1540,
    kind: 'reverse',
    why: 'Reverse of 1517: one moment in → ranked reaction images + captions.',
  },
  {
    id: 1541,
    kind: 'reverse',
    why: 'Reverse of 1528: one moment in → ranked multi-party scenes + captions.',
  },
]

type StepRow = {
  id: number
  humor_flavor_id: number
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

// The chucklesome admin app that matches the DB this deployment points at —
// study links must land on the admin host backed by the SAME database, or the
// study ids won't resolve.
const adminHostForEnv = (): string =>
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('almostcrackd')
    ? 'https://admin.almostcrackd.ai'
    : 'https://admin.crackd.ai'

// The LOL Report (study stats dashboard), same env split as the app switcher.
const statsHostForEnv = (): string =>
  (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes('almostcrackd')
    ? 'https://stats.slightlyhumorous.org'
    : 'https://stats.humorstudy.org'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

// Nested row shape of the study-mapping query below. Supabase's inferred
// types report to-one joins as arrays, so both nestings go through firstOf.
type StudyRel = {
  id: number
  slug: string | null
  start_datetime_utc: string | null
  created_datetime_utc: string
}
type CaptionRel = {
  id: string
  humor_flavor_id: number
  caption_votes: { vote_value: number | null; profile_id: string | null }[] | null
}
type StudyMappingRow = {
  study_id: number
  studies: StudyRel | StudyRel[] | null
  captions: CaptionRel | CaptionRel[] | null
}

// Everything the card shows about a flavor's track record: how many captions
// it has produced, and how its captions rated in each study they appeared in.
const flavorStats = async (
  supabase: SupabaseServerClient,
  flavorId: number
): Promise<{
  captionCount: number | null
  lastCaptionAt: string | null
  studies: StudyStat[]
  statsError: string | null
}> => {
  const [countRes, latestRes, mappingRes] = await Promise.all([
    supabase
      .from('captions')
      .select('id', { count: 'exact', head: true })
      .eq('humor_flavor_id', flavorId),
    supabase
      .from('captions')
      .select('created_datetime_utc')
      .eq('humor_flavor_id', flavorId)
      .order('created_datetime_utc', { ascending: false })
      .limit(1),
    // Studies that include THIS flavor's captions, with each caption's votes.
    // A study can mix flavors — the aggregate is over this flavor's rows only.
    supabase
      .from('study_caption_mappings')
      .select(
        'study_id, studies ( id, slug, start_datetime_utc, created_datetime_utc ), captions!inner ( id, humor_flavor_id, caption_votes ( vote_value, profile_id ) )'
      )
      .eq('captions.humor_flavor_id', flavorId),
  ])

  const statsError =
    countRes.error?.message ?? latestRes.error?.message ?? mappingRes.error?.message ?? null

  const byStudy = new Map<
    number,
    StudyStat & { voterIds: Set<string> }
  >()
  for (const row of (mappingRes.data ?? []) as unknown as StudyMappingRow[]) {
    const study = firstOf(row.studies)
    if (!study) continue
    const entry =
      byStudy.get(study.id) ??
      ({
        id: study.id,
        slug: study.slug,
        date: study.start_datetime_utc ?? study.created_datetime_utc,
        captionCount: 0,
        up: 0,
        down: 0,
        voterCount: 0,
        voterIds: new Set<string>(),
      } as StudyStat & { voterIds: Set<string> })
    entry.captionCount += 1
    for (const vote of firstOf(row.captions)?.caption_votes ?? []) {
      if (typeof vote?.vote_value !== 'number') continue
      if (vote.vote_value > 0) entry.up += 1
      else if (vote.vote_value < 0) entry.down += 1
      if (vote.profile_id) entry.voterIds.add(vote.profile_id)
    }
    byStudy.set(study.id, entry)
  }
  const studies: StudyStat[] = [...byStudy.values()]
    .map(({ voterIds, ...s }) => ({ ...s, voterCount: voterIds.size }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))

  return {
    captionCount: countRes.error ? null : countRes.count ?? 0,
    lastCaptionAt:
      (latestRes.data as { created_datetime_utc: string }[] | null)?.[0]
        ?.created_datetime_utc ?? null,
    studies,
    statsError,
  }
}

export const metadata = pageMetadata('daily-jokes')

export default async function DailyJokesPage() {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  const allIds = GOOD_FLAVORS.map((f) => f.id)
  const forwardIds = GOOD_FLAVORS.filter((f) => f.kind === 'forward').map((f) => f.id)

  const { data: flavorRows } = await supabase
    .from('humor_flavors')
    .select('id, slug, description')
    .in('id', allIds)
  const flavorsById = new Map<number, { slug: string; description: string | null }>(
    ((flavorRows ?? []) as { id: number; slug: string; description: string | null }[]).map(
      (f) => [f.id, { slug: f.slug, description: f.description }]
    )
  )

  const stepColumns =
    'id, humor_flavor_id, order_by, description, llm_system_prompt, llm_user_prompt, llm_temperature, llm_input_type_id, llm_model_id'
  let stepRows = (
    await supabase
      .from('humor_flavor_steps')
      .select(`${stepColumns}, is_hidden`)
      .in('humor_flavor_id', forwardIds)
      .order('order_by', { ascending: true })
  ).data as StepRow[] | null
  if (!stepRows) {
    // is_hidden migration not applied yet — fall back to the legacy columns.
    stepRows = (
      await supabase
        .from('humor_flavor_steps')
        .select(stepColumns)
        .in('humor_flavor_id', forwardIds)
        .order('order_by', { ascending: true })
    ).data as StepRow[] | null
  }

  const { data: modelRows } = await supabase
    .from('llm_models')
    .select('id, provider_model_id, is_temperature_supported')
  const modelsById = new Map<number, ModelRow>()
  ;((modelRows ?? []) as ModelRow[]).forEach((m) => modelsById.set(m.id, m))

  const stepsByFlavor = new Map<number, OpsStep[]>()
  for (const s of (stepRows ?? []) as StepRow[]) {
    const model = s.llm_model_id ? modelsById.get(s.llm_model_id) : null
    const list = stepsByFlavor.get(s.humor_flavor_id) ?? []
    list.push({
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
    })
    stepsByFlavor.set(s.humor_flavor_id, list)
  }

  const statsList = await Promise.all(
    GOOD_FLAVORS.map((f) => flavorStats(supabase, f.id))
  )

  const cards: CardFlavor[] = GOOD_FLAVORS.map((f, i) => {
    const meta = flavorsById.get(f.id)
    const steps = stepsByFlavor.get(f.id) ?? []
    const stats = statsList[i]
    return {
      id: f.id,
      kind: f.kind,
      slug: meta?.slug ?? `flavor ${f.id}`,
      description: meta?.description ?? null,
      why: f.why,
      steps,
      captionCount: stats.captionCount,
      lastCaptionAt: stats.lastCaptionAt,
      studies: stats.studies,
      statsError: stats.statsError,
    }
  }).filter((f) => f.kind === 'reverse' || f.steps.length > 0)

  // Image sets — the pool a run draws its image from (same source as ops).
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
        <div className="max-w-3xl space-y-3">
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
            Daily jokes (prototype)
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
              Run the good flavors
            </span>
          </h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            One page that runs only the proven flavors, each on a fresh image
            from the chosen set, and collects the jokes — with each
            flavor&rsquo;s track record (captions produced, study ratings)
            alongside. The daily trigger isn&rsquo;t wired yet; today the
            button is you.
          </p>
        </div>

        <div className="mt-8">
          <DailyJokesClient
            userId={user.id}
            flavors={cards}
            imageSets={imageSets}
            adminHost={adminHostForEnv()}
            statsHost={statsHostForEnv()}
          />
        </div>
      </div>
    </main>
  )
}
