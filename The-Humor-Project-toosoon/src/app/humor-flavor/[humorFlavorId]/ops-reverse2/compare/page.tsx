import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import CompareClient from './compare-client'

export const dynamic = 'force-dynamic'

type RunRow = {
  id: string
  label: string | null
  status: string
  study_image_set_slug: string | null
  started_datetime_utc: string
}

// ops-reverse2/compare — before/after board for two archived reverse runs of
// the same flavor: each moment's ranked OUTPUTS side by side, matched by
// moment text. Traces stay on the Reverse Flavor Inspector (ops-reverse2).
export const generateMetadata = flavorPageMetadata('ops-reverse2/compare')

export default async function OpsReverse2ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ humorFlavorId: string }>
  searchParams: Promise<{ a?: string; b?: string }>
}) {
  const { humorFlavorId } = await params
  const { a: aParam, b: bParam } = await searchParams
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

  const { data: runRows } = await supabase
    .from('ops_runs')
    .select('id, label, status, study_image_set_slug, started_datetime_utc')
    .eq('humor_flavor_id', flavorId)
    .eq('spec->>surface', 'ops-reverse')
    .order('started_datetime_utc', { ascending: false })
    .limit(25)
  const runs = (runRows ?? []) as RunRow[]

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

  // Defaults: A = newest run, B = unset until picked.
  const aId = aParam && runs.some((r) => r.id === aParam) ? aParam : runs[0]?.id ?? null
  const bId = bParam && bParam !== aId && runs.some((r) => r.id === bParam) ? bParam : null

  const momentsOf = async (runId: string) => {
    const { data } = await supabase
      .from('ops_run_images')
      .select('id, position, status, error, outputs')
      .eq('ops_run_id', runId)
      .order('position')
    return (data ?? []).map((r) => ({
      runImageId: r.id as string,
      position: r.position as number,
      status: r.status as string,
      error: (r.error as string | null) ?? null,
      moment: String((r.outputs as Record<string, unknown>)?.momentInput ?? ''),
      outputs: (r.outputs as Record<string, unknown>) ?? {},
    }))
  }
  const [aMoments, bMoments] = await Promise.all([
    aId ? momentsOf(aId) : Promise.resolve([]),
    bId ? momentsOf(bId) : Promise.resolve([]),
  ])

  return (
    <div className="min-h-screen">
      <AppHeader />
      <div className="w-full px-6 pb-24">
        <div className="flex items-baseline gap-3 pt-6">
          <h1 className="text-2xl font-semibold">
            Compare two Text-first Caption Batches
          </h1>
          <span className="text-sm opacity-60">
            {flavor.slug} ({flavorId})
          </span>
          <Link
            className="ml-auto text-sm underline"
            href={`/humor-flavor/${flavorId}/ops-reverse2${aId ? `?run=${aId}` : ''}`}
          >
            ← back to the trace workbench (ops-reverse2)
          </Link>
        </div>
        <p className="max-w-3xl pt-1 text-sm opacity-60">
          Each moment&apos;s ranked outputs from two archived runs, side by side, matched by
          moment text — for eyeballing whether a change moved the outputs. For the full
          step-by-step trace of a run, use the trace workbench.
        </p>
        <CompareClient
          runs={runs.map((r) => ({ id: r.id, label: runLabelOf(r) }))}
          aId={aId}
          bId={bId}
          aMoments={aMoments}
          bMoments={bMoments}
        />
      </div>
    </div>
  )
}
