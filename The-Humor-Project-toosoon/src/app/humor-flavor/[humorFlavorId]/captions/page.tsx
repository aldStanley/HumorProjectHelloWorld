import { flavorPageMetadata } from '@/utils/page-metadata'
import { notFound, redirect } from 'next/navigation'

import { createClient } from '@/utils/supabase/server'

import AppHeader from '@/components/app-header'
import CaptionsClient from './captions-client'
import { PAGE_SIZE } from './constants'
import type { CaptionRow } from './types'

export const generateMetadata = flavorPageMetadata('captions')

export default async function HumorFlavorCaptionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ humorFlavorId: string }>
  searchParams?: Promise<{ page?: string | string[] }>
}) {
  const { humorFlavorId } = await params
  const flavorId = Number.parseInt(humorFlavorId, 10)

  if (!Number.isFinite(flavorId)) {
    notFound()
  }

  const resolvedSearchParams = (await searchParams) ?? {}
  const pageParam = Array.isArray(resolvedSearchParams.page)
    ? resolvedSearchParams.page[0]
    : resolvedSearchParams.page
  const pageValue = Number.parseInt(pageParam ?? '1', 10)
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1
  const offset = (page - 1) * PAGE_SIZE

  const supabase = await createClient({ readOnly: true })
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  const { data: flavor, error: flavorError } = await supabase
    .from('humor_flavors')
    .select('id, slug, description')
    .eq('id', flavorId)
    .maybeSingle()

  if (flavorError || !flavor) {
    notFound()
  }

  const { data: captions, error: captionsError, count } = await supabase
    .from('captions')
    .select(
      'id, content, created_datetime_utc, caption_request_id, llm_prompt_chain_id, image:images ( id, url )',
      {
        count: 'exact',
      }
    )
    .eq('humor_flavor_id', flavor.id)
    .order('created_datetime_utc', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  const captionRows = (captions ?? []) as CaptionRow[]
  const totalCount = typeof count === 'number' ? count : null
  const title = flavor.slug ?? 'Humor flavor'
  const initialError = captionsError
    ? 'Unable to load captions right now.'
    : null

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.5),transparent_48%),radial-gradient(circle_at_82%_8%,rgb(var(--ambient-spot-2)/0.32),transparent_42%),radial-gradient(circle_at_30%_85%,rgb(var(--ambient-spot-3)/0.38),transparent_55%),linear-gradient(130deg,rgb(var(--ambient-base-1)/1),rgb(var(--ambient-base-2)/0.7),rgb(var(--ambient-base-3)/0.45))] dark:bg-[radial-gradient(circle_at_18%_18%,rgb(var(--ambient-spot-1)/0.12),transparent_48%),radial-gradient(circle_at_78%_15%,rgb(var(--ambient-spot-2)/0.18),transparent_45%),linear-gradient(140deg,rgb(var(--ambient-base-1)/0.98),rgb(var(--ambient-base-2)/0.98),rgb(var(--ambient-base-3)/0.99))]" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(120deg,rgb(var(--gloss)/0.7),rgb(var(--gloss)/0)_55%)] opacity-80 mix-blend-screen dark:opacity-40" />
      <div className="pointer-events-none absolute -left-20 top-1/3 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.75),rgb(var(--ambient-orb-left-2)/0.35),transparent_70%)] blur-3xl animate-float dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-spot-1)/0.18),rgb(var(--ambient-orb-left-2)/0.12),transparent_70%)]" />
      <div className="pointer-events-none absolute right-[-6rem] top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.6),rgb(var(--ambient-orb-right-2)/0.2),transparent_72%)] blur-3xl animate-sway dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-right-1)/0.16),rgb(var(--ambient-orb-right-2)/0.12),transparent_72%)]" />
      <div className="pointer-events-none absolute bottom-[-7rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.6),rgb(var(--ambient-spot-1)/0.3),transparent_70%)] blur-3xl animate-drift dark:bg-[radial-gradient(circle_at_30%_30%,rgb(var(--ambient-orb-bottom-1)/0.14),rgb(var(--ambient-spot-2)/0.1),transparent_70%)]" />
      <AppHeader />
      <CaptionsClient
        flavorId={flavor.id}
        flavorSlug={title}
        flavorDescription={flavor.description}
        initialCaptions={captionRows}
        initialPage={page}
        initialTotalCount={totalCount}
        initialError={initialError}
      />
    </main>
  )
}
