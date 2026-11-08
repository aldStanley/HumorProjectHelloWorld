import { stepPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { USER_PROMPT_VARIABLES } from '@/utils/prompt-variables'
import { createClient } from '@/utils/supabase/server'

import StepDetailsForm from './step-details-form'

type FlavorStepType = {
  id: number
  slug: string
  description: string
}

type FlavorIOType = {
  id: number
  slug: string
  description: string
}

type FlavorModel = {
  id: number
  name: string
  provider_model_id: string
  is_temperature_supported: boolean
}

type FlavorStepRow = {
  id: number
  order_by: number
  humor_flavor_id: number
  humor_flavor_step_type_id: number
  llm_input_type_id: number
  llm_output_type_id: number
  llm_model_id: number
  llm_temperature: number | null
  llm_system_prompt: string | null
  llm_user_prompt: string | null
  description: string | null
  step_type: FlavorStepType | FlavorStepType[] | null
  input_type: FlavorIOType | FlavorIOType[] | null
  output_type: FlavorIOType | FlavorIOType[] | null
  llm_model: FlavorModel | FlavorModel[] | null
  flavor: { id: number; slug: string } | { id: number; slug: string }[] | null
}

const formatFlavorLabel = (slug: string) =>
  slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

export const generateMetadata = stepPageMetadata

export default async function HumorFlavorStepPage({
  params,
}: {
  params: Promise<{ humorFlavorStepId: string }>
}) {
  const { humorFlavorStepId } = await params
  const stepId = Number.parseInt(humorFlavorStepId, 10)

  if (!Number.isFinite(stepId)) {
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

  const { data: step, error: stepError } = await supabase
    .from('humor_flavor_steps')
    .select(
      'id, order_by, humor_flavor_id, humor_flavor_step_type_id, llm_input_type_id, llm_output_type_id, llm_model_id, llm_temperature, llm_system_prompt, llm_user_prompt, description, step_type:humor_flavor_step_types ( id, slug, description ), input_type:llm_input_types ( id, slug, description ), output_type:llm_output_types ( id, slug, description ), llm_model:llm_models ( id, name, provider_model_id, is_temperature_supported ), flavor:humor_flavors ( id, slug )'
    )
    .eq('id', stepId)
    .maybeSingle()

  if (stepError || !step) {
    notFound()
  }

  const { count: stepCount, error: stepCountError } = await supabase
    .from('humor_flavor_steps')
    .select('*', { count: 'exact', head: true })
    .eq('humor_flavor_id', step.humor_flavor_id)

  if (stepCountError) {
    console.error('Failed to load humor flavor step count.', stepCountError)
  }

  const [{ data: stepTypes }, { data: inputTypes }, { data: outputTypes }, { data: models }] =
    await Promise.all([
      supabase
        .from('humor_flavor_step_types')
        .select('id, slug, description')
        .order('slug', { ascending: true }),
      supabase
        .from('llm_input_types')
        .select('id, slug, description')
        .order('slug', { ascending: true }),
      supabase
        .from('llm_output_types')
        .select('id, slug, description')
        .order('slug', { ascending: true }),
      supabase
        .from('llm_models')
        .select('id, name, provider_model_id')
        .order('name', { ascending: true }),
    ])

  const stepRow = step as FlavorStepRow
  const stepType = Array.isArray(stepRow.step_type)
    ? stepRow.step_type[0] ?? null
    : stepRow.step_type
  const llmModel = Array.isArray(stepRow.llm_model)
    ? stepRow.llm_model[0] ?? null
    : stepRow.llm_model
  const flavorInfo = Array.isArray(stepRow.flavor)
    ? stepRow.flavor[0] ?? null
    : stepRow.flavor
  const supportsTemperature = llmModel?.is_temperature_supported ?? false
  const maxStepOrder = stepCount ?? stepRow.order_by

  const title = stepType?.slug
    ? formatFlavorLabel(stepType.slug)
    : `Step ${stepRow.order_by}`
  const stepTypeOptions = (stepTypes ?? []).map((type) => ({
    id: type.id,
    label: formatFlavorLabel(type.slug),
  }))
  const inputTypeOptions = (inputTypes ?? []).map((type) => ({
    id: type.id,
    label: formatFlavorLabel(type.slug),
  }))
  const outputTypeOptions = (outputTypes ?? []).map((type) => ({
    id: type.id,
    label: formatFlavorLabel(type.slug),
  }))
  const modelOptions = (models ?? []).map((model) => ({
    id: model.id,
    label: model.provider_model_id
      ? `${model.name} (${model.provider_model_id})`
      : model.name,
  }))

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.5),transparent_48%),radial-gradient(circle_at_82%_8%,rgb(var(--ambient-spot-2)/0.32),transparent_42%),radial-gradient(circle_at_30%_85%,rgb(var(--ambient-spot-3)/0.38),transparent_55%),linear-gradient(130deg,rgb(var(--ambient-base-1)/1),rgb(var(--ambient-base-2)/0.7),rgb(var(--ambient-base-3)/0.45))] dark:bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.12),transparent_48%),radial-gradient(circle_at_78%_15%,rgb(var(--ambient-spot-2)/0.18),transparent_45%),linear-gradient(140deg,rgb(var(--ambient-base-1)/0.98),rgb(var(--ambient-base-2)/0.98),rgb(var(--ambient-base-3)/0.99))]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(120deg,rgb(var(--gloss)/0.7),rgb(var(--gloss)/0)_55%)] opacity-80 mix-blend-screen dark:opacity-40" />
      <div className="pointer-events-none absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.75),rgb(var(--ambient-orb-left-2)/0.35),transparent_70%)] blur-3xl animate-float dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.18),rgb(var(--ambient-orb-left-2)/0.12),transparent_70%)]" />
      <div className="pointer-events-none absolute right-[-6rem] top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.6),rgb(var(--ambient-orb-right-2)/0.2),transparent_72%)] blur-3xl animate-sway dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.16),rgb(var(--ambient-orb-right-2)/0.12),transparent_72%)]" />
      <div className="pointer-events-none absolute bottom-[-7rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.6),rgb(var(--ambient-spot-1)/0.3),transparent_70%)] blur-3xl animate-drift dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.14),rgb(var(--ambient-spot-2)/0.1),transparent_70%)]" />

      <AppHeader />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-start px-6 py-16">
        <div className="max-w-2xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href={`/humor-flavor/${stepRow.humor_flavor_id}`}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
            >
              Back to flavor
            </Link>
            <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--accent))]">
              Step {stepRow.order_by}
            </span>
          </div>
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
            Flavor step
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl md:text-5xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent drop-shadow-[0_6px_22px_rgb(var(--headline-accent-strong)/0.35)]">
              {title}
            </span>
          </h1>
          <p className="text-base text-[rgb(var(--muted))] sm:text-lg">
            {stepType?.description ?? 'Fine-tune this step in the pipeline.'}
          </p>
        </div>

        <div className="mt-10 grid gap-6">
          <section className="gloss-panel rounded-[32px] border border-[rgb(var(--ambient-spot-3)/0.7)] bg-[linear-gradient(140deg,rgb(var(--ambient-base-1)/0.9),rgb(var(--ambient-spot-1)/0.5))] p-6 shadow-[0_30px_70px_-48px_rgb(var(--ambient-spot-2)/0.55)] backdrop-blur dark:border-[rgb(var(--ambient-spot-2)/0.2)] dark:bg-[linear-gradient(140deg,rgb(var(--ambient-base-1)/0.2),rgb(var(--ambient-base-3)/0.3))]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
                  Step details
                </p>
                <h2 className="mt-3 text-2xl font-semibold">
                  Edit prompt pipeline step
                </h2>
                <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                  Update the step fields and save your changes.
                </p>
              </div>
              {flavorInfo ? (
                <Link
                  href={`/humor-flavor/${flavorInfo.id}`}
                  className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_-20px_rgb(var(--primary-deep)/0.65)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--accent))]"
                >
                  {formatFlavorLabel(flavorInfo.slug)}
                </Link>
              ) : null}
            </div>

            <StepDetailsForm
              stepId={stepRow.id}
              flavorId={stepRow.humor_flavor_id}
              stepOrder={stepRow.order_by}
              maxStepOrder={maxStepOrder}
              flavorSlug={flavorInfo?.slug ?? null}
              stepTypeId={stepRow.humor_flavor_step_type_id}
              inputTypeId={stepRow.llm_input_type_id}
              outputTypeId={stepRow.llm_output_type_id}
              modelId={stepRow.llm_model_id}
              temperature={stepRow.llm_temperature}
              systemPrompt={stepRow.llm_system_prompt}
              userPrompt={stepRow.llm_user_prompt}
              description={stepRow.description}
              supportsTemperature={supportsTemperature}
              stepTypeOptions={stepTypeOptions}
              inputTypeOptions={inputTypeOptions}
              outputTypeOptions={outputTypeOptions}
              modelOptions={modelOptions}
              userPromptVariables={USER_PROMPT_VARIABLES}
            />
          </section>
        </div>
      </div>
    </main>
  )
}
