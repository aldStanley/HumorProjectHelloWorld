import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import {
  deleteHumorFlavorStep,
  duplicateHumorFlavor,
  reorderHumorFlavorSteps,
} from './actions'
import BulkModelForm from './bulk-model-form'
import DuplicateFlavorModal from './duplicate-flavor-modal'
import FlavorFavorite from './flavor-favorite'
import HumorFlavorStepList from './humor-flavor-step-list'

type FlavorStepType = {
  id: number
  slug: string
}

type FlavorStepRow = {
  id: number
  order_by: number
  llm_system_prompt: string | null
  llm_user_prompt: string | null
  description: string | null
  step_type: FlavorStepType | FlavorStepType[] | null
}

// Plain, compact buttons: solid color, normal case, no letter-spacing, no
// gradients or hover animations.
const toolButtonClass =
  'inline-flex items-center justify-center rounded-lg bg-[rgb(var(--primary))] px-3 py-1.5 text-sm font-medium text-[rgb(var(--on-primary))] transition hover:bg-[rgb(var(--primary-deep))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))]'

// Greyed-out variant for deprecated tools and the pipeline direction this
// flavor doesn't use — still clickable, just visually de-emphasized.
const mutedToolButtonClass =
  'inline-flex items-center justify-center rounded-lg border border-[rgb(var(--gloss)/0.5)] bg-[rgb(var(--panel)/0.5)] px-3 py-1.5 text-sm font-medium text-[rgb(var(--muted))] transition hover:text-[rgb(var(--ink))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]'

const formatFlavorLabel = (slug: string) =>
  slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

const formatDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export const generateMetadata = flavorPageMetadata()

export default async function HumorFlavorPage({
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
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  const { data: flavor, error: flavorError } = await supabase
    .from('humor_flavors')
    .select('id, slug, description, created_datetime_utc')
    .eq('id', flavorId)
    .maybeSingle()

  if (flavorError || !flavor) {
    notFound()
  }

  const { data: steps, error: stepsError } = await supabase
    .from('humor_flavor_steps')
    .select(
      'id, order_by, llm_system_prompt, llm_user_prompt, description, step_type:humor_flavor_step_types ( id, slug )'
    )
    .eq('humor_flavor_id', flavor.id)
    .order('order_by', { ascending: true })

  // The current user's favorite flag + comment for this flavor. Tolerate the
  // table not existing yet (feature ships before the migration is applied).
  const { data: favoriteRow } = await supabase
    .from('humor_flavor_favorites')
    .select('is_favorite, comment')
    .eq('flavor_id', flavor.id)
    .eq('profile_id', user.id)
    .maybeSingle()

  const { data: models } = await supabase.from('llm_models')
    .select('id, name, provider_model_id, is_temperature_supported').order('name')

  const stepRows = (steps ?? []) as FlavorStepRow[]
  // Direction: reverse flavors are the ones whose steps follow the reverse
  // chain convention (R1:/R2:/... descriptions); there is no schema flag.
  const isTextFirst = stepRows.some((s) => /^R\d/.test(s.description ?? ''))
  const directionLabel = isTextFirst
    ? 'Text-first (reverse)'
    : 'Image-first (forward)'
  const formatDescriptionPreview = (description: string | null) => {
    if (!description) {
      return null
    }

    const words = description.trim().split(/\s+/).filter(Boolean)
    if (!words.length) {
      return null
    }

    const preview = words.slice(0, 10).join(' ')
    return words.length > 10 ? `${preview}...` : preview
  }
  const title = flavor.slug
  const duplicateSlug = `${flavor.slug}-copy`
  const duplicateDescription = flavor.description
    ? `Copy of ${flavor.description}`
    : 'Copy of '
  const stepSummaries = stepRows.map((step) => {
    const stepType = Array.isArray(step.step_type)
      ? step.step_type[0] ?? null
      : step.step_type

    return {
      id: step.id,
      order: step.order_by,
      stepTypeLabel: stepType?.slug
        ? formatFlavorLabel(stepType.slug)
        : 'Unknown step type',
      description: step.description,
      descriptionPreview: formatDescriptionPreview(step.description),
      systemPrompt: step.llm_system_prompt,
      userPrompt: step.llm_user_prompt,
    }
  })

  const forwardBtnClass = isTextFirst ? mutedToolButtonClass : toolButtonClass
  const reverseBtnClass = isTextFirst ? toolButtonClass : mutedToolButtonClass

  const forwardToolsGroup = (
    <div key="forward" className={isTextFirst ? 'opacity-80' : undefined}>
      <h2 className="mb-1.5 text-xs font-semibold text-[rgb(var(--muted))]">
        Image-First (image → caption)
        {isTextFirst ? ' — not this flavor’s kind' : ''}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/humor-flavor/${flavor.id}/ops`} className={forwardBtnClass}>
          Batch Runner
        </Link>
        <Link href={`/humor-flavor/${flavor.id}/ops`} className={forwardBtnClass}>
          Flavor Maker
        </Link>
        <Link href={`/humor-flavor/${flavor.id}/ops2`} className={forwardBtnClass}>
          Flavor Inspector
        </Link>
        <Link
          href={`/humor-flavor/${flavor.id}/ops/runs`}
          className={forwardBtnClass}
        >
          Runs
        </Link>
      </div>
    </div>
  )

  const reverseToolsGroup = (
    <div key="reverse" className={isTextFirst ? undefined : 'opacity-80'}>
      <h2 className="mb-1.5 text-xs font-semibold text-[rgb(var(--muted))]">
        Text-First (context → image)
        {isTextFirst ? '' : ' — not this flavor’s kind'}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/humor-flavor/${flavor.id}/reverse`}
          className={reverseBtnClass}
        >
          Batch Runner
        </Link>
        <Link
          href={`/humor-flavor/${flavor.id}/ops-reverse`}
          className={reverseBtnClass}
        >
          Flavor Maker
        </Link>
        <Link
          href={`/humor-flavor/${flavor.id}/ops-reverse2`}
          className={reverseBtnClass}
        >
          Flavor Inspector
        </Link>
        <Link
          href={`/humor-flavor/${flavor.id}/ops-reverse/runs`}
          className={reverseBtnClass}
        >
          Runs
        </Link>
      </div>
    </div>
  )

  const flavorDetailsSection = (
    <section className="rounded-xl border border-[rgb(var(--primary)/0.35)] bg-[rgb(var(--primary-bright)/0.12)] p-4 dark:border-[rgb(var(--primary)/0.25)] dark:bg-[rgb(var(--primary-deep)/0.15)]">
      <p className="text-sm font-semibold text-[rgb(var(--ink))]">
        Flavor details
      </p>
      <div className="mt-3 grid gap-3 text-sm text-[rgb(var(--muted))] sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-[rgb(var(--muted))]">
            Slug
          </p>
          <p className="mt-1 text-sm font-semibold text-[rgb(var(--ink))]">
            {flavor.slug}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-[rgb(var(--muted))]">
            Created
          </p>
          <p className="mt-1 text-sm font-semibold text-[rgb(var(--ink))]">
            {formatDate(flavor.created_datetime_utc)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-[rgb(var(--muted))]">
            Flavor ID
          </p>
          <p className="mt-1 text-sm font-semibold text-[rgb(var(--ink))]">
            {flavor.id}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-[rgb(var(--muted))]">
            Steps
          </p>
          <p className="mt-1 text-sm font-semibold text-[rgb(var(--ink))]">
            {stepsError ? 'Unavailable' : stepRows.length}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-[rgb(var(--muted))]">
            Direction
          </p>
          <p className="mt-1 text-sm font-semibold text-[rgb(var(--ink))]">
            {directionLabel}
          </p>
        </div>
      </div>
      {flavor.description ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-[rgb(var(--accent-strong))]">
            Description / experiment log
          </summary>
          <p className="mt-3 whitespace-pre-wrap text-sm text-[rgb(var(--muted))]">
            {flavor.description}
          </p>
        </details>
      ) : null}
    </section>
  )

  const flavorStepsSection = (
    <section className="rounded-xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.6)] p-4 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.1)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Flavor steps</h2>
        <span className="text-sm text-[rgb(var(--muted))]">
          {stepsError ? 'Unavailable' : `${stepRows.length} steps`}
        </span>
      </div>
      <p className="mt-1 text-sm text-[rgb(var(--muted))]">
        Drag steps to reorder them or preview prompts at a glance.
      </p>

      {stepSummaries.length > 0 && models?.length ? (
        <div className="mt-5"><BulkModelForm flavorId={flavor.id} models={models} /></div>
      ) : null}
      {stepsError ? (
        <p className="mt-4 text-sm text-[rgb(var(--muted))]">
          Unable to load steps for this flavor right now.
        </p>
      ) : stepSummaries.length ? (
        <HumorFlavorStepList
          flavorId={flavor.id}
          steps={stepSummaries}
          reorderAction={reorderHumorFlavorSteps}
          deleteAction={deleteHumorFlavorStep}
        />
      ) : (
        <p className="mt-4 text-sm text-[rgb(var(--muted))]">
          No steps are defined for this flavor yet.
        </p>
      )}
    </section>
  )

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-start px-6 py-8">
        <div className="flex w-full flex-col gap-4">
          <div className="min-w-0 max-w-2xl space-y-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
            >
              ← Back to flavors
            </Link>
            <h1 className="text-2xl font-semibold text-[rgb(var(--headline-accent-strong))] sm:text-3xl">
              {title}
            </h1>
            <p
              className={`text-sm font-medium ${
                isTextFirst
                  ? 'text-sky-700 dark:text-sky-300'
                  : 'text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {isTextFirst ? '📝' : '🖼'} {directionLabel}
            </p>
          </div>
          <div className="flex w-full flex-col gap-4">
            {forwardToolsGroup}
            {reverseToolsGroup}
            <div>
              <h2 className="mb-1.5 text-xs font-semibold text-[rgb(var(--muted))]">
                Flavor tools — probably deprecated
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/humor-flavor/${flavor.id}/humor-flavor-step/new`}
                  className={mutedToolButtonClass}
                >
                  Add step
                </Link>
                <DuplicateFlavorModal
                  flavorId={flavor.id}
                  defaultSlug={duplicateSlug}
                  defaultDescription={duplicateDescription}
                  action={duplicateHumorFlavor}
                  triggerClassName={mutedToolButtonClass}
                />
                <Link
                  href={`/humor-flavor/${flavor.id}/captions`}
                  className={mutedToolButtonClass}
                >
                  Captions
                </Link>
                <Link
                  href={`/humor-flavor/${flavor.id}/test`}
                  className={mutedToolButtonClass}
                >
                  Test
                </Link>
                <Link
                  href={`/humor-flavor/${flavor.id}/matrix`}
                  className={mutedToolButtonClass}
                >
                  Matrix
                </Link>
                <Link
                  href={`/humor-flavor/${flavor.id}/chiltrix`}
                  className={mutedToolButtonClass}
                >
                  The Chiltrix
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          {flavorDetailsSection}
          <FlavorFavorite
            flavorId={flavor.id}
            initialIsFavorite={favoriteRow?.is_favorite ?? false}
            initialComment={favoriteRow?.comment ?? ''}
          />
          {flavorStepsSection}
        </div>
      </div>
    </main>
  )
}
