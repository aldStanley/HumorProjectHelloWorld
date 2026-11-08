import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import { namesByProfileId } from '../../who-ran-it'

import RunReport, {
  type ReportImage,
  type ReportRun,
  type ReportStep,
} from './run-report'

type ImageRow = {
  id: string
  image_id: string | null
  image_url: string | null
  position: number | null
  status: string
  error: string | null
  captions: unknown
  final_output: string | null
  moment: string | null
}

type StepRow = {
  id: string
  ops_run_image_id: string | null
  op_key: string
  op_title: string | null
  position: number | null
  branch_index: number | null
  branch_label: string | null
  provider_model_id: string | null
  llm_temperature: number | null
  include_image: boolean | null
  system_prompt: string | null
  user_prompt: string | null
  prior_outputs: unknown
  output: string | null
  error: string | null
  duration_ms: number | null
}

export const generateMetadata = flavorPageMetadata('ops/runs')

export default async function OpsRunPage({
  params,
}: {
  params: Promise<{ humorFlavorId: string; runId: string }>
}) {
  const { humorFlavorId, runId } = await params
  const flavorId = Number.parseInt(humorFlavorId, 10)
  if (!Number.isFinite(flavorId)) notFound()

  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { data: runRow } = await supabase
    .from('ops_runs')
    .select(
      'id, humor_flavor_id, flavor_slug, label, status, image_count, caption_count, export_json, export_warning, spec, study_image_set_slug, profile_id, started_datetime_utc, finished_datetime_utc'
    )
    .eq('id', runId)
    .maybeSingle()
  if (!runRow) notFound()

  const { data: imageRows } = await supabase
    .from('ops_run_images')
    // moment: reverse runs archive a MOMENT per row (outputs.momentInput);
    // forward runs leave it null.
    .select(
      'id, image_id, image_url, position, status, error, captions, final_output, moment:outputs->>momentInput'
    )
    .eq('ops_run_id', runId)
    .order('position', { ascending: true })

  const { data: stepRows } = await supabase
    .from('ops_run_steps')
    .select(
      'id, ops_run_image_id, op_key, op_title, position, branch_index, branch_label, provider_model_id, llm_temperature, include_image, system_prompt, user_prompt, prior_outputs, output, error, duration_ms'
    )
    .eq('ops_run_id', runId)
    .order('position', { ascending: true })
    .order('branch_index', { ascending: true })

  const stepsByImage = new Map<string, ReportStep[]>()
  ;((stepRows ?? []) as StepRow[]).forEach((s) => {
    if (!s.ops_run_image_id) return
    const list = stepsByImage.get(s.ops_run_image_id) ?? []
    list.push({
      id: s.id,
      opKey: s.op_key,
      opTitle: s.op_title,
      position: s.position ?? 0,
      branchIndex: s.branch_index,
      branchLabel: s.branch_label,
      providerModelId: s.provider_model_id,
      temperature: s.llm_temperature,
      includeImage: s.include_image,
      systemPrompt: s.system_prompt,
      userPrompt: s.user_prompt,
      priorOutputs: (s.prior_outputs ?? null) as Record<string, unknown> | null,
      output: s.output,
      error: s.error,
      durationMs: s.duration_ms,
    })
    stepsByImage.set(s.ops_run_image_id, list)
  })

  const images: ReportImage[] = ((imageRows ?? []) as ImageRow[]).map((i) => ({
    id: i.id,
    imageId: i.image_id,
    imageUrl: i.image_url ?? '',
    position: i.position ?? 0,
    status: i.status,
    error: i.error,
    captions: Array.isArray(i.captions) ? (i.captions as string[]) : null,
    finalOutput: i.final_output,
    moment: i.moment ?? null,
    steps: stepsByImage.get(i.id) ?? [],
  }))

  const run: ReportRun = {
    id: runRow.id as string,
    label: (runRow.label as string | null) ?? null,
    status: runRow.status as string,
    imageCount: (runRow.image_count as number | null) ?? images.length,
    captionCount: (runRow.caption_count as number | null) ?? 0,
    exportWarning: (runRow.export_warning as string | null) ?? null,
    exportJson: runRow.export_json ?? [],
    setSlug: (runRow.study_image_set_slug as string | null) ?? null,
    started: runRow.started_datetime_utc as string,
    finished: (runRow.finished_datetime_utc as string | null) ?? null,
    spec: runRow.spec ?? {},
  }

  const profileId = (runRow.profile_id as string | null) ?? null
  const ranBy = (await namesByProfileId(supabase, [profileId])).get(profileId ?? '')

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex w-full flex-1 flex-col px-6 py-12">
        <div className="max-w-3xl space-y-3">
          <div className="flex flex-wrap gap-4">
            <Link
              href={`/humor-flavor/${flavorId}/ops/runs`}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
            >
              All runs
            </Link>
            <Link
              href={`/humor-flavor/${flavorId}/ops/gallery/${runId}`}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
            >
              Images &amp; captions
            </Link>
          </div>
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
            {run.setSlug ?? 'batch run'} · {new Date(run.started).toLocaleString()}
            {ranBy ? ` · ran by ${ranBy}` : ''}
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
              {run.label ?? (runRow.flavor_slug as string)}
            </span>
          </h1>
        </div>

        <div className="mt-8 max-w-4xl">
          <RunReport run={run} images={images} />
        </div>
      </div>
    </main>
  )
}
