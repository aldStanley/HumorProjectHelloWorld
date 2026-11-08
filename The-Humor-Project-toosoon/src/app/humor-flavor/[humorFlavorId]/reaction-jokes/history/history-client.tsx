'use client'

// The past runs of the Reaction Joke Maker, from the browser record the
// working page writes. Read-only except for two moves per run: back to the
// working page, or deleted. Selection left (which run), details right (that
// run's moments and jokes), per the standing rule.
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PovStep } from '../../pov-jokes/pov-jokes-client'
import { loadRecord, saveRecord } from '../../pov-jokes/pov-jokes-store'
import { CopyButton, FIELD_HELP, SECTION, SECTION_NUMBER, SMALL_BUTTON } from '../../pov-jokes/pov-jokes-ui'
import type { AnalysisPrompt } from '../analysis-prompts'
import type { EvaluatorPrompt } from '../evaluator-prompts'
import { HeartedJokesSection, heartId, type HeartedJoke, type MemePicture } from '../hearted-jokes'
import { ACTION_LABEL, VariantList } from '../joke-analysis'
import type { PersonaPrompt } from '../persona-pov-prompts'
import { buildRunBundle } from '../run-bundle'
import {
  HeartIcon,
  SOURCE_LABEL,
  finishInterrupted,
  lastFinishedAt,
  makePastRun,
  storageKey,
  type Job,
  type PastRun,
  type Saved,
  type Source,
} from '../run-record'

const when = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// One set of jokes, read-only: numeral, joke, score when scored, heart when
// hearted. Same row shape as the working page, so the eye reads it the same.
function PastJokes({
  job,
  label,
  isHearted,
  onToggleHeart,
}: {
  job: Job
  label: string
  isHearted: (caption: string) => boolean
  // refinedFrom is the original joke when the caption is one of its variants.
  onToggleHeart: (caption: string, refinedFrom?: string) => void
}) {
  const evals = job.evals ?? {}
  const hasEvals = Object.keys(evals).length > 0
  const analyses = job.analyses ?? {}
  const hasAnalyses = Object.keys(analyses).length > 0
  const analyzed = Object.values(analyses).filter((a) => a.status === 'done' && a.data?.action)
  const n = (action: string) => analyzed.filter((a) => a.data?.action === action).length
  return (
    <div className="mt-6 min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
        {job.status === 'failed'
          ? `The call ${label} failed`
          : `${job.jokes?.length ?? 0} jokes ${label}${
              hasEvals ? `, ${Object.values(evals).filter((e) => e.status === 'done').length} scored` : ''
            }${hasAnalyses ? `, analyzed: ${n('keep')} keep, ${n('refine_execution')} refine, ${n('reject')} reject` : ''}`}
      </p>
      {job.status === 'failed' ? <p className="mt-2 text-sm text-red-700 dark:text-red-400">{job.error}</p> : null}
      <ol className="mt-4 space-y-4">
        {(job.jokes ?? []).map((joke, i) => {
          const score = evals[i]?.data?.score
          const hearted = isHearted(joke)
          const an = analyses[i]?.status === 'done' ? analyses[i].data : undefined
          const rf = job.refinements?.[i]
          const columns =
            hasAnalyses && hasEvals
              ? 'grid-cols-[2.5rem_2rem_minmax(0,1fr)_3.5rem_3.5rem]'
              : hasAnalyses || hasEvals
                ? 'grid-cols-[2.5rem_2rem_minmax(0,1fr)_3.5rem]'
                : 'grid-cols-[2.5rem_2rem_minmax(0,1fr)]'
          return (
            <li key={i} className={`grid items-baseline gap-x-3 ${columns}`}>
              <span className="text-lg font-semibold text-[rgb(var(--muted))]">{i + 1}</span>
              <button
                type="button"
                aria-pressed={hearted}
                aria-label={hearted ? 'Remove the heart from this joke' : 'Heart this joke'}
                title={
                  hearted
                    ? 'Remove the heart from this joke'
                    : 'Heart this joke: it goes to the meme section at the end of this page'
                }
                onClick={() => onToggleHeart(joke)}
                className={`self-center transition ${
                  hearted
                    ? 'text-[rgb(var(--accent-strong))]'
                    : 'text-[rgb(var(--muted)/0.55)] hover:text-[rgb(var(--accent-strong))]'
                }`}
              >
                <HeartIcon filled={hearted} size={18} />
              </button>
              <div className="min-w-0">
                <p className="text-base leading-relaxed">{joke}</p>
                {an ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-[rgb(var(--muted))]">
                    <span className="font-semibold uppercase tracking-[0.12em]">Premise </span>
                    {an.premise ?? '–'}
                    {an.primary_move ? ` · ${[an.primary_move, ...(an.supporting_moves ?? [])].map((m) => m.replace(/_/g, ' ')).join(', ')}` : ''}
                    {an.specific_problem ? ` · problem: ${an.specific_problem}` : ''}
                  </p>
                ) : null}
                {rf ? (
                  <VariantList job={rf} isHearted={isHearted} onToggleHeart={(c) => onToggleHeart(c, joke)} />
                ) : null}
              </div>
              {hasAnalyses ? (
                <span className={`text-right text-sm ${an?.action === 'keep' ? 'font-semibold' : an?.action === 'reject' ? 'text-[rgb(var(--muted))]' : ''}`}>
                  {an?.action ? ACTION_LABEL[an.action] : ''}
                </span>
              ) : null}
              {hasEvals ? (
                <span className="text-right text-base font-semibold tabular-nums">
                  {typeof score === 'number' ? `${score}%` : ''}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default function HistoryClient({
  flavorId,
  steps,
  personas,
  evaluators,
  studentRead,
}: {
  flavorId: number
  steps: PovStep[]
  personas: PersonaPrompt[]
  evaluators: EvaluatorPrompt[]
  studentRead: AnalysisPrompt | null
}) {
  const [saved, setSaved] = useState<Saved | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const record = await loadRecord<Saved>(storageKey(flavorId))
        if (!cancelled) setSaved(record ?? {})
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [flavorId])

  // The latest record, for updates that arrive faster than a render (a
  // heart, then a picture): each one builds on the last, not on a stale
  // closure.
  const latest = useRef<Saved | null>(null)
  latest.current = saved
  const persist = useCallback(
    (next: Saved) => {
      latest.current = next
      setSaved(next)
      saveRecord(storageKey(flavorId), next).catch((err) => setError(err instanceof Error ? err.message : String(err)))
    },
    [flavorId]
  )
  const updateHearted = useCallback(
    (fn: (prev: HeartedJoke[]) => HeartedJoke[]) => {
      const cur = latest.current
      if (!cur) return
      persist({ ...cur, hearted: fn(cur.hearted ?? []) })
    },
    [persist]
  )

  // ---- hearts, the same keepers list the working page uses
  const toggleHeart = useCallback(
    (job: Job, caption: string, refinedFrom?: string) => {
      const id = heartId(job.persona, job.moment, caption)
      updateHearted((prev) =>
        prev.some((h) => h.id === id)
          ? prev.filter((h) => h.id !== id)
          : [
              {
                id,
                caption,
                persona: job.persona,
                moment: job.moment,
                heartedAt: new Date().toISOString(),
                ...(refinedFrom ? { refinedFrom } : {}),
              },
              ...prev,
            ]
      )
    },
    [updateHearted]
  )
  const unheart = useCallback((id: string) => updateHearted((prev) => prev.filter((h) => h.id !== id)), [updateHearted])
  const setVisualWords = useCallback(
    (id: string, words: string[]) =>
      updateHearted((prev) => prev.map((h) => (h.id === id ? { ...h, visualWords: words } : h))),
    [updateHearted]
  )
  const setPicture = useCallback(
    (id: string, frameId: string, picture: MemePicture | null) =>
      updateHearted((prev) =>
        prev.map((h) => {
          if (h.id !== id) return h
          const memes = { ...(h.memes ?? {}) }
          if (picture) memes[frameId] = picture
          else delete memes[frameId]
          return { ...h, memes }
        })
      ),
    [updateHearted]
  )

  const history = useMemo(() => saved?.history ?? [], [saved])
  const heartedIds = useMemo(() => new Set((saved?.hearted ?? []).map((h) => h.id)), [saved])
  const run = history.find((r) => r.id === selectedId) ?? history[0] ?? null
  // The hearts that belong to the selected run: its persona on its moments.
  const runHearted = useMemo(() => {
    if (!run) return []
    const runMoments = new Set([...Object.values(run.jobs), ...Object.values(run.readJobs)].map((j) => j.moment))
    return (saved?.hearted ?? []).filter((h) => h.persona === run.personaName && runMoments.has(h.moment))
  }, [run, saved])
  // The selected run as one document, for its copy button.
  const bundle = useMemo(() => {
    if (!run) return null
    const persona = personas.find((p) => p.name === run.personaName) ?? null
    return buildRunBundle({
      flavorId,
      label: 'a past run',
      personaName: run.personaName,
      persona,
      step1: steps.find((s) => s.orderBy === 1) ?? null,
      step2: steps.find((s) => s.orderBy === 2) ?? null,
      studentReadPrompt: studentRead,
      evaluator: (persona && evaluators.find((e) => e.personaFolder === persona.folder)) ?? null,
      jokeCount: run.jokeCount,
      moments: run.moments,
      studentReads: run.studentReads,
      jobs: run.jobs,
      readJobs: run.readJobs,
      hearted: saved?.hearted ?? [],
      note: `Left the working page ${when(run.archivedAt)}: ${run.note}. The prompts shown are the versions on file now, which may be newer than the ones this run used.`,
    })
  }, [run, personas, steps, evaluators, studentRead, flavorId, saved])

  // A run written by scripts/reaction-jokes-run.mjs, in the record's own
  // shape. Checked for the fields the pages read before it is kept.
  const importFile = useCallback(
    async (file: File) => {
      if (!saved) return
      setImportError(null)
      try {
        const parsed = JSON.parse(await file.text()) as Partial<PastRun>
        const ok =
          parsed &&
          typeof parsed.personaName === 'string' &&
          Array.isArray(parsed.moments) &&
          typeof parsed.jobs === 'object' &&
          Object.values(parsed.jobs ?? {}).every((j) => j && typeof j.moment === 'string' && Array.isArray(j.jokes))
        if (!ok) throw new Error('not a run: it needs personaName, moments, and jobs with moment and jokes')
        const run: PastRun = {
          id: `${Date.now().toString(36)}-import`,
          personaName: parsed.personaName!,
          moments: parsed.moments!,
          jobs: finishInterrupted(parsed.jobs),
          readJobs: finishInterrupted(parsed.readJobs),
          studentReads: parsed.studentReads ?? {},
          archivedAt: new Date().toISOString(),
          note: `brought in from ${file.name}${parsed.note ? `: ${parsed.note}` : ''}`,
          jokeCount: parsed.jokeCount,
        }
        persist({ ...saved, history: [run, ...history] })
        setSelectedId(run.id)
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err))
      }
    },
    [saved, history, persist]
  )

  const remove = useCallback(
    (id: string) => {
      if (!saved) return
      persist({ ...saved, history: history.filter((r) => r.id !== id) })
      if (selectedId === id) setSelectedId(null)
    },
    [saved, history, persist, selectedId]
  )

  // Swaps the run with whatever the working page holds: that goes to the
  // past, this comes back.
  const restore = useCallback(
    (r: PastRun) => {
      if (!saved) return
      const displaced = makePastRun(
        finishInterrupted(saved.jobs),
        finishInterrupted(saved.readJobs),
        saved.studentReads ?? {},
        `replaced when the run as ${r.personaName} came back`
      )
      persist({
        ...saved,
        moments: r.moments.length ? r.moments : [''],
        personaName: r.personaName,
        jobs: r.jobs,
        readJobs: r.readJobs,
        studentReads: r.studentReads,
        history: [...(displaced ? [displaced] : []), ...history.filter((x) => x.id !== r.id)],
      })
      setSelectedId(null)
    },
    [saved, history, persist]
  )

  if (error)
    return <p className="text-sm text-red-700 dark:text-red-400">This browser could not read its record: {error}</p>
  if (!saved) return <p className="text-sm text-[rgb(var(--muted))]">Reading this browser&rsquo;s record…</p>
  const importControl = (
    <div className="mb-8 max-w-3xl">
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importFile(f)
          e.target.value = ''
        }}
      />
      <button type="button" className={SMALL_BUTTON} onClick={() => fileInput.current?.click()}>
        Bring in a run from a file
      </button>
      <p className={FIELD_HELP}>
        A JSON run written by scripts/reaction-jokes-run.mjs, in this page&rsquo;s own shape. It lands here as a past
        run; &ldquo;Bring this run back to the working page&rdquo; then puts it on the working page.
      </p>
      {importError ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">Not brought in: {importError}</p>
      ) : null}
    </div>
  )

  if (!history.length) {
    return (
      <div>
        {importControl}
        <p className="max-w-3xl text-sm leading-relaxed text-[rgb(var(--muted))]">
          No past runs yet. A run lands here when the working page replaces it: a run as another persona, on other
          moments, or a re-run of the same source.{' '}
          <Link
            href={`/humor-flavor/${flavorId}/reaction-jokes`}
            className="font-semibold hover:text-[rgb(var(--accent-strong))]"
          >
            Back to the working page.
          </Link>
        </p>
      </div>
    )
  }

  const momentIndices = run
    ? [...new Set([...Object.keys(run.jobs), ...Object.keys(run.readJobs)].map(Number))].sort((a, b) => a - b)
    : []
  const sourcesOf = (r: PastRun): Source[] =>
    (['persona', 'persona-read'] as const).filter((s) => Object.keys(s === 'persona' ? r.jobs : r.readJobs).length)

  return (
    <div>
      {importControl}
      <div className="lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-x-10">
        {/* ---- the runs, newest first */}
        <div>
          <p className="text-sm font-semibold">{count(history.length, 'past run')}</p>
          <div className="mt-3 space-y-1">
            {history.map((r) => {
              const selected = run?.id === r.id
              const n = Math.max(Object.keys(r.jobs).length, Object.keys(r.readJobs).length)
              return (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedId(r.id)}
                  className={`block w-full rounded-lg border-2 px-3 py-2 text-left transition ${
                    selected
                      ? 'border-current bg-[rgb(var(--panel))] dark:bg-[rgb(var(--panel)/0.5)]'
                      : 'border-transparent hover:bg-[rgb(var(--panel)/0.8)]'
                  }`}
                >
                  <span className={`block text-base ${selected ? 'font-semibold' : ''}`}>{r.personaName}</span>
                  <span className="block text-[11px] text-[rgb(var(--muted))]">
                    {count(n, 'moment')} ·{' '}
                    {sourcesOf(r)
                      .map((s) => SOURCE_LABEL[s])
                      .join(' and ')}
                  </span>
                  <span className="block text-[11px] text-[rgb(var(--muted))]">
                    {when(lastFinishedAt(r) ?? r.archivedAt)} · {r.note}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ---- the selected run */}
        {run ? (
          <section className={`${SECTION} mt-8 min-w-0 lg:mt-0`}>
            <p className={SECTION_NUMBER}>Past run</p>
            <h2 className="mt-2 text-2xl font-semibold">
              {run.personaName} on {count(momentIndices.length, 'moment')}
            </h2>
            <p className={FIELD_HELP}>
              Written {when(lastFinishedAt(run))}
              {run.model ? ` on ${run.model}${run.reasoningEffort ? ` at ${run.reasoningEffort} effort` : ''}` : ''}. Left
              the working page {when(run.archivedAt)}: {run.note}.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className={SMALL_BUTTON}
                onClick={() => restore(run)}
                title="Puts this run's moments, persona, jokes, and reads back on the working page. Whatever is on the working page now comes here."
              >
                Bring this run back to the working page
              </button>
              {bundle ? <CopyButton text={bundle} label="Copy this run as one document" /> : null}
              <button
                type="button"
                className={SMALL_BUTTON}
                title="Saves this run as JSON in the record's own shape, with the hearts that belong to it, for scripts/reaction-jokes-hearts-analysis.mjs"
                onClick={() => {
                  const blob = new Blob([JSON.stringify({ ...run, hearted: runHearted }, null, 2)], {
                    type: 'application/json',
                  })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `reaction-jokes-${run.personaName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${run.id}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                Download this run as JSON with its hearts
              </button>
              <button
                type="button"
                className={SMALL_BUTTON}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete this run as ${run.personaName}? Its jokes and scores are gone for good. Hearted jokes stay.`
                    )
                  )
                    remove(run.id)
                }}
              >
                Delete this run
              </button>
            </div>

            <div className="mt-8 space-y-10">
              {momentIndices.map((index) => {
                const job = run.jobs[index] ?? null
                const readJob = run.readJobs[index] ?? null
                const moment = (job ?? readJob)?.moment ?? run.moments[index] ?? ''
                const read = run.studentReads[index]?.data
                return (
                  <article
                    key={index}
                    className="border-t border-[rgb(var(--gloss)/0.4)] pt-8 dark:border-[rgb(var(--gloss)/0.15)]"
                  >
                    <p className={SECTION_NUMBER}>Moment {index + 1}</p>
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed">{moment}</p>
                    {read?.event_kernel ? (
                      <p className="mt-2 max-w-3xl text-sm italic leading-relaxed text-[rgb(var(--muted))]">
                        Student read: {read.event_kernel}
                      </p>
                    ) : null}
                    <div className="lg:grid lg:grid-cols-2 lg:gap-x-10">
                      <div className="min-w-0">
                        {job ? (
                          <PastJokes
                            job={job}
                            label={SOURCE_LABEL.persona}
                            isHearted={(c) => heartedIds.has(heartId(job.persona, job.moment, c))}
                            onToggleHeart={(c, from) => toggleHeart(job, c, from)}
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        {readJob ? (
                          <PastJokes
                            job={readJob}
                            label={SOURCE_LABEL['persona-read']}
                            isHearted={(c) => heartedIds.has(heartId(readJob.persona, readJob.moment, c))}
                            onToggleHeart={(c, from) => toggleHeart(readJob, c, from)}
                          />
                        ) : null}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ) : null}
      </div>

      {/* ---- the keepers from this run, with the same meme tools as the
          working page. Hearts are one list across both pages; this shows the
          ones that belong to the selected run. */}
      {run ? (
        <div className="mt-8">
          <HeartedJokesSection
            hearted={runHearted}
            step={steps.find((s) => s.orderBy === 1) ?? null}
            onUnheart={unheart}
            onSetPicture={setPicture}
            onSetVisualWords={setVisualWords}
            header={{
              number: 'The hearted jokes of this past run',
              scope: `Every joke hearted from the run as ${run.personaName} above, newest first. The same hearts show on the working page's step 5, with the same pictures.`,
              emptyNote: 'Nothing hearted from this run yet. Every joke above has a heart beside it.',
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
