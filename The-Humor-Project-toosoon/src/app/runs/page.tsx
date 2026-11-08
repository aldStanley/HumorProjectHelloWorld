import { pageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import CancelRunButton from '../humor-flavor/[humorFlavorId]/ops/runs/cancel-run-button'
import { namesByProfileId } from '../humor-flavor/[humorFlavorId]/ops/who-ran-it'

// The global run archive: every archived run across all flavors, newest
// first — image-first (ops) batches and single runs, and text-first
// (ops-reverse) chains and study batches. Each row links into the per-flavor
// results page with the full prompt record.

type RunRow = {
  id: string
  humor_flavor_id: number
  flavor_slug: string | null
  label: string | null
  status: string
  image_count: number | null
  caption_count: number | null
  export_warning: string | null
  study_image_set_slug: string | null
  profile_id: string | null
  started_datetime_utc: string
  finished_datetime_utc: string | null
  surface: string | null
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

// Run labels start with the flavor slug ("<slug> · reverse study · 3
// moments"); the slug is noise here, so show only what comes after it.
const shortLabel = (run: RunRow) => {
  if (!run.label) return run.id.slice(0, 8)
  const prefix = `${run.flavor_slug} · `
  return run.label.startsWith(prefix)
    ? run.label.slice(prefix.length)
    : run.label
}

const statusChip = (status: string) => {
  const tone =
    status === 'done'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : status === 'running'
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
  return `rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`
}

export const metadata = pageMetadata('runs')

export default async function GlobalRunsPage() {
  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const { data: runRows, error: runError } = await supabase
    .from('ops_runs')
    .select(
      'id, humor_flavor_id, flavor_slug, label, status, image_count, caption_count, export_warning, study_image_set_slug, profile_id, started_datetime_utc, finished_datetime_utc, surface:spec->>surface'
    )
    .order('started_datetime_utc', { ascending: false })
    .limit(300)
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
          <h1 className="text-xl font-semibold text-[rgb(var(--headline-accent-strong))]">
            Run archive
          </h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            All flavors — image-first batches and single runs, and text-first
            (context → image) chains and study batches. Click a run for its
            results, with the prompts exactly as sent and every model
            call&rsquo;s output.
          </p>
        </div>

        <div className="mt-4 max-w-6xl">
          {runError ? (
            <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">
              {runError.message}
              {' — '}the ops_runs tables may not exist yet; run{' '}
              <code>supabase/migrations/20260731000000_ops_runs.sql</code> in the
              Supabase SQL editor.
            </p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-[rgb(var(--muted))]">
              No archived runs yet. Any run on an ops or ops-reverse page will
              show up here.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[rgb(var(--gloss)/0.5)] dark:border-[rgb(var(--gloss)/0.15)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[rgb(var(--panel)/0.6)] text-[11px] font-medium text-[rgb(var(--muted))]">
                  <tr>
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2 text-right">Flavor</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Run</th>
                    <th className="px-3 py-2">Ran by</th>
                    <th className="px-3 py-2">Set</th>
                    <th className="px-3 py-2 text-right">Units</th>
                    <th className="px-3 py-2 text-right">Captions</th>
                    <th className="px-3 py-2">Status</th>
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
                      <td className="whitespace-nowrap px-3 py-2 text-right text-[12px]">
                        <Link
                          href={`/humor-flavor/${run.humor_flavor_id}`}
                          className="text-[rgb(var(--accent-strong))] hover:underline"
                          title={run.flavor_slug ?? 'Flavor detail page'}
                        >
                          {run.humor_flavor_id}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[12px] text-[rgb(var(--muted))]">
                        {run.surface === 'ops-reverse' ? 'text first' : 'image first'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link
                          href={
                            run.surface === 'ops-reverse'
                              ? `/humor-flavor/${run.humor_flavor_id}/ops-reverse/runs/${run.id}`
                              : `/humor-flavor/${run.humor_flavor_id}/ops/runs/${run.id}`
                          }
                          title={
                            run.surface === 'ops-reverse'
                              ? 'All answers, grouped by moment'
                              : 'Full run report'
                          }
                          className="font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                        >
                          {shortLabel(run)}
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
                      <td
                        className="px-3 py-2 text-right text-[12px]"
                        title="Images for image-first runs, moments for text-first runs"
                      >
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
