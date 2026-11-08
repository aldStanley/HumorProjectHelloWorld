import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import type { DbStep } from '../ops2/trace-lib'

import FlavorSelect from './flavor-select'
import OpsReverse2Client from './ops-reverse2-client'
import type { RevArchStep, SpecStep } from './reverse-trace-lib'

export const dynamic = 'force-dynamic'

type RunRow = {
  id: string
  label: string | null
  status: string
  study_image_set_id: number | null
  study_image_set_slug: string | null
  started_datetime_utc: string
  caption_count: number | null
  spec: { surface?: string; steps?: SpecStep[]; topN?: number } | null
}

// ops-reverse2 — Reverse Flavor Inspector: the ops2-style trace workbench over
// archived REVERSE runs (ops_runs rows whose spec.surface === 'ops-reverse',
// written by the ops-reverse page). One ops_run_images row per MOMENT.
export const generateMetadata = flavorPageMetadata('ops-reverse2')

export default async function OpsReverse2Page({
  params,
  searchParams,
}: {
  params: Promise<{ humorFlavorId: string }>
  searchParams: Promise<{ run?: string; moment?: string; diff?: string }>
}) {
  const { humorFlavorId } = await params
  const { run: runParam, moment: momentParam, diff: diffParam } = await searchParams
  const flavorId = Number.parseInt(humorFlavorId, 10)
  if (!Number.isFinite(flavorId)) notFound()

  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { data: flavor } = await supabase
    .from('humor_flavors')
    .select('id, slug, description')
    .eq('id', flavorId)
    .maybeSingle()
  if (!flavor) notFound()

  // Current DB prompts (drift reference for the trace views).
  const [{ data: stepRows }, { data: modelRows }] = await Promise.all([
    supabase
      .from('humor_flavor_steps')
      .select(
        'id, order_by, description, llm_system_prompt, llm_user_prompt, llm_temperature, llm_input_type_id, llm_model_id'
      )
      .eq('humor_flavor_id', flavorId)
      .order('order_by'),
    supabase.from('llm_models').select('id, provider_model_id, is_temperature_supported'),
  ])
  const modelById = new Map(
    (modelRows ?? []).map((m) => [
      m.id as number,
      m as { provider_model_id: string; is_temperature_supported: boolean },
    ])
  )
  const steps: DbStep[] = (stepRows ?? []).map((s) => ({
    id: s.id as number,
    orderBy: s.order_by as number,
    description: (s.description as string | null) ?? '',
    systemPrompt: (s.llm_system_prompt as string | null) ?? '',
    userPrompt: (s.llm_user_prompt as string | null) ?? '',
    providerModelId: modelById.get(s.llm_model_id as number)?.provider_model_id ?? 'gpt-4o',
    isTemperatureSupported: modelById.get(s.llm_model_id as number)?.is_temperature_supported ?? true,
    temperature: (s.llm_temperature as number | null) ?? null,
    includeImage: s.llm_input_type_id === 1,
  }))

  // Archived reverse runs only (newest first) — forward runs stay on ops2.
  const { data: runRows } = await supabase
    .from('ops_runs')
    .select(
      'id, label, status, study_image_set_id, study_image_set_slug, started_datetime_utc, caption_count, spec'
    )
    .eq('humor_flavor_id', flavorId)
    .eq('spec->>surface', 'ops-reverse')
    .order('started_datetime_utc', { ascending: false })
    .limit(25)
  const runs = (runRows ?? []) as RunRow[]
  const runId = runParam && runs.some((r) => r.id === runParam) ? runParam : runs[0]?.id ?? null
  const selectedRun = runs.find((r) => r.id === runId) ?? null

  // Moments of the selected run (one ops_run_images row each). outputs carries
  // momentInput + all stage outputs — needed anyway for the workbench.
  let moments: {
    runImageId: string
    position: number
    status: string
    error: string | null
    imageUrl: string | null
    moment: string
    outputs: Record<string, unknown>
  }[] = []
  let arch: RevArchStep[] = []
  let selMomentId: string | null = null
  const momentRowOf = (r: {
    id: unknown
    position: unknown
    status: unknown
    error: unknown
    image_url: unknown
    outputs: unknown
  }) => ({
    runImageId: r.id as string,
    position: r.position as number,
    status: r.status as string,
    error: (r.error as string | null) ?? null,
    imageUrl: (r.image_url as string | null) ?? null,
    moment: String((r.outputs as Record<string, unknown>)?.momentInput ?? ''),
    outputs: (r.outputs as Record<string, unknown>) ?? {},
  })
  if (runId) {
    const { data: momentRows } = await supabase
      .from('ops_run_images')
      .select('id, position, status, error, image_url, outputs')
      .eq('ops_run_id', runId)
      .order('position')
    moments = (momentRows ?? []).map(momentRowOf)
    const sel = moments.find((m) => m.runImageId === momentParam) ?? moments[0]
    if (sel) {
      selMomentId = sel.runImageId
      const { data: stepArch } = await supabase
        .from('ops_run_steps')
        .select(
          'op_key, op_title, position, branch_label, step_order_by, provider_model_id, include_image, system_prompt, user_prompt, prior_outputs, output, error, duration_ms, created_datetime_utc'
        )
        .eq('ops_run_image_id', sel.runImageId)
        .order('created_datetime_utc')
      arch = (stepArch ?? []).map((r) => ({
        opKey: r.op_key as string,
        opTitle: r.op_title as string | null,
        position: r.position as number | null,
        branchLabel: r.branch_label as string | null,
        stepOrderBy: r.step_order_by as number | null,
        providerModelId: r.provider_model_id as string | null,
        includeImage: r.include_image as boolean | null,
        systemPrompt: r.system_prompt as string | null,
        userPrompt: r.user_prompt as string | null,
        priorOutputs: (r.prior_outputs as Record<string, string> | null) ?? null,
        output: r.output as string | null,
        error: r.error as string | null,
        durationMs: (r.duration_ms as number | null) ?? null,
      }))
    }
  }

  // Resolve imgN keys → URLs from the run's study image set. The reverse
  // Maker builds its catalog as img{position+1} over the set's url-bearing
  // images in mapping order (see ops-reverse catalog), so the same walk here
  // recovers thumbnails for candidates whose image never ranked (the archive
  // only stores URLs on ranked results).
  const setUrlByKey: Record<string, string> = {}
  if (selectedRun?.study_image_set_id) {
    const { data: mapRows } = await supabase
      .from('study_image_set_image_mappings')
      .select('id, image:images ( id, url )')
      .eq('study_image_set_id', selectedRun.study_image_set_id)
      .order('id', { ascending: true })
    const urls = (mapRows ?? [])
      .map((m) => {
        const img = Array.isArray(m.image) ? m.image[0] : m.image
        return (img as { url?: string | null } | null)?.url ?? null
      })
      .filter((u): u is string => !!u)
    urls.forEach((u, i) => {
      setUrlByKey[`img${i + 1}`] = u
    })
  }

  // Text-first flavors for the "Flavor being inspected" dropdown — the ones
  // with an R1 chain step (same rule as the home page; no schema flag).
  const { data: r1Rows } = await supabase
    .from('humor_flavor_steps')
    .select('humor_flavor_id')
    .like('description', 'R1%')
  const textFirstIds = new Set((r1Rows ?? []).map((r) => r.humor_flavor_id as number))
  textFirstIds.add(flavorId)
  const { data: flavorRows } = await supabase
    .from('humor_flavors')
    .select('id, slug')
    .in('id', Array.from(textFirstIds))
    .order('id', { ascending: false })
  const inspectableFlavors = (flavorRows ?? []) as { id: number; slug: string }[]

  const runLabelOf = (r: RunRow) =>
    (r.label || r.study_image_set_slug || r.id.slice(0, 8)) +
    ' · ' +
    new Date(r.started_datetime_utc).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }) +
    (r.status !== 'done' ? ` · ${r.status}` : '')

  // Baseline RUN for the prompt diffs (?diff=<runId> | 'none'). Prompts get
  // edited between runs of the SAME flavor, so "what changed" is run-over-run:
  // this run's spec snapshot vs the baseline run's spec snapshot. Default
  // baseline = the run chronologically just before the inspected one.
  let diffRunId: string | null = null
  let diffSource: {
    label: string
    steps: { orderBy: number; description: string; systemPrompt: string; userPrompt: string }[]
  } | null = null
  if (diffParam !== 'none') {
    const idx = runs.findIndex((r) => r.id === runId)
    const explicit = diffParam ? runs.find((r) => r.id === diffParam && r.id !== runId) ?? null : null
    const baseline = explicit ?? (idx >= 0 ? runs[idx + 1] ?? null : null)
    if (baseline) {
      diffRunId = baseline.id
      diffSource = {
        label: runLabelOf(baseline),
        steps: (baseline.spec?.steps ?? []).map((s) => ({
          orderBy: s.orderBy,
          description: s.description ?? '',
          systemPrompt: s.systemPrompt ?? '',
          userPrompt: s.userPrompt ?? '',
        })),
      }
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      <div className="w-full px-6 pb-24">
        <div className="flex items-baseline gap-3 pt-6">
          <h1 className="text-2xl font-semibold">Text-first Flavor Inspector</h1>
          <Link
            className="ml-auto text-sm underline"
            href={`/humor-flavor/${flavorId}/ops-reverse`}
          >
            Reverse Flavor Maker (ops-reverse) →
          </Link>
        </div>
        <div className="flex flex-col items-start gap-2 pt-3">
          <FlavorSelect flavors={inspectableFlavors} currentId={flavorId} />
        </div>
        <OpsReverse2Client
          flavorId={flavorId}
          flavorSlug={flavor.slug as string}
          steps={steps}
          runs={runs.map((r) => ({ id: r.id, label: runLabelOf(r) }))}
          runId={runId}
          runLabel={
            selectedRun
              ? runLabelOf(selectedRun) +
                ' · started ' +
                new Date(selectedRun.started_datetime_utc).toLocaleString()
              : 'no archived reverse runs yet — run a chain or batch on the Reverse Flavor Maker (ops-reverse) page first'
          }
          specSteps={selectedRun?.spec?.steps ?? []}
          moments={moments}
          momentId={selMomentId}
          arch={arch}
          diffSource={diffSource}
          diffRunId={diffRunId}
          flavorIntent={(flavor.description as string | null) ?? ''}
          setUrlByKey={setUrlByKey}
        />
      </div>
    </div>
  )
}
