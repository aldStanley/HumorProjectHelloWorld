import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

import type { FlavorNote } from '../actions'
import FlavorHeart from '../flavor-heart'
import FlavorNotes from '../flavor-notes'
import { loadReverseData } from '../reverse/load-data'

import OpsReverseClient from './ops-reverse-client'

// Normal-case pill links for the page-top nav — no uppercase, no letterspacing.
const navLink =
  'inline-flex items-center gap-1.5 rounded-lg border border-[rgb(var(--gloss)/0.6)] px-3 py-1.5 text-sm font-medium transition hover:border-[rgb(var(--primary))] hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.2)]'

// ops-reverse: the ops-style workbench for reverse (context → image) flavors,
// focused on the per-moment R-steps. Preprocessing (P-steps) and the batch
// runner live on /reverse.
export const generateMetadata = flavorPageMetadata('ops-reverse')

export default async function HumorFlavorOpsReversePage({
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

  // The current user's heart for this flavor (shared with the flavor page).
  const { data: favoriteRow } = await supabase
    .from('humor_flavor_favorites')
    .select('is_favorite')
    .eq('flavor_id', flavor.id)
    .eq('profile_id', user.id)
    .maybeSingle()

  // Append-only notes log (missing-table safe: falls back to an empty log).
  const { data: noteRows } = await supabase
    .from('humor_flavor_notes')
    .select('id, body, created_datetime_utc')
    .eq('flavor_id', flavor.id)
    .order('created_datetime_utc', { ascending: false })
  const notes: FlavorNote[] = (
    (noteRows ?? []) as { id: number; body: string; created_datetime_utc: string }[]
  ).map((n) => ({ id: n.id, body: n.body, createdAt: n.created_datetime_utc }))

  const { data: models } = await supabase.from('llm_models')
    .select('id, name, provider_model_id, is_temperature_supported').order('name')

  return (
    <main className="relative flex min-h-screen flex-col">
      <AppHeader />
      <div className="flex w-full flex-1 flex-col px-6 py-8">
        {/* Header + notes log side by side (stacked on narrow screens). */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="max-w-3xl flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/humor-flavor/${flavor.id}`} className={navLink}>
                ← Back to flavor
              </Link>
              <Link
                href={`/humor-flavor/${flavor.id}/reverse${initialSetId ? `?set=${initialSetId}` : ''}`}
                className={navLink}
              >
                Preprocess + batch
              </Link>
              <Link
                href={`/humor-flavor/${flavor.id}/ops-reverse2`}
                className={navLink}
              >
                Reverse Flavor Inspector
              </Link>
            </div>
            <p className="text-sm font-medium text-[rgb(var(--muted))]">
              Reverse Flavor Maker · context → image
            </p>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold sm:text-3xl">
                <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
                  {flavor.slug}
                </span>
              </h1>
              <FlavorHeart
                flavorId={flavor.id}
                flavorSlug={flavor.slug}
                initialIsFavorite={favoriteRow?.is_favorite ?? false}
              />
            </div>
            <p className="max-w-3xl text-sm text-[rgb(var(--muted))]">
              The per-moment R-steps, ops-style. Image preprocessing (P-steps)
              already ran and is cached as reaction profiles — R2 finds the
              right images by searching those profiles&rsquo; search cards.
            </p>
          </div>

          <div className="w-full lg:max-w-xl lg:flex-1">
            <FlavorNotes flavorId={flavor.id} initialNotes={notes} />
          </div>
        </div>

        <div className="mt-6">
          <OpsReverseClient
            flavorId={flavor.id}
            flavorSlug={flavor.slug}
            models={models ?? []}
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
