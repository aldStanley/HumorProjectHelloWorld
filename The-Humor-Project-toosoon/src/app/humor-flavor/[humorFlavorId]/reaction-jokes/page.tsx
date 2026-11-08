import { flavorPageMetadata } from '@/utils/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import AppHeader from '@/components/app-header'
import { createClient } from '@/utils/supabase/server'

// The loader is shared with /pov-jokes: this surface needs the flavor and its
// one step, and nothing about the loader is specific to either pipeline.
import { namesByProfileId } from '../ops/who-ran-it'
import { loadPovJokesData } from '../pov-jokes/load-data'
import { ANALYSIS_PROMPT_DIR, loadComicMovesPrompt, loadStudentReadPrompt } from './analysis-prompts'
import { loadEvaluatorPrompts } from './evaluator-prompts'
import { loadPersonaPrompts, PERSONA_PROMPT_DIR } from './persona-pov-prompts'
import ReactionJokesClient from './reaction-jokes-client'
import type { RunSnapshot, SharedRun } from './run-record'

export const generateMetadata = flavorPageMetadata('reaction-jokes')

// The row a share link points at (?share=<id>), or why there is none.
const loadShare = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  flavorId: number,
  id: string
): Promise<{ share: SharedRun | null; shareError: string | null }> => {
  const { data, error } = await supabase
    .from('reaction_joke_shares')
    .select('id, flavor_id, profile_id, snapshot, created_datetime_utc')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    return {
      share: null,
      shareError: /relation .* does not exist|schema cache/i.test(error.message)
        ? 'Share links need the reaction_joke_shares table; run supabase/migrations/20260917000000_reaction_joke_shares.sql in the Supabase SQL editor.'
        : `Could not load the shared run: ${error.message}`,
    }
  }
  if (!data) return { share: null, shareError: 'This share link does not point at a saved run. It may have been mistyped.' }
  if (Number(data.flavor_id) !== flavorId) {
    return {
      share: null,
      shareError: `This share link belongs to flavor ${data.flavor_id}, not this one.`,
    }
  }
  const names = await namesByProfileId(supabase, [data.profile_id])
  return {
    share: {
      id: data.id,
      snapshot: data.snapshot as RunSnapshot,
      sharedBy: names.get(data.profile_id) ?? 'someone',
      sharedAt: data.created_datetime_utc,
    },
    shareError: null,
  }
}

export default async function ReactionJokesPage({
  params,
  searchParams,
}: {
  params: Promise<{ humorFlavorId: string }>
  searchParams?: Promise<{ share?: string | string[] }>
}) {
  const { humorFlavorId } = await params
  const shareParam = (await searchParams)?.share
  const shareId = (Array.isArray(shareParam) ? shareParam[0] : shareParam)?.trim() || null
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
  const personas = await loadPersonaPrompts()
  const evaluators = await loadEvaluatorPrompts()
  const studentRead = await loadStudentReadPrompt()
  const comicMoves = await loadComicMovesPrompt()
  // A flavor with a step 3 analyzes its jokes after they are written
  // (flavor 1564, the voice-first + post-hoc analysis experiment).
  const hasAnalyzer = steps.some((s) => s.orderBy === 3)
  const { share, shareError } = shareId
    ? await loadShare(supabase, flavorId, shareId)
    : { share: null, shareError: null }

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
            Reaction Joke Maker (moments + one persona → reaction jokes)
          </p>
          <h1 className="text-3xl font-semibold sm:text-4xl">
            <span className="bg-[linear-gradient(120deg,rgb(var(--headline-accent-strong)),rgb(var(--headline-accent)),rgb(var(--headline-syrup)))] bg-clip-text text-transparent">
              {flavor.slug}
            </span>
          </h1>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[rgb(var(--muted))]">
            <li>Pick one or more moments, typed or from an archived Sidechat clustering.</li>
            <li>
              Read each moment as students: one call per moment with the newest Student Read prompt
              in <code>{ANALYSIS_PROMPT_DIR}/student-read/</code> returns what students are doing,
              feeling, and risking in it, as JSON laid out by field.
            </li>
            <li>
              Pick one persona. Its voice prompt is the newest dated file in its folder under{' '}
              <code>{PERSONA_PROMPT_DIR}/</code>, sent as written; older files there are history.
            </li>
            <li>
              One model call per moment writes a chosen number of reaction jokes (5 to start) in that voice, two ways: from
              the persona alone (step 1), or from the persona and the moment&rsquo;s student read
              (step 2, a sibling of step 1 with the read added). There is no roster and no
              premise search: the prompt is the whole method.
            </li>
            <li>
              Then, for personas that have an evaluator prompt in{' '}
              <code>docs/prompts/evaluators/</code>, one call per joke scores it on the
              evaluator&rsquo;s dimensions.
            </li>
            {hasAnalyzer ? (
              <>
                <li>
                  This flavor also has an analyzer (step 3): after the jokes exist, one call per joke reconstructs
                  the premise under it, labels its comic moves against the catalog in{' '}
                  <code>{ANALYSIS_PROMPT_DIR}/comic-moves/</code> (several moves per joke, or one the catalog does not
                  name), judges the idea and the wording separately, and marks it keep, refine, or reject. The
                  writer never sees the catalog.
                </li>
                <li>
                  And a refiner (step 4): only for jokes marked refine, two or three variants that keep the premise and
                  fix the one diagnosed problem. The original stays; a variant can be hearted on its own.
                </li>
              </>
            ) : null}
          </ul>
        </div>

        <div className="mt-10">
          <ReactionJokesClient
            flavorId={flavor.id}
            steps={steps}
            personas={personas}
            evaluators={evaluators}
            studentRead={studentRead}
            comicMoves={comicMoves}
            share={share}
            shareError={shareError}
          />
        </div>
      </div>
    </main>
  )
}
