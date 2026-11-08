import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { USER_PROMPT_VARIABLES } from '@/utils/prompt-variables'
import { createClient } from '@/utils/supabase/server'

import { createHumorFlavorStep } from '../../actions'
import NewHumorFlavorStepForm from './new-step-form'

type FlavorStepType = {
  id: number
  slug: string
}

type FlavorIOType = {
  id: number
  slug: string
}

type FlavorModel = {
  id: number
  name: string
  provider_model_id: string
  is_temperature_supported: boolean
}

const formatFlavorLabel = (slug: string) =>
  slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

export const generateMetadata = flavorPageMetadata('humor-flavor-step/new')

export default async function NewHumorFlavorStepPage({
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
    .select('id, slug, description')
    .eq('id', flavorId)
    .maybeSingle()

  if (flavorError || !flavor) {
    notFound()
  }

  const [{ data: stepTypes }, { data: inputTypes }, { data: outputTypes }, { data: models }] =
    await Promise.all([
      supabase
        .from('humor_flavor_step_types')
        .select('id, slug')
        .order('slug', { ascending: true }),
      supabase
        .from('llm_input_types')
        .select('id, slug')
        .order('slug', { ascending: true }),
      supabase
        .from('llm_output_types')
        .select('id, slug')
        .order('slug', { ascending: true }),
      supabase
        .from('llm_models')
        .select('id, name, provider_model_id, is_temperature_supported')
        .order('name', { ascending: true }),
    ])

  const stepTypeOptions = (stepTypes ?? []).map((type: FlavorStepType) => ({
    id: type.id,
    label: formatFlavorLabel(type.slug),
  }))
  const inputTypeOptions = (inputTypes ?? []).map((type: FlavorIOType) => ({
    id: type.id,
    label: formatFlavorLabel(type.slug),
  }))
  const outputTypeOptions = (outputTypes ?? []).map((type: FlavorIOType) => ({
    id: type.id,
    label: formatFlavorLabel(type.slug),
  }))
  const modelOptions = (models ?? []).map((model: FlavorModel) => ({
    id: model.id,
    label: model.provider_model_id
      ? `${model.name} (${model.provider_model_id})`
      : model.name,
    isTemperatureSupported: model.is_temperature_supported,
  }))

  const inputClasses =
    'w-full rounded-2xl border border-[rgb(var(--gloss)/0.8)] bg-[rgb(var(--panel)/0.9)] px-3 py-2 text-sm text-[rgb(var(--ink))] shadow-[inset_0_0_0_1px_rgb(var(--gloss)/0.6)] transition focus:border-[rgb(var(--primary)/0.6)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--primary)/0.35)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--ink)/0.95)] dark:focus:border-[rgb(var(--primary-bright)/0.5)] dark:focus:ring-[rgb(var(--primary-bright)/0.25)]'
  const labelClasses =
    'text-xs font-semibold uppercase tracking-[0.24em] text-[rgb(var(--muted))]'
  const listboxButtonClasses = `${inputClasses} pr-10`

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.5),transparent_48%),radial-gradient(circle_at_82%_8%,rgb(var(--ambient-spot-2)/0.32),transparent_42%),radial-gradient(circle_at_30%_85%,rgb(var(--ambient-spot-3)/0.38),transparent_55%),linear-gradient(130deg,rgb(var(--ambient-base-1)/1),rgb(var(--ambient-base-2)/0.7),rgb(var(--ambient-base-3)/0.45))] dark:bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.12),transparent_48%),radial-gradient(circle_at_78%_15%,rgb(var(--ambient-spot-2)/0.18),transparent_45%),linear-gradient(140deg,rgb(var(--ambient-base-1)/0.98),rgb(var(--ambient-base-2)/0.98),rgb(var(--ambient-base-3)/0.99))]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(120deg,rgb(var(--gloss)/0.7),rgb(var(--gloss)/0)_55%)] opacity-80 mix-blend-screen dark:opacity-40" />
      <div className="pointer-events-none absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.75),rgb(var(--ambient-orb-left-2)/0.35),transparent_70%)] blur-3xl animate-float dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.18),rgb(var(--ambient-orb-left-2)/0.12),transparent_70%)]" />
      <div className="pointer-events-none absolute right-[-6rem] top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.6),rgb(var(--ambient-orb-right-2)/0.2),transparent_72%)] blur-3xl animate-sway dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.16),rgb(var(--ambient-orb-right-2)/0.12),transparent_72%)]" />
      <div className="pointer-events-none absolute bottom-[-7rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.6),rgb(var(--ambient-spot-1)/0.3),transparent_70%)] blur-3xl animate-drift dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.14),rgb(var(--ambient-spot-2)/0.1),transparent_70%)]" />

      <AppHeader />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
        <div className="max-w-2xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href={`/humor-flavor/${flavor.id}`}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
            >
              Back to flavor
            </Link>
            <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--accent))]">
              New step
            </span>
          </div>
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
            Humor flavor
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl md:text-5xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent drop-shadow-[0_6px_22px_rgb(var(--headline-accent-strong)/0.35)]">
              {flavor.slug}
            </span>
          </h1>
          <p className="text-base text-[rgb(var(--muted))] sm:text-lg">
            Add a new step to the prompt pipeline for this flavor.
          </p>
        </div>

        <div className="mt-10 grid gap-6">
          <section className="gloss-panel rounded-[32px] border border-[rgb(var(--ambient-spot-3)/0.7)] bg-[linear-gradient(140deg,rgb(var(--ambient-base-1)/0.9),rgb(var(--ambient-spot-1)/0.5))] p-6 shadow-[0_30px_70px_-48px_rgb(var(--ambient-spot-2)/0.55)] backdrop-blur dark:border-[rgb(var(--ambient-spot-2)/0.2)] dark:bg-[linear-gradient(140deg,rgb(var(--ambient-base-1)/0.2),rgb(var(--ambient-base-3)/0.3))]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
                  New step
                </p>
                <h2 className="mt-3 text-2xl font-semibold">
                  Define the pipeline step
                </h2>
                <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                  Choose the model, types, and prompts for this step.
                </p>
              </div>
            </div>

            <NewHumorFlavorStepForm
              flavorId={flavor.id}
              action={createHumorFlavorStep}
              stepTypeOptions={stepTypeOptions}
              inputTypeOptions={inputTypeOptions}
              outputTypeOptions={outputTypeOptions}
              modelOptions={modelOptions}
              defaultStepTypeId={stepTypeOptions[0]?.id ?? null}
              defaultInputTypeId={inputTypeOptions[0]?.id ?? null}
              defaultOutputTypeId={outputTypeOptions[0]?.id ?? null}
              defaultModelId={modelOptions[0]?.id ?? null}
              inputClassName={inputClasses}
              labelClassName={labelClasses}
              listboxButtonClassName={listboxButtonClasses}
              userPromptVariables={USER_PROMPT_VARIABLES}
            />
          </section>
        </div>
      </div>
    </main>
  )
}
