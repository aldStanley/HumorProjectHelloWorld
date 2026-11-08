'use client'

// Renders step 2's premise-first output: one persona, its selected premises,
// two executions each, one winner per premise, and a single ranking.
//
// The shape of this block follows from what step 2 now guarantees. Because
// exactly one execution survives per premise, the ranking IS the answer — no
// two entries in it are rewrites of the same joke — so it leads, with rank 1
// set largest. Everything that produced it (both executions, what each premise
// required, the diversity check) is working-out, and collapses underneath.

import { Field, SMALL_BUTTON, StructuredOutput } from './pov-jokes-ui'
import type { ResolvedPersona, ResolvedPremise } from './resolve-premises'

export type ExecutionScores = {
  persona_specificity?: number
  event_specificity?: number
  comic_tension?: number
  naturalness?: number
  simplicity?: number
  target_clarity?: number
  total_score?: number
}

export type Execution = {
  execution_id?: string
  caption?: string
  word_count?: number
  execution_style?: string
  simple_image_concept?: string
  why_it_works?: string
  scores?: ExecutionScores
  // Wildcards arrive in their own array with these extra fields.
  is_wildcard?: boolean
  new_semantic_premise?: string
  why_it_is_distinct?: string
}

export type PremiseBlock = {
  source_idea_id?: string
  semantic_cluster?: string | null
  compressed_comic_core?: string
  caption_requirements?: {
    essential_event_detail?: string
    essential_persona_hook?: string
    removable_explanation?: string[]
  }
  executions?: Execution[]
  selected_execution_id?: string
  selection_reason?: string
}

export type Finalist = {
  rank?: number
  source_idea_id?: string | null
  execution_id?: string
  caption?: string
}

export type PremiseJokesOutput = {
  persona_id?: string
  persona?: string
  premises?: PremiseBlock[]
  wildcards?: Execution[]
  ranked_finalists?: Finalist[]
  best_overall_execution_id?: string
  diversity_check?: {
    premises_represented?: {
      source_idea_id?: string
      semantic_cluster?: string | null
      winning_execution_id?: string
    }[]
    near_duplicate_executions?: {
      execution_id_1?: string
      execution_id_2?: string
      overlap?: string
    }[]
    overall_assessment?: string
  }
}

// Step 2 scores each execution 1-5 on six dimensions.
export const EXECUTION_SCORE_LABELS: [keyof ExecutionScores, string][] = [
  ['persona_specificity', 'only this persona'],
  ['event_specificity', 'uses this moment'],
  ['comic_tension', 'real tension'],
  ['naturalness', 'sounds like a post'],
  ['simplicity', 'one beat'],
  ['target_clarity', 'right target'],
]

// Summed here rather than trusting the model's own total_score, which is the
// field most likely to be arithmetic rather than judgement.
export const executionTotal = (execution: Execution): number =>
  EXECUTION_SCORE_LABELS.reduce(
    (sum, [key]) => sum + (Number(execution.scores?.[key]) || 0),
    0
  )

const wordCount = (caption: string): number =>
  caption.trim() ? caption.trim().split(/\s+/).length : 0

const scoreLine = (execution: Execution): string =>
  EXECUTION_SCORE_LABELS.filter(
    ([key]) => typeof execution.scores?.[key] === 'number'
  )
    .map(([key, label]) => `${label} ${execution.scores?.[key]}`)
    .join(' · ')

export type RenderActions = (
  execution: Execution,
  premise: PremiseBlock | null
) => React.ReactNode

export function PremiseJokesResult({
  analysis,
  persona,
  rawText,
  isOpen,
  onToggle,
  renderActions,
}: {
  analysis: PremiseJokesOutput
  persona: ResolvedPersona
  rawText: string
  isOpen: boolean
  onToggle: () => void
  renderActions: RenderActions
}) {
  const premises = analysis.premises ?? []
  const wildcards = analysis.wildcards ?? []

  // Every execution the model produced, by id, so the ranking can be rendered
  // from the executions themselves rather than from the ranking's own copy of
  // the caption.
  const byExecutionId = new Map<string, { execution: Execution; premise: PremiseBlock | null }>()
  premises.forEach((premise) => {
    ;(premise.executions ?? []).forEach((execution) => {
      if (execution.execution_id) {
        byExecutionId.set(execution.execution_id, { execution, premise })
      }
    })
  })
  wildcards.forEach((wildcard) => {
    if (wildcard.execution_id) {
      byExecutionId.set(wildcard.execution_id, {
        execution: { ...wildcard, is_wildcard: true },
        premise: null,
      })
    }
  })

  // What step 1 said this premise was about, which is more useful as a label
  // than the idea id. Falls back to what step 2 said about it.
  const resolvedById = new Map<string, ResolvedPremise>(
    persona.premises.map((premise) => [premise.ideaId, premise])
  )
  const premiseLabel = (
    ideaId: string | null | undefined,
    premise: PremiseBlock | null
  ): string => {
    if (!ideaId) return 'a premise step 1 did not select'
    const resolved = resolvedById.get(ideaId)
    return (
      premise?.semantic_cluster ||
      resolved?.semanticCluster ||
      premise?.compressed_comic_core ||
      resolved?.moment ||
      ideaId
    )
  }

  const finalists = [...(analysis.ranked_finalists ?? [])].sort(
    (a, b) => (a.rank ?? 99) - (b.rank ?? 99)
  )

  // The contract says best_overall must be rank 1. When it is not, say so
  // rather than quietly picking one — a ranking that disagrees with itself is
  // exactly the thing worth seeing.
  const bestId = analysis.best_overall_execution_id
  const rankOneId = finalists[0]?.execution_id
  const rankingDisagrees = Boolean(bestId && rankOneId && bestId !== rankOneId)

  return (
    <div className="mt-4 space-y-10">
      {/* Everything step 2 returned for this persona, in the Flavor Maker's
          structured view. First in the block so it is findable, but collapsed
          so the ranking below still reads as the answer. */}
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline">
          Show everything step 2 returned for this persona, laid out field by
          field
        </summary>
        <div className="mt-3 rounded-lg bg-[rgb(var(--panel)/0.6)] p-4 dark:bg-[rgb(var(--panel)/0.3)]">
          <StructuredOutput text={rawText} />
        </div>
      </details>

      {finalists.length ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
            {finalists.length} joke{finalists.length === 1 ? '' : 's'}, one per
            premise, best first
          </p>

          {rankingDisagrees ? (
            <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
              Step 2 named{' '}
              <span className="font-semibold">{bestId}</span> as the best joke
              but ranked{' '}
              <span className="font-semibold">{rankOneId}</span> first. The
              ranking is what is shown below.
            </p>
          ) : null}

          {/* One list, with rank 1 set large and dark. The ranking is the
              answer here — one winner per premise means no two rows are
              rewrites of each other — so nothing above it competes. */}
          <ul className="mt-6 space-y-12">
            {finalists.map((finalist, i) => {
              const found = finalist.execution_id
                ? byExecutionId.get(finalist.execution_id)
                : undefined
              const execution = found?.execution
              const premise = found?.premise ?? null
              const caption = (
                execution?.caption ??
                finalist.caption ??
                ''
              ).trim()
              const isTop = i === 0
              const isWildcard = Boolean(execution?.is_wildcard)
              return (
                <li
                  key={finalist.execution_id ?? i}
                  className="grid grid-cols-[2.25rem_1fr] gap-x-5 sm:grid-cols-[3rem_1fr]"
                >
                  <p
                    className={`font-bold leading-none tabular-nums ${
                      isTop
                        ? 'text-4xl text-[rgb(var(--ink))]'
                        : 'text-3xl text-[rgb(var(--muted)/0.35)]'
                    }`}
                  >
                    {finalist.rank ?? i + 1}
                  </p>

                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                      {isWildcard
                        ? 'Wildcard · a premise step 1 did not select'
                        : premiseLabel(finalist.source_idea_id, premise)}
                    </p>

                    <p
                      className={`mt-2.5 font-semibold leading-snug ${
                        isTop ? 'text-3xl' : 'text-xl'
                      }`}
                    >
                      &ldquo;{caption}&rdquo;
                    </p>

                    {!execution ? (
                      <p className="mt-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                        The ranking names execution{' '}
                        {finalist.execution_id ?? '(none)'}, which is not in any
                        premise&rsquo;s executions.
                      </p>
                    ) : null}

                    <dl className="mt-4 space-y-3">
                      <Field term="Image to look for">
                        {execution?.simple_image_concept}
                      </Field>
                      <Field term="Why it should work">
                        {execution?.why_it_works}
                      </Field>
                      <Field term="The comic direction step 1 missed">
                        {execution?.new_semantic_premise}
                      </Field>
                    </dl>

                    {execution ? (
                      <p className="mt-4 text-xs text-[rgb(var(--muted))]">
                        <span className="text-base font-bold text-[rgb(var(--ink))] tabular-nums">
                          {executionTotal(execution)}
                        </span>
                        <span className="font-semibold"> / 30</span>
                        {'  '}
                        {wordCount(caption)} words
                        {scoreLine(execution) ? ` · ${scoreLine(execution)}` : ''}
                      </p>
                    ) : null}

                    {execution ? renderActions(execution, premise) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-[rgb(var(--muted))]">
          Step 2 returned no ranked finalists, so there is nothing to choose
          between. The raw output is below.
        </p>
      )}

      {/* Working-out: both executions per premise, and what each premise was
          required to carry. Collapsed, because the winners above are the
          answer. */}
      {premises.length ? (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline">
            Show both executions step 2 wrote for each of the {premises.length}{' '}
            premise{premises.length === 1 ? '' : 's'}, and why each winner won
          </summary>
          <ul className="mt-6 space-y-12">
            {premises.map((premise, i) => {
              const resolved = premise.source_idea_id
                ? resolvedById.get(premise.source_idea_id)
                : undefined
              return (
                <li key={premise.source_idea_id ?? i}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--muted))]">
                    Premise {i + 1} ·{' '}
                    {premiseLabel(premise.source_idea_id, premise)}
                  </p>
                  <p className="mt-2 text-base font-semibold leading-snug">
                    {premise.compressed_comic_core}
                  </p>

                  <dl className="mt-4 space-y-3">
                    <Field term="What step 1 said the premise was">
                      {resolved?.coreComicIdea}
                    </Field>
                    <Field term="The moment it runs on">
                      {resolved?.moment}
                    </Field>
                    <Field term="What the caption had to keep">
                      {premise.caption_requirements?.essential_event_detail}
                    </Field>
                    <Field term="What makes it this persona">
                      {premise.caption_requirements?.essential_persona_hook}
                    </Field>
                    <Field term="What it could leave out">
                      {premise.caption_requirements?.removable_explanation?.join(
                        '; '
                      )}
                    </Field>
                    <Field term="Why the winner won">
                      {premise.selection_reason}
                    </Field>
                  </dl>

                  <ul className="mt-5 space-y-8 border-l-2 border-[rgb(var(--gloss)/0.5)] pl-6 dark:border-[rgb(var(--gloss)/0.2)]">
                    {(premise.executions ?? []).map((execution, j) => {
                      const caption = (execution.caption ?? '').trim()
                      const won =
                        execution.execution_id === premise.selected_execution_id
                      return (
                        <li key={execution.execution_id ?? j}>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                            {execution.execution_style || `Execution ${j + 1}`}
                            {won ? ' · chosen as this premise’s winner' : ''}
                          </p>
                          <p className="mt-1.5 text-lg font-semibold leading-snug">
                            &ldquo;{caption}&rdquo;
                          </p>
                          <dl className="mt-3 space-y-3">
                            <Field term="Image to look for">
                              {execution.simple_image_concept}
                            </Field>
                            <Field term="Why it should work">
                              {execution.why_it_works}
                            </Field>
                          </dl>
                          <p className="mt-3 text-xs text-[rgb(var(--muted))]">
                            <span className="text-sm font-bold text-[rgb(var(--ink))] tabular-nums">
                              {executionTotal(execution)}
                            </span>
                            <span className="font-semibold"> / 30</span>
                            {'  '}
                            {wordCount(caption)} words
                            {scoreLine(execution)
                              ? ` · ${scoreLine(execution)}`
                              : ''}
                          </p>
                          {renderActions(execution, premise)}
                        </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ul>
        </details>
      ) : null}

      <div>
        <button type="button" className={SMALL_BUTTON} onClick={onToggle}>
          {isOpen ? 'Hide' : 'Show'} step 2&rsquo;s own check that these jokes
          hit different notes
        </button>
        {isOpen ? (
          <div className="mt-4">
            <dl className="space-y-3">
              <Field term="Whether the set covers different comic ideas">
                {analysis.diversity_check?.overall_assessment}
              </Field>
              <Field term="Premises represented in the ranking">
                {analysis.diversity_check?.premises_represented
                  ?.map(
                    (entry) =>
                      entry.semantic_cluster ?? entry.source_idea_id ?? ''
                  )
                  .filter(Boolean)
                  .join('; ')}
              </Field>
              <Field term="Pairs it flagged as near-duplicates">
                {analysis.diversity_check?.near_duplicate_executions
                  ?.map(
                    (pair) =>
                      `${pair.execution_id_1} and ${pair.execution_id_2}: ${pair.overlap}`
                  )
                  .join(' · ')}
              </Field>
            </dl>
            <div className="pt-5">
              <button
                type="button"
                className={SMALL_BUTTON}
                onClick={() => navigator.clipboard.writeText(rawText)}
              >
                Copy this persona&rsquo;s raw JSON
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
