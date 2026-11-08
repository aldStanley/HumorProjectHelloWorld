import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

// The loader is shared with /pov-jokes: both surfaces need exactly the flavor
// and its steps, and nothing about it is specific to either pipeline.
import { loadPovJokesData } from '../pov-jokes/load-data'
import PersonaFunnelClient from './persona-funnel-client'

export const generateMetadata = flavorPageMetadata('persona-funnel')

export default async function PersonaFunnelPage({
  params,
}: {
  params: Promise<{ humorFlavorId: string }>
}) {
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

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex w-full flex-1 flex-col px-6 py-12">
        <div className="max-w-3xl space-y-3">
          <Link
            href={`/humor-flavor/${flavor.id}`}
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
          >
            Back to flavor
          </Link>
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
            Persona Premise Funnel (moment → premises → captions)
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
              {flavor.slug}
            </span>
          </h1>
          <p className="text-sm leading-relaxed text-[rgb(var(--muted))]">
            Give this page one campus moment and nothing else. Step 1 runs it
            through a funnel: it breaks the event into individual moments, scans
            a roster of personas cheaply against every one of them, expands only
            the strong pairings, and turns those into separate comic premises —
            throwing away the ones that turn out to be the same joke worded
            differently. What comes back is three to five distinct premises per
            persona. Step 2 then writes five captions executing ONE premise, and
            runs only on the premises you check: step 1 returns far more than
            you want to run at once.
          </p>
          <p className="text-sm leading-relaxed text-[rgb(var(--muted))]">
            This is a sibling of the POV Joke Maker, not a replacement for it —
            there the unit of work is a persona, here it is a premise, which is
            the thing being tested.
          </p>
        </div>

        <div className="mt-10">
          <PersonaFunnelClient flavorId={flavor.id} steps={steps} />
        </div>
      </div>
    </main>
  )
}
