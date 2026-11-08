'use client'

// One joke's evaluation. The score is a cell in the joke's row ("97%"), in
// its own column beside the heart; clicking it selects the joke, and the
// breakdown (rating, failure flags, the seven criteria with reasons, the
// analysis fields) shows in the panel to the right of the list. Nothing is
// colour-coded; weight and size carry the hierarchy.

export type Criterion = { score?: number; reason?: string }

export type JokeEvaluation = {
  joke?: string
  analysis?: Record<string, string>
  criteria?: Record<string, Criterion>
  score?: number
  rating?: string
  reason?: string
  failure_flags?: string[]
}

export type EvalJob = {
  status: 'running' | 'done' | 'failed'
  data?: JokeEvaluation
  raw?: string
  error?: string
  durationMs?: number
  model?: string
  reasoningEffort?: string
}

// Tolerates a code fence and text around the JSON.
export const parseEvaluation = (text: string): JokeEvaluation | null => {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as JokeEvaluation
    return typeof parsed === 'object' && parsed ? parsed : null
  } catch {
    return null
  }
}

const words = (key: string) => key.replace(/_/g, ' ')

// The score column of a joke's row. A button: clicking it selects the joke
// so its breakdown shows on the right.
export function ScoreCell({ job, selected, onSelect }: { job: EvalJob; selected: boolean; onSelect: () => void }) {
  const label =
    job.status === 'running'
      ? '…'
      : job.status === 'failed' || typeof job.data?.score !== 'number'
        ? 'failed'
        : `${job.data.score}%`
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title="Show this joke's scores by dimension on the right"
      className={`justify-self-end rounded-md px-1.5 py-0.5 text-right tabular-nums transition ${
        job.status === 'running'
          ? 'text-sm text-[rgb(var(--muted))]'
          : job.status === 'failed'
            ? 'text-xs text-red-700 dark:text-red-400'
            : selected
              ? 'bg-[rgb(var(--panel))] text-lg font-semibold dark:bg-[rgb(var(--panel)/0.5)]'
              : 'text-lg font-semibold hover:bg-[rgb(var(--panel)/0.8)]'
      }`}
    >
      {label}
    </button>
  )
}

// The right-hand panel: the selected joke's breakdown.
export function EvaluationPanel({ joke, job }: { joke: string | null; job: EvalJob | null }) {
  if (!joke || !job) {
    return (
      <p className="text-sm leading-relaxed text-[rgb(var(--muted))]">
        Click a joke&rsquo;s score to see how the evaluator scored it, dimension by dimension.
      </p>
    )
  }
  if (job.status === 'running') {
    return <p className="text-sm text-[rgb(var(--muted))]">Scoring this joke…</p>
  }
  if (job.status === 'failed' || !job.data) {
    return (
      <div className="text-sm text-red-700 dark:text-red-400">
        {job.error ?? 'The evaluator returned something the page could not read.'}
        {job.raw ? (
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 text-xs text-[rgb(var(--foreground))] dark:bg-[rgb(var(--panel)/0.3)]">
            {job.raw}
          </pre>
        ) : null}
      </div>
    )
  }
  const d = job.data
  const criteria = Object.entries(d.criteria ?? {})
  const analysis = Object.entries(d.analysis ?? {})
  const flags = d.failure_flags ?? []
  return (
    <div>
      <p className="text-sm leading-relaxed">&ldquo;{joke}&rdquo;</p>
      <p className="mt-3">
        <span className="text-3xl font-semibold tabular-nums">{typeof d.score === 'number' ? `${d.score}%` : '–'}</span>
        {d.rating ? (
          <span className="ml-3 text-xs font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
            {words(d.rating)}
          </span>
        ) : null}
      </p>
      {flags.length ? (
        <p className="mt-2 text-xs">
          <span className="font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Failure flags </span>
          {flags.map(words).join(', ')}
        </p>
      ) : null}

      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
        Scores by dimension, out of 5
      </p>
      <dl className="mt-2 space-y-2.5">
        {criteria.map(([key, c]) => (
          <div key={key} className="grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-x-3">
            <dt className="text-base font-semibold tabular-nums">{typeof c?.score === 'number' ? c.score : '–'}</dt>
            <dd>
              <span className="text-sm font-semibold">{words(key)}</span>
              {c?.reason ? <span className="block text-sm leading-relaxed text-[rgb(var(--muted))]">{c.reason}</span> : null}
            </dd>
          </div>
        ))}
      </dl>

      {analysis.length ? (
        <>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
            What the evaluator saw in the joke
          </p>
          <dl className="mt-2 space-y-2.5">
            {analysis.map(([key, value]) => (
              <div key={key}>
                <dt className="text-sm font-semibold">{words(key)}</dt>
                <dd className="text-sm leading-relaxed text-[rgb(var(--muted))]">{String(value).replace(/_/g, ' ')}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      {job.raw ? (
        <details className="mt-5">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
            The evaluator&rsquo;s raw JSON
          </summary>
          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 text-xs dark:bg-[rgb(var(--panel)/0.3)]">
            {job.raw}
          </pre>
        </details>
      ) : null}
    </div>
  )
}
