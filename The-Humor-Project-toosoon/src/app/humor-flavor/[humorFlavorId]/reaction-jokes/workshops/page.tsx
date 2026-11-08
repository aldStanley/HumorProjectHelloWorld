import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import { loadPovJokesData } from '../../pov-jokes/load-data'
import WorkshopsClient, { type SavedWorkshop } from './workshops-client'

export const generateMetadata = flavorPageMetadata('reaction-jokes/workshops')

// The saved workshop chats of one flavor, from the database (Lydia,
// 2026-09-09: "create a page for me to view the blobs"). Read-only:
// selection on the left (which conversation), the conversation on the right.
export default async function WorkshopsPage({ params }: { params: Promise<{ humorFlavorId: string }> }) {
  const { humorFlavorId } = await params
  const flavorId = Number.parseInt(humorFlavorId, 10)
  if (!Number.isFinite(flavorId)) notFound()

  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) redirect('/login')

  const data = await loadPovJokesData(flavorId)
  if (!data) notFound()
  const { flavor } = data

  const { data: rows, error } = await supabase
    .from('reaction_joke_workshops')
    .select(
      'id, persona, moment, joke, joke_key, analysis, messages, hearted, model, reasoning_effort, created_datetime_utc, modified_datetime_utc'
    )
    .eq('flavor_id', flavorId)
    .order('modified_datetime_utc', { ascending: false })

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex w-full flex-1 flex-col px-6 py-12">
        <div className="max-w-3xl space-y-3">
          <Link
            href={`/humor-flavor/${flavor.id}/reaction-jokes`}
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
          >
            Back to the Reaction Joke Maker
          </Link>
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">Saved workshop chats</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
              {flavor.slug}
            </span>
          </h1>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[rgb(var(--muted))]">
            <li>Every conversation the workshop pane saved to the database for this flavor, newest first.</li>
            <li>
              Pick a conversation on the left. On the right: the joke, its moment and analysis at the time, the
              rewrites hearted from the chat with what was asked for, then every turn.
            </li>
            <li>
              Read-only. The same rows come out as files with{' '}
              <code>node scripts/reaction-jokes-workshops-export.mjs --flavor {flavor.id}</code>.
            </li>
          </ul>
        </div>
        <div className="mt-10">
          {error ? (
            <p className="max-w-3xl text-sm text-red-700 dark:text-red-400">
              Could not read the saved chats: {error.message}. If the table does not exist yet, run
              supabase/migrations/20260909000000_reaction_joke_workshops.sql in the Supabase SQL editor.
            </p>
          ) : (
            <WorkshopsClient rows={(rows ?? []) as SavedWorkshop[]} />
          )}
        </div>
      </div>
    </main>
  )
}
