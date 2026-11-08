import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import {
  quickStudyRows,
  type GalleryItem,
  type QuickStudyRow,
} from '../../export-format'
import { namesByProfileId } from '../../who-ran-it'
import GalleryView from '../gallery-view'

type ImageRow = {
  image_id: string | null
  image_url: string | null
  position: number | null
  status: string
  error: string | null
  captions: unknown
}

// The images-and-captions view of ONE saved run, read from the database. Unlike
// the bare /ops/gallery page (which shows whatever this browser last ran), this
// has a URL that can be linked to and survives clearing localStorage.
export const generateMetadata = flavorPageMetadata('ops/gallery')

export default async function OpsRunGalleryPage({
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

  const { data: run } = await supabase
    .from('ops_runs')
    .select(
      'id, flavor_slug, label, status, export_json, export_warning, study_image_set_slug, profile_id, started_datetime_utc'
    )
    .eq('id', runId)
    .maybeSingle()
  if (!run) notFound()

  const { data: imageRows } = await supabase
    .from('ops_run_images')
    .select('image_id, image_url, position, status, error, captions')
    .eq('ops_run_id', runId)
    .order('position', { ascending: true })

  // One card per image the run ATTEMPTED — the rows in this table include the
  // images that produced nothing, which the export alone can never show.
  const items: GalleryItem[] = ((imageRows ?? []) as ImageRow[]).map((i) => {
    const captions = Array.isArray(i.captions) ? (i.captions as string[]) : []
    return {
      imageId: i.image_id ?? i.image_url ?? '',
      imageUrl: i.image_url ?? '',
      captions,
      problem: captions.length ? null : i.error,
    }
  })

  const flavorSlug = (run.flavor_slug as string | null) ?? String(flavorId)
  const setSlug = (run.study_image_set_slug as string | null) ?? null

  // export_json is what the batch actually exported. Rebuild it from the saved
  // captions only when it's missing — an older or interrupted run.
  const rows: QuickStudyRow[] = Array.isArray(run.export_json)
    ? (run.export_json as QuickStudyRow[])
    : items.flatMap((i) =>
        quickStudyRows(i.captions, {
          imageUrl: i.imageUrl,
          flavorId,
          flavorName: flavorSlug,
          userId: (run.profile_id as string | null) ?? '',
        })
      )

  const started = new Date(run.started_datetime_utc as string).toLocaleString()
  const profileId = (run.profile_id as string | null) ?? null
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
              href={`/humor-flavor/${flavorId}/ops/runs/${runId}`}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
            >
              Prompts &amp; steps
            </Link>
          </div>
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
            {setSlug ?? 'batch run'} · {started}
            {ranBy ? ` · ran by ${ranBy}` : ''}
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
              {(run.label as string | null) ?? 'Images & captions'}
            </span>
          </h1>
          {run.export_warning ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[12px] text-amber-700 dark:text-amber-400">
              ⚠ {run.export_warning as string}
            </p>
          ) : null}
        </div>

        <div className="mt-8 max-w-4xl">
          <GalleryView
            items={items}
            rows={rows}
            subtitle={started}
            downloadName={`${flavorSlug}-${setSlug ?? 'set'}-quick-study`}
          />
        </div>
      </div>
    </main>
  )
}
