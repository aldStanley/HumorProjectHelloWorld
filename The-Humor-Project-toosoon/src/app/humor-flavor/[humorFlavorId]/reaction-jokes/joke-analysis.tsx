'use client'

// One joke's post-hoc analysis (the flavor's step 3) and its refinement
// (step 4), for flavors that have those steps. The analyzer reconstructs
// the premise under a joke, labels its comic moves against the catalog in
// docs/prompts/analyses/comic-moves/, judges the premise and the execution
// SEPARATELY, and chooses keep | refine_execution | reject. The refiner
// runs only on refine_execution and returns two or three variants that
// keep the premise and fix the one diagnosed problem. The action is derived
// in code from the three judgments (the rule in the analyzer's section 6),
// so the model cannot rationalize a keep for a weak premise; when the model
// disagrees with the rule, the rule wins and the disagreement is kept.
import { HeartIcon } from './run-record'

export type PremiseQuality = 'excellent' | 'good' | 'weak' | 'none'
export type ExecutionQuality = 'excellent' | 'good' | 'weak'
export type Legibility = 'immediate' | 'slight_inference' | 'hard_to_parse'
export type Action = 'keep' | 'refine_execution' | 'reject'

export type JokeAnalysis = {
  joke?: string
  premise?: string
  primary_move?: string
  supporting_moves?: string[]
  unexplained_move?: string | null
  premise_quality?: PremiseQuality
  execution_quality?: ExecutionQuality
  connection_legibility?: Legibility
  persona_fit?: 'high' | 'medium' | 'low'
  specific_problem?: string | null
  preserve?: string | null
  action?: Action
}

export type AnalysisJob = {
  status: 'running' | 'done' | 'failed'
  data?: JokeAnalysis
  raw?: string
  sentPrompt?: string
  error?: string
  durationMs?: number
  model?: string
  reasoningEffort?: string
  // Set when the rule overrode the analyzer's own action: what it said.
  backstop?: string | null
}

export type Variant = { joke: string; fix?: string }

export type RefineJob = {
  status: 'running' | 'done' | 'failed'
  variants?: Variant[]
  raw?: string
  sentPrompt?: string
  error?: string
  durationMs?: number
  model?: string
  reasoningEffort?: string
}

const PREMISE: PremiseQuality[] = ['excellent', 'good', 'weak', 'none']
const EXECUTION: ExecutionQuality[] = ['excellent', 'good', 'weak']
const LEGIBILITY: Legibility[] = ['immediate', 'slight_inference', 'hard_to_parse']

// The analyzer's section 6, as code: reject a weak premise, keep only when
// nothing is left to fix, refine the rest. Null when a judgment is missing.
export const ruleAction = (d: JokeAnalysis): Action | null => {
  if (!d.premise_quality || !PREMISE.includes(d.premise_quality)) return null
  if (d.premise_quality === 'weak' || d.premise_quality === 'none') return 'reject'
  if (!d.execution_quality || !EXECUTION.includes(d.execution_quality)) return null
  if (!d.connection_legibility || !LEGIBILITY.includes(d.connection_legibility)) return null
  return d.execution_quality === 'excellent' && d.connection_legibility === 'immediate' ? 'keep' : 'refine_execution'
}

// The four judgments as ONE number out of 100, to sort by (Lydia,
// 2026-09-09: "reduce this to one number you display and I can sort by").
// The premise counts double: on the hearted run it was the judgment that
// separated hearts (excellent 61%, good and weak about 30%). Null when a
// judgment is missing.
const PREMISE_POINTS: Record<PremiseQuality, number> = { excellent: 4, good: 3, weak: 1, none: 0 }
const EXECUTION_POINTS: Record<ExecutionQuality, number> = { excellent: 3, good: 2, weak: 1 }
const LEGIBILITY_POINTS: Record<Legibility, number> = { immediate: 3, slight_inference: 2, hard_to_parse: 1 }
const FIT_POINTS: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 }
export const analysisScore = (d: JokeAnalysis): number | null => {
  const p = d.premise_quality ? PREMISE_POINTS[d.premise_quality] : undefined
  const e = d.execution_quality ? EXECUTION_POINTS[d.execution_quality] : undefined
  const l = d.connection_legibility ? LEGIBILITY_POINTS[d.connection_legibility] : undefined
  const f = d.persona_fit ? FIT_POINTS[d.persona_fit] : undefined
  if (p == null || e == null || l == null || f == null) return null
  return Math.round((100 * (2 * (p / 4) + e / 3 + l / 3 + f / 3)) / 5)
}

// Parses the analyzer's JSON (tolerating a fence and text around it) and
// applies the rule. Returns the data with the rule's action, and the
// analyzer's own action when the two differ.
export const parseAnalysis = (text: string): { data: JokeAnalysis; backstop: string | null } | null => {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: JokeAnalysis
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as JokeAnalysis
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || !parsed) return null
  const data: JokeAnalysis = {
    ...parsed,
    supporting_moves: Array.isArray(parsed.supporting_moves) ? parsed.supporting_moves.map(String) : [],
    unexplained_move: parsed.unexplained_move ? String(parsed.unexplained_move) : null,
    specific_problem: parsed.specific_problem ? String(parsed.specific_problem) : null,
    preserve: parsed.preserve ? String(parsed.preserve) : null,
  }
  const rule = ruleAction(data)
  const said = data.action
  if (rule && said !== rule) {
    data.action = rule
    return { data, backstop: said ? `the analyzer said ${said}; the rule gives ${rule}` : `the analyzer gave no action; the rule gives ${rule}` }
  }
  return { data, backstop: null }
}

// The refiner's JSON: {"variants": [{joke, fix}]}. Variants equal to the
// original, empty, or beyond the third are dropped in code.
export const parseVariants = (text: string, original: string): Variant[] | null => {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: { variants?: unknown }
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as { variants?: unknown }
  } catch {
    return null
  }
  if (!Array.isArray(parsed.variants)) return null
  const seen = new Set<string>([original.trim()])
  const out: Variant[] = []
  for (const v of parsed.variants) {
    const joke = typeof v === 'string' ? v : typeof v?.joke === 'string' ? v.joke : ''
    const fix = typeof v === 'object' && v && typeof v.fix === 'string' ? v.fix : undefined
    const trimmed = joke.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push({ joke: trimmed, fix })
    if (out.length === 3) break
  }
  return out
}

export const words = (key: string) => key.replace(/_/g, ' ')

export const ACTION_LABEL: Record<Action, string> = {
  keep: 'keep',
  refine_execution: 'refine',
  reject: 'reject',
}

// The action column of a joke's row. A button: clicking it selects the joke
// so its analysis shows on the right. Weight carries the difference: keep is
// bold, refine is normal, reject is muted.
export function ActionCell({ job, selected, onSelect }: { job: AnalysisJob; selected: boolean; onSelect: () => void }) {
  const action = job.status === 'done' ? job.data?.action : undefined
  const label = job.status === 'running' ? '…' : job.status === 'failed' || !action ? 'failed' : ACTION_LABEL[action]
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title="Show this joke's analysis on the right: its premise, its comic moves, and why it got this action"
      className={`justify-self-end rounded-md px-1.5 py-0.5 text-right text-sm transition ${
        job.status === 'running'
          ? 'text-[rgb(var(--muted))]'
          : job.status === 'failed'
            ? 'text-xs text-red-700 dark:text-red-400'
            : `${action === 'keep' ? 'font-semibold' : action === 'reject' ? 'text-[rgb(var(--muted))]' : ''} ${
                selected ? 'bg-[rgb(var(--panel))] dark:bg-[rgb(var(--panel)/0.5)]' : 'hover:bg-[rgb(var(--panel)/0.8)]'
              }`
      }`}
    >
      {label}
    </button>
  )
}

// The action as a plain word in its column: keep bold, reject muted.
export function ActionLabel({ job }: { job: AnalysisJob }) {
  const action = job.status === 'done' ? job.data?.action : undefined
  const label = job.status === 'running' ? '…' : job.status === 'failed' || !action ? 'failed' : ACTION_LABEL[action]
  return (
    <span
      className={`justify-self-end text-right text-sm ${
        job.status === 'failed'
          ? 'text-xs text-red-700 dark:text-red-400'
          : action === 'keep'
            ? 'font-semibold'
            : action === 'reject'
              ? 'text-[rgb(var(--muted))]'
              : ''
      }`}
    >
      {label}
    </span>
  )
}

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]'

// The right-hand panel: the selected joke's analysis, premise first.
export function AnalysisPanel({ joke, job }: { joke: string | null; job: AnalysisJob | null }) {
  if (!joke || !job) {
    return (
      <p className="text-sm leading-relaxed text-[rgb(var(--muted))]">
        Click a joke&rsquo;s action (keep, refine, reject) to see the premise the analyzer found under it, the comic
        moves it labeled, and how it judged the idea and the wording separately.
      </p>
    )
  }
  if (job.status === 'running') return <p className="text-sm text-[rgb(var(--muted))]">Analyzing this joke…</p>
  if (job.status === 'failed' || !job.data) {
    return (
      <div className="text-sm text-red-700 dark:text-red-400">
        {job.error ?? 'The analyzer returned something the page could not read.'}
        {job.raw ? (
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 text-xs text-[rgb(var(--foreground))] dark:bg-[rgb(var(--panel)/0.3)]">
            {job.raw}
          </pre>
        ) : null}
      </div>
    )
  }
  const d = job.data
  const moves = [d.primary_move, ...(d.supporting_moves ?? [])].filter(Boolean) as string[]
  return (
    <div>
      <p className="text-sm leading-relaxed">&ldquo;{joke}&rdquo;</p>
      <p className="mt-3">
        <span className="text-2xl font-semibold">{d.action ? ACTION_LABEL[d.action] : '–'}</span>
        {job.backstop ? (
          <span className="ml-3 text-xs text-[rgb(var(--muted))]">by the rule: {job.backstop}</span>
        ) : null}
      </p>

      <p className={`mt-6 ${LABEL}`}>The premise the analyzer found under it</p>
      <p className="mt-1 text-base leading-relaxed">{d.premise ?? '–'}</p>

      <p className={`mt-5 ${LABEL}`}>The comic moves it uses</p>
      <p className="mt-1 text-sm leading-relaxed">
        {d.primary_move ? (
          <>
            <span className="font-semibold">{words(d.primary_move)}</span>
            {d.supporting_moves?.length ? (
              <span className="text-[rgb(var(--muted))]"> with {d.supporting_moves.map(words).join(', ')}</span>
            ) : null}
          </>
        ) : (
          '–'
        )}
      </p>
      {d.unexplained_move ? (
        <p className="mt-1 text-sm leading-relaxed">
          <span className="text-[rgb(var(--muted))]">Not in the catalog: </span>
          {d.unexplained_move}
        </p>
      ) : null}

      <p className={`mt-5 ${LABEL}`}>The idea and the wording, judged separately</p>
      <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-[rgb(var(--muted))]">Premise quality</dt>
        <dd className="font-semibold">{d.premise_quality ?? '–'}</dd>
        <dt className="text-[rgb(var(--muted))]">Execution quality</dt>
        <dd className="font-semibold">{d.execution_quality ?? '–'}</dd>
        <dt className="text-[rgb(var(--muted))]">Connection legibility</dt>
        <dd className="font-semibold">{d.connection_legibility ? words(d.connection_legibility) : '–'}</dd>
        <dt className="text-[rgb(var(--muted))]">Persona fit</dt>
        <dd className="font-semibold">{d.persona_fit ?? '–'}</dd>
      </dl>

      {d.specific_problem ? (
        <>
          <p className={`mt-5 ${LABEL}`}>The one execution problem to fix</p>
          <p className="mt-1 text-sm leading-relaxed">{d.specific_problem}</p>
          {d.preserve ? (
            <p className="mt-1 text-sm leading-relaxed text-[rgb(var(--muted))]">Must survive the rewrite: {d.preserve}</p>
          ) : null}
        </>
      ) : null}
      {moves.length === 0 && !d.unexplained_move ? (
        <p className="mt-3 text-xs text-[rgb(var(--muted))]">The analyzer named no move at all.</p>
      ) : null}

      {job.raw ? (
        <details className="mt-5">
          <summary className={`cursor-pointer ${LABEL}`}>The analyzer&rsquo;s raw JSON</summary>
          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 text-xs dark:bg-[rgb(var(--panel)/0.3)]">
            {job.raw}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

// The analysis laid out inside the joke's row, beside the joke, using the
// row's width (Lydia, 2026-09-09: "use as much of the space in the row to
// show analysis stuff as possible"): the premise first, then the moves, the
// four judgments on one quiet line, and the diagnosed problem.
export function AnalysisInline({ job }: { job: AnalysisJob }) {
  if (job.status === 'running') return <p className="text-sm text-[rgb(var(--muted))]">Analyzing…</p>
  if (job.status === 'failed' || !job.data)
    return <p className="text-sm text-red-700 dark:text-red-400">{job.error ?? 'The analyzer returned something unreadable.'}</p>
  const d = job.data
  return (
    <div className="min-w-0">
      <p className="text-base leading-snug">
        <span className="font-semibold">{d.primary_move ? words(d.primary_move) : 'no move named'}</span>
        {d.supporting_moves?.length ? (
          <span className="text-[rgb(var(--muted))]"> with {d.supporting_moves.map(words).join(', ')}</span>
        ) : null}
      </p>
      <p className="mt-1 text-sm leading-relaxed">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Premise </span>
        {d.premise ?? '–'}
      </p>
      {d.unexplained_move ? (
        <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--muted))]">
          <span className="font-semibold uppercase tracking-[0.12em]">Not in the catalog </span>
          {d.unexplained_move}
        </p>
      ) : null}
      {d.specific_problem ? (
        <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--muted))]">
          <span className="font-semibold uppercase tracking-[0.12em]">Fix </span>
          {d.specific_problem}
        </p>
      ) : null}
      {job.backstop ? <p className="mt-1 text-xs text-[rgb(var(--muted))]">By the rule: {job.backstop}</p> : null}
    </div>
  )
}

// The one number for the analysis, in its own column, with the four
// judgments behind a hover title.
export function AnalysisScoreCell({ job }: { job: AnalysisJob }) {
  if (job.status !== 'done' || !job.data) return <span />
  const d = job.data
  const score = analysisScore(d)
  return (
    <span
      className="justify-self-end text-right text-lg font-semibold tabular-nums"
      title={`premise ${d.premise_quality ?? '?'} · execution ${d.execution_quality ?? '?'} · legibility ${
        d.connection_legibility ? words(d.connection_legibility) : '?'
      } · persona fit ${d.persona_fit ?? '?'}. Premise counts double.`}
    >
      {score ?? '–'}
    </span>
  )
}

// The refiner's variants under an original joke: each with its own heart,
// its fix under a quiet label. Read-only when onToggleHeart is absent.
export function VariantList({
  job,
  isHearted,
  onToggleHeart,
}: {
  job: RefineJob
  isHearted: (caption: string) => boolean
  onToggleHeart?: (caption: string) => void
}) {
  if (job.status === 'running')
    return <p className="mt-2 text-sm text-[rgb(var(--muted))]">Rewriting to fix the diagnosed problem…</p>
  if (job.status === 'failed')
    return <p className="mt-2 text-sm text-red-700 dark:text-red-400">{job.error ?? 'The refiner failed.'}</p>
  if (!job.variants?.length)
    return <p className="mt-2 text-sm text-[rgb(var(--muted))]">The refiner returned no variant that differs from the original.</p>
  return (
    <ol className="mt-3 space-y-3 border-l-2 border-[rgb(var(--gloss)/0.4)] pl-4 dark:border-[rgb(var(--gloss)/0.15)]">
      {job.variants.map((v, i) => {
        const hearted = isHearted(v.joke)
        return (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-baseline">
            <div>
              <p className="text-base leading-relaxed">{v.joke}</p>
              {v.fix ? (
                <p className="mt-0.5 text-xs leading-relaxed text-[rgb(var(--muted))]">
                  <span className="font-semibold uppercase tracking-[0.12em]">Fix </span>
                  {v.fix}
                </p>
              ) : null}
            </div>
            {onToggleHeart ? (
              <button
                type="button"
                aria-pressed={hearted}
                aria-label={hearted ? 'Remove the heart from this variant' : 'Heart this variant'}
                title={hearted ? 'Remove the heart from this variant' : 'Heart this variant: it goes to step 5 like any joke'}
                onClick={() => onToggleHeart(v.joke)}
                className={`justify-self-end self-center transition ${
                  hearted ? 'text-[rgb(var(--accent-strong))]' : 'text-[rgb(var(--muted)/0.55)] hover:text-[rgb(var(--accent-strong))]'
                }`}
              >
                <HeartIcon filled={hearted} size={18} />
              </button>
            ) : hearted ? (
              <span className="justify-self-end self-center text-[rgb(var(--accent-strong))]">
                <HeartIcon filled size={18} />
              </span>
            ) : (
              <span />
            )}
          </li>
        )
      })}
    </ol>
  )
}
