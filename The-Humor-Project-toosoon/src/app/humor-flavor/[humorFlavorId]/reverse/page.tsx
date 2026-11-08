import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import { loadReverseData } from './load-data'
import ReverseClient from './reverse-client'

export const generateMetadata = flavorPageMetadata('reverse')

export default async function HumorFlavorReversePage({
  params,
  searchParams,
}: {
  params: Promise<{ humorFlavorId: string }>
  searchParams: Promise<{ set?: string }>
}) {
  const { humorFlavorId } = await params
  const { set } = await searchParams
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

  const data = await loadReverseData(flavorId, set)
  if (!data) {
    notFound()
  }
  const {
    flavor,
    steps,
    imageSets,
    initialSetId,
    contexts,
    profiles,
    profilesTableMissing,
  } = data

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex w-full flex-1 flex-col px-6 py-12">
        <div className="max-w-3xl space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href={`/humor-flavor/${flavor.id}`}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
            >
              Back to flavor
            </Link>
            <Link
              href={`/humor-flavor/${flavor.id}/ops-reverse${initialSetId ? `?set=${initialSetId}` : ''}`}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-[rgb(var(--accent-strong))] transition hover:brightness-110"
            >
              Reverse Flavor Maker (ops-reverse) →
            </Link>
          </div>
          <p className="text-xs uppercase tracking-[0.4em] text-[rgb(var(--muted))]">
            Reverse (context → image)
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
              {flavor.slug}
            </span>
          </h1>
          <p className="text-sm text-[rgb(var(--muted))]">
            The inverted pipeline: give it ONE community moment and it finds
            the reaction images that can host it. Steps P1–P4 preprocess each
            image once (cached as reaction profiles); R1–R4 run per moment:
            analyze the moment, select images by emotional alignment, write
            captions per image, rank across images.
          </p>
        </div>

        <div className="mt-8">
          <ReverseClient
            flavorId={flavor.id}
            flavorSlug={flavor.slug}
            steps={steps}
            imageSets={imageSets}
            contexts={contexts}
            initialProfiles={profiles}
            profilesTableMissing={profilesTableMissing}
            initialSetId={initialSetId}
          />
        </div>
      </div>
    </main>
  )
}
