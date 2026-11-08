'use client'

// The Student Read of a moment: what students are collectively doing,
// feeling, and risking in it. One analysis call per moment, run after the
// moments are picked and before the persona reacts. The prompt returns
// strict JSON; the panel lays that JSON out by its structure, the kernel
// first, the fields it knows under their own labels, and any field it does
// not know generically, so a revised prompt with new fields still shows
// everything it returns.

export type StudentRead = {
  shared_behavior?: string
  primary_emotion?: string
  secondary_emotion?: string | null
  student_stake?: string
  social_logic?: string
  event_kernel?: string
  shared_signals?: string[]
  incidental_details?: string[]
  recommended_abstraction?: string
  good_social_anchors?: string[]
  avoid_as_required_context?: string[]
  [key: string]: unknown
}

export type StudentReadJob = {
  moment: string
  status: 'running' | 'done' | 'failed'
  data?: StudentRead
  raw?: string
  sentPrompt?: string
  error?: string
  durationMs?: number
  finishedAt?: string
  // Which prompt file produced it, so a newer one reads as stale.
  promptFile?: string
  model?: string
  reasoningEffort?: string
}

// Tolerates a code fence and text around the JSON.
export const parseStudentRead = (text: string): StudentRead | null => {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as StudentRead
    return typeof parsed === 'object' && parsed ? parsed : null
  } catch {
    return null
  }
}

// The fields the panel lays out itself, in the order it shows them. Anything
// else the JSON carries is shown after these, generically.
const KNOWN_FIELDS = [
  'event_kernel',
  'shared_behavior',
  'primary_emotion',
  'secondary_emotion',
  'student_stake',
  'social_logic',
  'recommended_abstraction',
  'shared_signals',
  'good_social_anchors',
  'incidental_details',
  'avoid_as_required_context',
]

const words = (key: string) => key.replace(/_/g, ' ')

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className={LABEL}>{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed">{children}</dd>
    </div>
  )
}

function Items({ items }: { items: unknown }) {
  const list = Array.isArray(items) ? items.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) : []
  if (!list.length) return <span className="text-[rgb(var(--muted))]">none</span>
  return (
    <ul className="list-disc space-y-1 pl-5">
      {list.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

// A field the panel has no layout for: strings as text, arrays as lists,
// objects as nested label/value pairs.
function Generic({ value }: { value: unknown }) {
  if (value == null) return <span className="text-[rgb(var(--muted))]">none</span>
  if (Array.isArray(value)) return <Items items={value} />
  if (typeof value === 'object') {
    return (
      <dl className="space-y-2">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs font-semibold">{words(k)}</dt>
            <dd className="mt-0.5">
              <Generic value={v} />
            </dd>
          </div>
        ))}
      </dl>
    )
  }
  return <>{String(value)}</>
}

// The right-hand panel: one moment's Student Read, laid out by field.
export function StudentReadPanel({ job }: { job: StudentReadJob | null }) {
  if (!job) {
    return (
      <p className="text-sm leading-relaxed text-[rgb(var(--muted))]">
        Pick a moment on the left to read what students are doing, feeling, and risking in it.
      </p>
    )
  }
  if (job.status === 'running') {
    return <p className="text-sm text-[rgb(var(--muted))]">Reading this moment as students…</p>
  }
  if (job.status === 'failed' || !job.data) {
    return (
      <div>
        <p className="text-sm text-red-700 dark:text-red-400">{job.error ?? 'The analysis failed.'}</p>
        {job.raw ? (
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 text-xs leading-relaxed dark:bg-[rgb(var(--panel)/0.3)]">
            {job.raw}
          </pre>
        ) : null}
      </div>
    )
  }
  const d = job.data
  const emotion = [d.primary_emotion, d.secondary_emotion].filter((e): e is string => Boolean(e))
  const extras = Object.entries(d).filter(([k]) => !KNOWN_FIELDS.includes(k))
  return (
    <div className="space-y-8">
      {/* The kernel is the answer; it lands first and largest. */}
      <div>
        <p className={LABEL}>The moment, read as students</p>
        <p className="mt-2 text-lg leading-relaxed">{d.event_kernel ?? <span className="text-[rgb(var(--muted))]">no kernel returned</span>}</p>
        {d.social_logic ? (
          <p className="mt-3 text-base italic leading-relaxed">&ldquo;{d.social_logic.replace(/^[“"]|[”"]$/g, '')}&rdquo;</p>
        ) : null}
      </div>

      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <Field label="What students are doing">{d.shared_behavior ?? '—'}</Field>
        <Field label={emotion.length > 1 ? 'Emotion, primary then secondary' : 'Emotion'}>
          {emotion.length ? emotion.join(', then ') : '—'}
        </Field>
        <Field label="What feels at stake">{d.student_stake ?? '—'}</Field>
        <Field label="The level a reaction should work at">{d.recommended_abstraction ?? '—'}</Field>
      </dl>

      <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <Field label="Shared signals across the posts">
          <Items items={d.shared_signals} />
        </Field>
        <Field label="Anchors a scrolling student would recognize">
          <Items items={d.good_social_anchors} />
        </Field>
        <Field label="Incidental details from single posts">
          <Items items={d.incidental_details} />
        </Field>
        <Field label="Do not require the reader to know">
          <Items items={d.avoid_as_required_context} />
        </Field>
      </dl>

      {extras.length ? (
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {extras.map(([k, v]) => (
            <Field key={k} label={words(k)}>
              <Generic value={v} />
            </Field>
          ))}
        </dl>
      ) : null}

      <details>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
          What was sent, and the JSON that came back
          {job.durationMs ? ` (${Math.round(job.durationMs / 1000)}s)` : ''}
        </summary>
        {job.sentPrompt ? (
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 text-xs leading-relaxed dark:bg-[rgb(var(--panel)/0.3)]">
            {job.sentPrompt}
          </pre>
        ) : null}
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 text-xs leading-relaxed dark:bg-[rgb(var(--panel)/0.3)]">
          {job.raw ?? JSON.stringify(d, null, 2)}
        </pre>
      </details>
    </div>
  )
}

// The read as a joke prompt reads it: labeled lines, not braces. Fills
// {{STUDENT_READ}} in the flavor's step 2. Lists become comma-separated;
// fields the read lacks are left out.
export function studentReadAsText(d: StudentRead): string {
  const line = (label: string, value: unknown): string | null => {
    if (value == null || value === '') return null
    const text = Array.isArray(value) ? value.map(String).join('; ') : String(value)
    return text ? `${label}: ${text}` : null
  }
  return [
    line('Event kernel', d.event_kernel),
    line('What students are doing', d.shared_behavior),
    line('Primary emotion', d.primary_emotion),
    line('Secondary emotion', d.secondary_emotion),
    line('What feels at stake', d.student_stake),
    line('The student thought behind it', d.social_logic),
    line('Recommended level of abstraction', d.recommended_abstraction),
    line('Shared signals', d.shared_signals),
    line('Social anchors a scrolling student recognizes', d.good_social_anchors),
    line('Incidental details (do not lean on these)', d.incidental_details),
    line('Not required context (readers may not know these)', d.avoid_as_required_context),
  ]
    .filter((l): l is string => Boolean(l))
    .join('\n')
}
