import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import Ops2Client from './ops2-client'
import type { ArchStep, DbStep } from './trace-lib'

export const dynamic = 'force-dynamic'

type RunRow = {
  id: string
  label: string | null
  status: string
  study_image_set_id: number | null
  study_image_set_slug: string | null
  started_datetime_utc: string
  caption_count: number | null
}

export const generateMetadata = flavorPageMetadata('ops2')

export default async function Ops2Page({
  params,
  searchParams,
}: {
  params: Promise<{ humorFlavorId: string }>
  searchParams: Promise<{ run?: string; image?: string; set?: string }>
}) {
  const { humorFlavorId } = await params
  const { run: runParam, image: imageParam, set: setParam } = await searchParams
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
    .select('id, slug')
    .eq('id', flavorId)
    .maybeSingle()
  if (!flavor) notFound()

  // Current DB prompts — the editable source of truth (traces show the
  // archived prompts; a drift badge appears when these differ).
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
    (modelRows ?? []).map((m) => [m.id as number, m as { provider_model_id: string; is_temperature_supported: boolean }])
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

  // Archived runs for the picker (newest first).
  const { data: runRows } = await supabase
    .from('ops_runs')
    .select('id, label, status, study_image_set_id, study_image_set_slug, started_datetime_utc, caption_count')
    .eq('humor_flavor_id', flavorId)
    .order('started_datetime_utc', { ascending: false })
    .limit(25)
  const runs = (runRows ?? []) as RunRow[]
  // ops-style ?set= is honored as a filter: prefer the newest run of that set.
  const setId = setParam ? Number.parseInt(setParam, 10) : NaN
  const setDefault = Number.isFinite(setId) ? runs.find((r) => r.study_image_set_id === setId)?.id : undefined
  const runId =
    runParam && runs.some((r) => r.id === runParam) ? runParam : setDefault ?? runs[0]?.id ?? null

  let images: { runImageId: string; imageId: string; imageUrl: string | null }[] = []
  let arch: ArchStep[] = []
  let imageId: string | null = null
  let imageUrl: string | null = null
  let additionalContext: string | null = null
  if (runId) {
    const { data: imgRows } = await supabase
      .from('ops_run_images')
      .select('id, image_id, image_url, position')
      .eq('ops_run_id', runId)
      .order('position')
    images = (imgRows ?? []).map((r) => ({
      runImageId: r.id as string,
      imageId: r.image_id as string,
      imageUrl: r.image_url as string | null,
    }))
    const sel = images.find((i) => i.imageId === imageParam) ?? images[0]
    if (sel) {
      imageId = sel.imageId
      imageUrl = sel.imageUrl
      const [{ data: stepArch }, { data: imgRow }] = await Promise.all([
        supabase
          .from('ops_run_steps')
          .select(
            'op_key, op_title, step_order_by, provider_model_id, include_image, system_prompt, user_prompt, prior_outputs, output, error, position'
          )
          .eq('ops_run_image_id', sel.runImageId)
          .order('position'),
        supabase.from('images').select('additional_context').eq('id', sel.imageId).maybeSingle(),
      ])
      additionalContext = (imgRow?.additional_context as string | null) ?? null
      arch = (stepArch ?? []).map((r) => ({
        opKey: r.op_key as string,
        opTitle: r.op_title as string | null,
        stepOrderBy: r.step_order_by as number | null,
        providerModelId: r.provider_model_id as string | null,
        includeImage: r.include_image as boolean | null,
        systemPrompt: r.system_prompt as string | null,
        userPrompt: r.user_prompt as string | null,
        priorOutputs: (r.prior_outputs as Record<string, string> | null) ?? null,
        output: r.output as string | null,
        error: r.error as string | null,
      }))
    }
  }

  // No archived run image for this selection? Still resolve the image row so a
  // localStorage-loaded (unarchived) run can show the picture and context.
  if (!imageId && imageParam) {
    const { data: imgRow } = await supabase
      .from('images')
      .select('id, url, additional_context')
      .eq('id', imageParam)
      .maybeSingle()
    if (imgRow) {
      imageId = imgRow.id as string
      imageUrl = imgRow.url as string | null
      additionalContext = (imgRow.additional_context as string | null) ?? null
    }
  }

  const selectedRun = runs.find((r) => r.id === runId) ?? null

  return (
    <div className="min-h-screen">
      <AppHeader />
      <div className="w-full px-6 pb-24">
        <div className="flex items-baseline gap-3 pt-6">
          <h1 className="text-2xl font-semibold">Flavor Inspector (ops2) · trace workbench</h1>
          <span className="text-sm opacity-60">
            {flavor.slug} ({flavorId})
          </span>
          <Link className="ml-auto text-sm underline" href={`/humor-flavor/${flavorId}/ops`}>
            Flavor Maker (ops) →
          </Link>
        </div>
        <Ops2Client
          flavorId={flavorId}
          flavorSlug={flavor.slug as string}
          setId={selectedRun?.study_image_set_id ?? null}
          setSlug={selectedRun?.study_image_set_slug ?? null}
          steps={steps}
          runs={runs.map((r) => ({
            id: r.id,
            label:
              (r.label || r.study_image_set_slug || r.id.slice(0, 8)) +
              ' · ' +
              new Date(r.started_datetime_utc).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              }) +
              (r.status !== 'finished' ? ` · ${r.status}` : ''),
          }))}
          runId={runId}
          runLabel={
            selectedRun
              ? (selectedRun.label || selectedRun.study_image_set_slug || selectedRun.id.slice(0, 8)) +
                ' · started ' +
                new Date(selectedRun.started_datetime_utc).toLocaleString()
              : 'no archived runs yet — run the pipeline from the Flavor Maker (ops) page first'
          }
          images={images.map((i) => ({ imageId: i.imageId, imageUrl: i.imageUrl }))}
          imageId={imageId}
          imageUrl={imageUrl}
          additionalContext={additionalContext}
          arch={arch}
        />
      </div>
    </div>
  )
}
