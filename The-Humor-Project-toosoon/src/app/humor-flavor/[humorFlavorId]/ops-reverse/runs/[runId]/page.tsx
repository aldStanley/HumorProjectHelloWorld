import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import { namesByProfileId } from '../../../ops/who-ran-it'

import ReverseRunAnswers, {
  type AnswerMoment,
  type AnswerResult,
} from './run-answers'

// The simple answers view for a reverse run: one card per MOMENT (the
// archived unit of a reverse run), each listing its ranked image+caption
// answers. The full prompt record for the same run lives on
// /ops/runs/[runId]; the per-moment trace on /ops-reverse2?run=.

type MomentRow = {
  id: string
  image_id: string | null
  image_url: string | null
  position: number | null
  status: string
  error: string | null
  captions: unknown
  outputs: unknown
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length ? v : null
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

// Normalize one archived result. Batch runs store BatchResult rows
// (imageUrl/rank/entity); single-moment runs store {image_key, caption} only,
// so missing fields fall back to the R2 picks (entity, alignment) and, for
// the top pick, the row's archived image.
function normalizeResult(
  raw: Record<string, unknown>,
  index: number,
  row: MomentRow,
  pickByKey: Map<string, Record<string, unknown>>
): AnswerResult | null {
  const caption = str(raw.caption)
  if (!caption) return null
  const pick = pickByKey.get(str(raw.image_key) ?? str(raw.imageKey) ?? '')
  return {
    rank: num(raw.rank) ?? index + 1,
    caption,
    entity: str(raw.entity) ?? (pick ? str(pick.entity) : null),
    emotionalAlignment:
      num(raw.emotionalAlignment) ??
      num(raw.emotional_alignment) ??
      (pick ? num(pick.emotional_alignment) : null),
    imageId:
      str(raw.imageId) ??
      str(raw.image_id) ??
      (index === 0 ? row.image_id : null),
    imageUrl:
      str(raw.imageUrl) ??
      str(raw.image_url) ??
      (index === 0 ? row.image_url : null),
  }
}

function toMoment(row: MomentRow, modelCalls: number): AnswerMoment {
  const outputs = (row.outputs ?? {}) as Record<string, unknown>
  const picks = Array.isArray(outputs.picks) ? outputs.picks : []
  const pickByKey = new Map<string, Record<string, unknown>>()
  picks.forEach((p) => {
    if (p && typeof p === 'object') {
      const key = str((p as Record<string, unknown>).image_key)
      if (key) pickByKey.set(key, p as Record<string, unknown>)
    }
  })

  const rawResults = Array.isArray(outputs.results) ? outputs.results : []
  let results = rawResults
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r, i) => normalizeResult(r, i, row, pickByKey))
    .filter((r): r is AnswerResult => r !== null)
  if (!results.length && Array.isArray(row.captions)) {
    results = (row.captions as unknown[])
      .filter((c): c is string => typeof c === 'string')
      .map((caption, i) => ({
        rank: i + 1,
        caption,
        entity: null,
        emotionalAlignment: null,
        imageId: i === 0 ? row.image_id : null,
        imageUrl: i === 0 ? row.image_url : null,
      }))
  }

  return {
    id: row.id,
    position: row.position ?? 0,
    moment: str(outputs.momentInput),
    status: row.status,
    error: row.error,
    noFit: outputs.noFit === true,
    modelCalls,
    results,
  }
}

export const generateMetadata = flavorPageMetadata('ops-reverse/runs')

export default async function OpsReverseRunPage({
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
      'id, flavor_slug, label, status, image_count, caption_count, study_image_set_slug, profile_id, started_datetime_utc'
    )
    .eq('id', runId)
    .maybeSingle()
  if (!runRow) notFound()

  const { data: momentRows } = await supabase
    .from('ops_run_images')
    .select('id, image_id, image_url, position, status, error, captions, outputs')
    .eq('ops_run_id', runId)
    .order('position', { ascending: true })

  const { data: stepRows } = await supabase
    .from('ops_run_steps')
    .select('id, ops_run_image_id')
    .eq('ops_run_id', runId)

  const callsByMoment = new Map<string, number>()
  ;(stepRows ?? []).forEach((s) => {
    const id = s.ops_run_image_id as string | null
    if (id) callsByMoment.set(id, (callsByMoment.get(id) ?? 0) + 1)
  })

  const moments = ((momentRows ?? []) as MomentRow[]).map((row) =>
    toMoment(row, callsByMoment.get(row.id) ?? 0)
  )
  const captionCount =
    (runRow.caption_count as number | null) ??
    moments.reduce((n, m) => n + m.results.length, 0)

  const exportJson = moments.map((m) => ({
    moment: m.moment,
    status: m.status,
    no_fit: m.noFit,
    error: m.error,
    results: m.results.map((r) => ({
      rank: r.rank,
      caption: r.caption,
      entity: r.entity,
      emotional_alignment: r.emotionalAlignment,
      image_id: r.imageId,
      image_url: r.imageUrl,
    })),
  }))

  const profileId = (runRow.profile_id as string | null) ?? null
  const ranBy = (await namesByProfileId(supabase, [profileId])).get(
    profileId ?? ''
  )

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex w-full flex-1 flex-col px-4 py-5">
        <div className="max-w-3xl space-y-1.5">
          <div className="flex flex-wrap gap-4">
            <Link
              href={`/humor-flavor/${flavorId}/ops-reverse/runs`}
              className="inline-flex items-center gap-1 text-sm text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
            >
              ← All runs
            </Link>
            <Link
              href={`/humor-flavor/${flavorId}/ops-reverse2?run=${runId}`}
              className="inline-flex items-center gap-1 text-sm text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
            >
              Inspector trace
            </Link>
            <Link
              href={`/humor-flavor/${flavorId}/ops/runs/${runId}`}
              className="inline-flex items-center gap-1 text-sm text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
            >
              Full record
            </Link>
          </div>
          <h1 className="text-xl font-semibold text-[rgb(var(--headline-accent-strong))]">
            {(runRow.label as string | null) ?? (runRow.flavor_slug as string)} ·{' '}
            {moments.length} moment{moments.length === 1 ? '' : 's'}
          </h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            {(runRow.study_image_set_slug as string | null) ?? 'text-first run'}{' '}
            · {new Date(runRow.started_datetime_utc as string).toLocaleString()}
            {ranBy ? ` · ran by ${ranBy}` : ''}
          </p>
        </div>

        <div className="mt-4 max-w-4xl">
          <ReverseRunAnswers
            run={{
              id: runRow.id as string,
              label: (runRow.label as string | null) ?? null,
              momentCount: moments.length,
              captionCount,
              exportJson,
            }}
            moments={moments}
          />
        </div>
      </div>
    </main>
  )
}
