import { pageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

type CaptionImage = {
  id: string
  url: string | null
}

type FlavorSummary = {
  id: number
  slug: string | null
}

type LlmModel = {
  id: number
  name: string
  provider_model_id: string
}

type HumorFlavorStepType = {
  id: number
  slug: string
  description: string
}

type HumorFlavorStep = {
  id: number
  order_by: number
  description: string | null
  step_type: HumorFlavorStepType | HumorFlavorStepType[] | null
}

type LlmModelResponse = {
  id: string
  llm_model_response: string | null
  llm_system_prompt: string
  llm_user_prompt: string
  llm_temperature: number | null
  processing_time_seconds: number
  llm_model: LlmModel | LlmModel[] | null
  humor_flavor_step: HumorFlavorStep | HumorFlavorStep[] | null
}

type CaptionDetailRow = {
  id: string
  content: string | null
  created_datetime_utc: string
  humor_flavor_id: number | null
  llm_prompt_chain_id: number | null
  image: CaptionImage | CaptionImage[] | null
  flavor: FlavorSummary | FlavorSummary[] | null
}

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

const formatSeconds = (value: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Unknown'
  }

  return `${value.toFixed(2)}s`
}

const formatFlavorLabel = (slug: string) =>
  slug
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

const formatModelResponse = (value: string | null) => {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object') {
      return JSON.stringify(parsed, null, 2)
    }
  } catch {
    return value
  }

  return value
}

const resolveSingle = <T,>(value: T | T[] | null) =>
  Array.isArray(value) ? value[0] ?? null : value

export const metadata = pageMetadata('caption')

export default async function CaptionDetailsPage({
  params,
}: {
  params: Promise<{ captionId: string }>
}) {
  const { captionId } = await params

  if (!captionId) {
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

  const { data: caption, error: captionError } = await supabase
    .from('captions')
    .select(
      'id, content, created_datetime_utc, humor_flavor_id, llm_prompt_chain_id, image:images ( id, url ), flavor:humor_flavors ( id, slug )'
    )
    .eq('id', captionId)
    .maybeSingle()

  if (captionError || !caption) {
    notFound()
  }

  const captionRow = caption as CaptionDetailRow
  const image = Array.isArray(captionRow.image)
    ? captionRow.image[0] ?? null
    : captionRow.image
  const flavor = Array.isArray(captionRow.flavor)
    ? captionRow.flavor[0] ?? null
    : captionRow.flavor

  const promptChainId = captionRow.llm_prompt_chain_id ?? null
  const { data: promptChainResponses } = promptChainId
    ? await supabase
        .from('llm_model_responses')
        .select(
          'id, llm_model_response, llm_system_prompt, llm_user_prompt, llm_temperature, processing_time_seconds, llm_model:llm_models ( id, name, provider_model_id ), humor_flavor_step:humor_flavor_steps ( id, order_by, description, step_type:humor_flavor_step_types ( id, slug, description ) )'
        )
        .eq('llm_prompt_chain_id', promptChainId)
        .order('order_by', {
          referencedTable: 'humor_flavor_steps',
          ascending: true,
        })
    : { data: [] }

  const imageUrl = image?.url ?? null
  const flavorId = captionRow.humor_flavor_id ?? flavor?.id ?? null
  const backHref = flavorId ? `/humor-flavor/${flavorId}/captions` : '/'
  const llmResponses = (promptChainResponses ?? [])
    .map((response) => {
      const llmModel = resolveSingle(response.llm_model)
      const step = resolveSingle(response.humor_flavor_step)
      const stepType = resolveSingle(step?.step_type ?? null)

      return {
        ...response,
        llmModel,
        step,
        stepType,
      }
    })
    .sort((first, second) => {
      const firstOrder = first.step?.order_by ?? Number.POSITIVE_INFINITY
      const secondOrder = second.step?.order_by ?? Number.POSITIVE_INFINITY

      if (firstOrder !== secondOrder) {
        return firstOrder - secondOrder
      }

      return first.id.localeCompare(second.id)
    })

  const responseSummary = promptChainId
    ? llmResponses.length
      ? `${llmResponses.length} response${llmResponses.length === 1 ? '' : 's'} from prompt chain #${promptChainId}.`
      : `Prompt chain #${promptChainId} was recorded, but no responses were found.`
    : 'No prompt chain was recorded for this caption.'

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.5),transparent_48%),radial-gradient(circle_at_82%_8%,rgb(var(--ambient-spot-2)/0.32),transparent_42%),radial-gradient(circle_at_30%_85%,rgb(var(--ambient-spot-3)/0.38),transparent_55%),linear-gradient(130deg,rgb(var(--ambient-base-1)/1),rgb(var(--ambient-base-2)/0.7),rgb(var(--ambient-base-3)/0.45))] dark:bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.12),transparent_48%),radial-gradient(circle_at_78%_15%,rgb(var(--ambient-spot-2)/0.18),transparent_45%),linear-gradient(140deg,rgb(var(--ambient-base-1)/0.98),rgb(var(--ambient-base-2)/0.98),rgb(var(--ambient-base-3)/0.99))]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(120deg,rgb(var(--gloss)/0.7),rgb(var(--gloss)/0)_55%)] opacity-80 mix-blend-screen dark:opacity-40" />
      <div className="pointer-events-none absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.75),rgb(var(--ambient-orb-left-2)/0.35),transparent_70%)] blur-3xl animate-float dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.18),rgb(var(--ambient-orb-left-2)/0.12),transparent_70%)]" />
      <div className="pointer-events-none absolute right-[-6rem] top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.6),rgb(var(--ambient-orb-right-2)/0.2),transparent_72%)] blur-3xl animate-sway dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.16),rgb(var(--ambient-orb-right-2)/0.12),transparent_72%)]" />
      <div className="pointer-events-none absolute bottom-[-7rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.6),rgb(var(--ambient-spot-1)/0.3),transparent_70%)] blur-3xl animate-drift dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.14),rgb(var(--ambient-spot-2)/0.1),transparent_70%)]" />

      <AppHeader />

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-start px-6 py-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
          >
            Back to captions
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            {flavor?.slug ? (
              <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--accent))]">
                {flavor.slug}
              </span>
            ) : null}
            <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.7)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.4)] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--muted))]">
              {formatDate(captionRow.created_datetime_utc)}
            </span>
          </div>
        </div>

        <div className="mt-4 max-w-2xl space-y-4">
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
            Caption details
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl md:text-5xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent drop-shadow-[0_6px_22px_rgb(var(--headline-accent-strong)/0.35)]">
              Caption #{captionRow.id.slice(0, 8)}
            </span>
          </h1>
          <p className="text-base text-[rgb(var(--muted))] sm:text-lg">
            Review the image, caption text, and the prompt chain outputs that
            generated it.
          </p>
        </div>

        <div className="mt-10 grid gap-6">
          <section className="gloss-panel rounded-[32px] border border-[rgb(var(--ambient-spot-3)/0.7)] bg-[linear-gradient(140deg,rgb(var(--ambient-base-1)/0.9),rgb(var(--ambient-spot-1)/0.5))] p-6 shadow-[0_30px_70px_-48px_rgb(var(--ambient-spot-2)/0.55)] backdrop-blur dark:border-[rgb(var(--ambient-spot-2)/0.2)] dark:bg-[linear-gradient(140deg,rgb(var(--ambient-base-1)/0.2),rgb(var(--ambient-base-3)/0.3))]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
                  Caption content
                </p>
                <h2 className="mt-3 text-2xl font-semibold">
                  Image and caption text
                </h2>
                <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                  The visual input that anchored this caption.
                </p>
              </div>
              <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--accent-strong))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--accent))]">
                {imageUrl ? 'Image attached' : 'No image'}
              </span>
            </div>

            <div className="mt-6 grid gap-6">
              <div className="mx-auto w-full max-w-[920px] rounded-[28px] border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-4 shadow-[0_18px_40px_-30px_rgb(var(--accent-strong)/0.45)] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.05)]">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="Caption image"
                    className="mx-auto h-auto max-h-[55vh] max-w-full object-contain"
                  />
                ) : (
                  <div className="flex min-h-[320px] w-full items-center justify-center rounded-[20px] bg-[linear-gradient(135deg,rgb(var(--ambient-orb-right-1)/0.3),rgb(var(--ambient-orb-bottom-1)/0.6))] text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))/0.8] dark:text-[rgb(var(--muted))/0.7]">
                    No image uploaded for this caption
                  </div>
                )}
              </div>

              <div className="rounded-[28px] border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-5 shadow-[0_18px_40px_-30px_rgb(var(--accent-strong)/0.35)] backdrop-blur dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)]">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[rgb(var(--muted))]">
                  Caption text
                </p>
                <p className="mt-3 text-lg text-[rgb(var(--ink))] dark:text-[rgb(var(--ink)/0.9)]">
                  {captionRow.content ?? 'No caption text provided.'}
                </p>
              </div>
            </div>
          </section>

          <section className="gloss-panel rounded-[32px] border border-[rgb(var(--primary)/0.35)] bg-[linear-gradient(140deg,rgb(var(--primary-bright)/0.22),rgb(var(--primary)/0.12))] p-6 shadow-[0_30px_70px_-48px_rgb(var(--primary-deep)/0.4)] backdrop-blur dark:border-[rgb(var(--primary)/0.25)] dark:bg-[linear-gradient(140deg,rgb(var(--primary-deep)/0.25),rgb(var(--primary)/0.1))]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
                  LLM responses
                </p>
                <h2 className="mt-3 text-2xl font-semibold">
                  Prompt chain outputs
                </h2>
                <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                  {responseSummary}
                </p>
              </div>
              <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[rgb(var(--primary-deep))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--primary-bright))]">
                {promptChainId ? `Chain #${promptChainId}` : 'No chain'}
              </span>
            </div>

            {llmResponses.length ? (
              <div className="mt-6 grid gap-6">
                {llmResponses.map((response, index) => {
                  const stepOrder = response.step?.order_by ?? null
                  const hasStepOrder =
                    typeof stepOrder === 'number' && Number.isFinite(stepOrder)
                  const stepTypeLabel = response.stepType?.slug
                    ? formatFlavorLabel(response.stepType.slug)
                    : null
                  const stepTitle = hasStepOrder
                    ? `Step ${stepOrder}`
                    : `Response ${index + 1}`
                  const responseTitle = stepTypeLabel
                    ? `${stepTitle} - ${stepTypeLabel}`
                    : stepTitle
                  const stepDescription =
                    response.stepType?.description ||
                    response.step?.description ||
                    'LLM output captured for this prompt chain step.'
                  const modelLabel = response.llmModel?.provider_model_id
                    ? `${response.llmModel.name} (${response.llmModel.provider_model_id})`
                    : response.llmModel?.name ?? 'Unknown model'
                  const modelResponse = formatModelResponse(
                    response.llm_model_response
                  )

                  return (
                    <article
                      key={response.id}
                      className="rounded-[28px] border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-5 shadow-[0_18px_40px_-30px_rgb(var(--primary-deep)/0.35)] backdrop-blur dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[rgb(var(--muted))]">
                            Prompt chain step
                          </p>
                          <h3 className="mt-2 text-xl font-semibold">
                            {responseTitle}
                          </h3>
                          <p className="mt-2 text-sm text-[rgb(var(--muted))]">
                            {stepDescription}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {hasStepOrder ? (
                            <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-[rgb(var(--primary-deep))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.55)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--primary-bright))]">
                              Order {stepOrder}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center rounded-full border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-[rgb(var(--muted))] shadow-[0_12px_26px_-18px_rgb(var(--primary-deep)/0.35)] dark:border-[rgb(var(--gloss)/0.2)] dark:bg-[rgb(var(--panel)/0.1)] dark:text-[rgb(var(--muted))]">
                            {modelLabel}
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-4 shadow-[0_12px_24px_-18px_rgb(var(--primary-deep)/0.35)] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)]">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[rgb(var(--muted))]">
                              Temperature
                            </p>
                            <p className="mt-2 text-sm font-semibold text-[rgb(var(--ink))] dark:text-[rgb(var(--ink)/0.9)]">
                              {response.llm_temperature === null
                                ? 'Default'
                                : response.llm_temperature.toFixed(2)}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.8)] p-4 shadow-[0_12px_24px_-18px_rgb(var(--primary-deep)/0.35)] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)]">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[rgb(var(--muted))]">
                              Processing time
                            </p>
                            <p className="mt-2 text-sm font-semibold text-[rgb(var(--ink))] dark:text-[rgb(var(--ink)/0.9)]">
                              {formatSeconds(response.processing_time_seconds)}
                            </p>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.85)] p-4 shadow-[0_12px_24px_-18px_rgb(var(--primary-deep)/0.35)] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)]">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[rgb(var(--muted))]">
                            System prompt
                          </p>
                          <pre className="mt-3 whitespace-pre-wrap text-sm text-[rgb(var(--ink))] dark:text-[rgb(var(--ink)/0.9)]">
                            {response.llm_system_prompt ||
                              'No system prompt captured.'}
                          </pre>
                        </div>

                        <div className="rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.85)] p-4 shadow-[0_12px_24px_-18px_rgb(var(--primary-deep)/0.35)] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)]">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[rgb(var(--muted))]">
                            User prompt
                          </p>
                          <pre className="mt-3 whitespace-pre-wrap text-sm text-[rgb(var(--ink))] dark:text-[rgb(var(--ink)/0.9)]">
                            {response.llm_user_prompt || 'No user prompt captured.'}
                          </pre>
                        </div>

                        <div className="rounded-2xl border border-[rgb(var(--gloss)/0.7)] bg-[rgb(var(--panel)/0.9)] p-4 shadow-[0_12px_24px_-18px_rgb(var(--primary-deep)/0.35)] dark:border-[rgb(var(--gloss)/0.1)] dark:bg-[rgb(var(--panel)/0.1)]">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[rgb(var(--muted))]">
                            Model response
                          </p>
                          <pre className="mt-3 whitespace-pre-wrap text-sm text-[rgb(var(--ink))] dark:text-[rgb(var(--ink)/0.9)]">
                            {modelResponse ||
                              'No model response was saved for this caption.'}
                          </pre>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-[rgb(var(--muted))]">
                No LLM response data is attached to this caption.
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
