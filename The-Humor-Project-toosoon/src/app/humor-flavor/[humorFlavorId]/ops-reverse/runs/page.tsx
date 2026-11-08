import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import { namesByProfileId } from '../../ops/who-ran-it'
import CancelRunButton from '../../ops/runs/cancel-run-button'

// The reverse-side run list: archived ops_runs rows written by the
// Reverse Flavor Maker (spec.surface === 'ops-reverse'). One row per chain or
// study batch; the archived unit inside each run is a MOMENT. Rows link into
// the Reverse Flavor Inspector (ops-reverse2) for the per-moment trace, plus
// the raw prompt record.

type RunRow = {
  id: string
  label: string | null
  status: string
  image_count: number | null
  caption_count: number | null
  export_warning: string | null
  study_image_set_slug: string | null
  profile_id: string | null
  started_datetime_utc: string
  finished_datetime_utc: string | null
}

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—'

const statusChip = (status: string) => {
  const tone =
    status === 'done'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : status === 'running'
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
  return `rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`
}

export const generateMetadata = flavorPageMetadata('ops-reverse/runs')

export default async function OpsReverseRunsPage({
  params,
}: {
  params: Promise<{ humorFlavorId: string }>
}) {
  const { humorFlavorId } = await params
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

  const { data: runRows, error: runError } = await supabase
    .from('ops_runs')
    .select(
      'id, label, status, image_count, caption_count, export_warning, study_image_set_slug, profile_id, started_datetime_utc, finished_datetime_utc'
    )
    .eq('humor_flavor_id', flavor.id)
    .eq('spec->>surface', 'ops-reverse')
    .order('started_datetime_utc', { ascending: false })
    .limit(200)
  const runs = (runRows ?? []) as RunRow[]
  const names = await namesByProfileId(
    supabase,
    runs.map((r) => r.profile_id)
  )

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex w-full flex-1 flex-col px-4 py-5">
        <div className="max-w-3xl space-y-1.5">
          <Link
            href={`/humor-flavor/${flavor.id}/ops-reverse`}
            className="inline-flex items-center gap-1 text-sm text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
          >
            ← Back to Reverse Flavor Maker
          </Link>
          <h1 className="text-xl font-semibold text-[rgb(var(--headline-accent-strong))]">
            Reverse runs — {flavor.slug}
          </h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            Every archived reverse (context → image) chain and study batch: one
            unit per moment, with the prompts exactly as sent and every model
            call&rsquo;s output. Open a run to see all its answers grouped by
            moment, or jump to the Reverse Flavor Inspector for the per-moment
            trace.
          </p>
          <p className="text-xs text-[rgb(var(--muted))]">
            Image-first runs live on the{' '}
            <Link
              href={`/humor-flavor/${flavor.id}/ops/runs`}
              className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
            >
              image-first run list
            </Link>
            .
          </p>
        </div>

        <div className="mt-4 max-w-4xl">
          {runError ? (
            <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">
              {runError.message}
              {' — '}the ops_runs tables may not exist yet; run{' '}
              <code>supabase/migrations/20260731000000_ops_runs.sql</code> in the
              Supabase SQL editor.
            </p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-[rgb(var(--muted))]">
              No reverse runs yet. Check some moments on the Reverse Flavor
              Maker and run the chain.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[rgb(var(--gloss)/0.5)] dark:border-[rgb(var(--gloss)/0.15)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[rgb(var(--panel)/0.6)] text-[11px] font-medium text-[rgb(var(--muted))]">
                  <tr>
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2">Run</th>
                    <th className="px-3 py-2">Ran by</th>
                    <th className="px-3 py-2">Set</th>
                    <th className="px-3 py-2 text-right">Moments</th>
                    <th className="px-3 py-2 text-right">Captions</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Results</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      className="border-t border-[rgb(var(--gloss)/0.3)] hover:bg-[rgb(var(--panel)/0.5)] dark:border-[rgb(var(--gloss)/0.1)]"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-[12px] text-[rgb(var(--muted))]">
                        {fmt(run.started_datetime_utc)}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/humor-flavor/${flavor.id}/ops-reverse/runs/${run.id}`}
                          title="All answers, grouped by moment"
                          className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                        >
                          {run.label ?? run.id.slice(0, 8)}
                        </Link>
                        {run.export_warning ? (
                          <span title={run.export_warning} className="ml-1">
                            ⚠
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[12px] text-[rgb(var(--muted))]">
                        {run.profile_id
                          ? names.get(run.profile_id) ?? run.profile_id.slice(0, 8)
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-[rgb(var(--muted))]">
                        {run.study_image_set_slug ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-[12px]">
                        {run.image_count ?? 0}
                      </td>
                      <td className="px-3 py-2 text-right text-[12px]">
                        {run.caption_count ?? 0}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={statusChip(run.status)}>{run.status}</span>
                        {run.status === 'running' ? (
                          <span className="ml-1.5">
                            <CancelRunButton runId={run.id} />
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link
                          href={`/humor-flavor/${flavor.id}/ops-reverse2?run=${run.id}`}
                          title="Open in the Reverse Flavor Inspector"
                          className="text-[12px] font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                        >
                          🔬 Inspector
                        </Link>
                        <Link
                          href={`/humor-flavor/${flavor.id}/ops/runs/${run.id}`}
                          title="The raw prompt record: every call exactly as sent"
                          className="ml-2 text-[12px] font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                        >
                          📜 Full record
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
