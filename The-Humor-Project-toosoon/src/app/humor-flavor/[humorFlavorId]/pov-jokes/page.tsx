import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import { loadPovJokesData } from './load-data'
import PovJokesClient from './pov-jokes-client'

export const generateMetadata = flavorPageMetadata('pov-jokes')

export default async function PovJokesPage({
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
            POV Joke Maker (moment → points of view → jokes)
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
              {flavor.slug}
            </span>
          </h1>
          <p className="text-sm leading-relaxed text-[rgb(var(--muted))]">
            Give this page one campus moment and nothing else. Step 1 works out
            which points of view are worth joking from — scoring a recurring
            persona library against the moment and inventing roles the moment
            itself creates. Step 2 then writes jokes from ONE point of view, and
            runs only on the points of view you check: step 1 usually returns
            more than you want to run at once.
          </p>
        </div>

        <div className="mt-10">
          <PovJokesClient flavorId={flavor.id} steps={steps} />
        </div>
      </div>
    </main>
  )
}
