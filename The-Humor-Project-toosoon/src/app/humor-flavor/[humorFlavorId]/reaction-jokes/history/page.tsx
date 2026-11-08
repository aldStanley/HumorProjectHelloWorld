import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import { loadPovJokesData } from '../../pov-jokes/load-data'
import { loadStudentReadPrompt } from '../analysis-prompts'
import { loadEvaluatorPrompts } from '../evaluator-prompts'
import { loadPersonaPrompts } from '../persona-pov-prompts'
import HistoryClient from './history-client'

export const generateMetadata = flavorPageMetadata('reaction-jokes · past runs')

// The past runs of the Reaction Joke Maker: every run that left the working
// page. Read from the same browser record the working page writes.
export default async function ReactionJokesHistoryPage({ params }: { params: Promise<{ humorFlavorId: string }> }) {
  const { humorFlavorId } = await params
  const flavorId = Number.parseInt(humorFlavorId, 10)
  if (!Number.isFinite(flavorId)) {
    notFound()
  }

  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    redirect('/login')
  }

  const data = await loadPovJokesData(flavorId)
  if (!data) {
    notFound()
  }
  const { flavor, steps } = data
  // For the per-run copy button: the prompts as they are now.
  const personas = await loadPersonaPrompts()
  const evaluators = await loadEvaluatorPrompts()
  const studentRead = await loadStudentReadPrompt()

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
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">Reaction Joke Maker · past runs</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
              {flavor.slug}
            </span>
          </h1>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[rgb(var(--muted))]">
            <li>
              Every run that left the working page, newest first: replaced by a run as another persona or on
              other moments, re-run for the same source, or cleared.
            </li>
            <li>
              Each run is one persona on one list of moments, with its jokes from each source, their scores, and
              which ones are hearted. Nothing here is edited; a run can go back to the working page, or be deleted.
            </li>
            <li>This is the browser&rsquo;s own record. Another browser has its own past runs.</li>
          </ul>
        </div>

        <div className="mt-10">
          <HistoryClient
            flavorId={flavor.id}
            steps={steps}
            personas={personas}
            evaluators={evaluators}
            studentRead={studentRead}
          />
        </div>
      </div>
    </main>
  )
}
