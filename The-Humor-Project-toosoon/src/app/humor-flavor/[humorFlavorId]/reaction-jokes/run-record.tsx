'use client'

// The browser record the Reaction Joke Maker keeps, shared by the working
// page and the past-runs page. One record per flavor in IndexedDB: the
// current run (moments, persona, jokes from each source, student reads),
// the hearted jokes, and the past runs. A run is one persona on one list of
// moments; jokes from another persona or another moment list are a
// different run, and belong on the past-runs page, not beside the current
// ones (Lydia, 2026-09-08: "this page mixes all the past results with the
// current results").
import type { HeartedJoke } from './hearted-jokes'
import type { AnalysisJob, RefineJob } from './joke-analysis'
import type { WorkshopChat } from './joke-workshop'
import type { EvalJob } from './joke-evaluation'
import type { StudentReadJob } from './student-read'

// Where a set of jokes came from: the persona alone (the flavor's step 1),
// or the persona plus the Student Read of the moment (step 2).
export type Source = 'persona' | 'persona-read'
export const SOURCE_LABEL: Record<Source, string> = {
  persona: 'from the persona alone',
  'persona-read': 'from the persona and the student read',
}

export type Job = {
  moment: string
  persona: string
  // Missing on records saved before step 2 existed: those are step 1's.
  source?: Source
  status: 'running' | 'done' | 'failed'
  jokes?: string[]
  raw?: string
  sentPrompt?: string
  error?: string
  durationMs?: number
  finishedAt?: string
  // One evaluation per joke index, from the persona's evaluator prompt.
  evals?: Record<number, EvalJob>
  // Which evaluator file scored them, so a newer one reads as stale.
  evaluatorFile?: string
  // On a flavor with an analyzer (step 3): one analysis per joke index, and
  // which comic-moves catalog file it used.
  analyses?: Record<number, AnalysisJob>
  comicMovesFile?: string
  // On a flavor with a refiner (step 4): variants per joke index, only for
  // jokes the analysis marked refine_execution. The original is never
  // overwritten; a hearted variant is its own hearted joke.
  refinements?: Record<number, RefineJob>
  // The workshop chat per joke index (flavor 1564's pane), saved with the run.
  workshops?: Record<number, WorkshopChat>
  // What wrote them (Lydia, 2026-09-09: a run file that does not name its
  // model is indistinguishable from one on another model later).
  model?: string
  reasoningEffort?: string
}

// A run that left the working page: replaced by a run with another persona
// or other moments, re-run for the same source, cleared, or found mixed in
// with the current run when the page loaded.
export type PastRun = {
  id: string
  personaName: string
  moments: string[]
  jobs: Record<number, Job>
  readJobs: Record<number, Job>
  studentReads: Record<number, StudentReadJob>
  archivedAt: string
  // Why it left the working page, in a phrase.
  note: string
  // How many jokes per moment the run asked for, when known.
  jokeCount?: number
  // The model and reasoning effort the run's calls used, when known.
  model?: string
  reasoningEffort?: string
}

export type Saved = {
  moments?: string[]
  personaName?: string
  // How many jokes each call asks for ({{JOKE_COUNT}}).
  jokeCount?: number
  jobs?: Record<number, Job>
  // Step 2's jokes (persona + student read), by the moment's index.
  readJobs?: Record<number, Job>
  // The student read of each moment, by the moment's index.
  studentReads?: Record<number, StudentReadJob>
  // The keepers. Outlive a run: clearing the run leaves these alone.
  hearted?: HeartedJoke[]
  // Newest first.
  history?: PastRun[]
}

// A frozen copy of the working page for a share link (table
// reaction_joke_shares): the run as it stood, plus every heart, since the
// hearts section shows them all. No history: a link is one run.
export type RunSnapshot = {
  moments: string[]
  personaName: string
  jokeCount: number
  jobs: Record<number, Job>
  readJobs: Record<number, Job>
  studentReads: Record<number, StudentReadJob>
  hearted: HeartedJoke[]
}

// A shared run as the page receives it: the snapshot, and who shared it when.
export type SharedRun = {
  id: string
  snapshot: RunSnapshot
  sharedBy: string
  sharedAt: string
}

export const storageKey = (flavorId: number) => `reaction-jokes:${flavorId}`

// A call that was running when the tab closed never finished.
export const finishInterrupted = (record: Record<number, Job> | undefined): Record<number, Job> => {
  const restored: Record<number, Job> = {}
  for (const [k, job] of Object.entries(record ?? {})) {
    const evals = Object.fromEntries(
      Object.entries(job.evals ?? {}).map(([i, e]) => [
        i,
        e.status === 'running' ? { status: 'failed', error: 'Scoring was interrupted.' } : e,
      ])
    ) as Record<number, EvalJob>
    const analyses = Object.fromEntries(
      Object.entries(job.analyses ?? {}).map(([i, a]) => [
        i,
        a.status === 'running' ? { status: 'failed', error: 'The analysis was interrupted.' } : a,
      ])
    ) as Record<number, AnalysisJob>
    const refinements = Object.fromEntries(
      Object.entries(job.refinements ?? {}).map(([i, r]) => [
        i,
        r.status === 'running' ? { status: 'failed', error: 'The refinement was interrupted.' } : r,
      ])
    ) as Record<number, RefineJob>
    const workshops = Object.fromEntries(
      Object.entries(job.workshops ?? {}).map(([i, w]) => [i, w.pending ? { ...w, pending: false, error: 'The answer was interrupted.' } : w])
    ) as Record<number, WorkshopChat>
    const extras = {
      evals,
      ...(job.analyses ? { analyses } : {}),
      ...(job.refinements ? { refinements } : {}),
      ...(job.workshops ? { workshops } : {}),
    }
    restored[Number(k)] =
      job.status === 'running'
        ? { ...job, status: 'failed', error: 'This call was still running when the page was closed.', ...extras }
        : { ...job, ...extras }
  }
  return restored
}

export const finishInterruptedReads = (
  record: Record<number, StudentReadJob> | undefined
): Record<number, StudentReadJob> =>
  Object.fromEntries(
    Object.entries(record ?? {}).map(([k, r]) => [
      k,
      r.status === 'running'
        ? { ...r, status: 'failed', error: 'This analysis was still running when the page was closed.' }
        : r,
    ])
  )

// Does this job belong to the run defined by this persona and these moments?
export const belongsToRun = (job: Job, index: number, personaName: string, moments: string[]): boolean =>
  job.persona === personaName && job.moment === (moments[index] ?? '').trim()

// The moments a set of jobs was run on, by index.
export const momentsOf = (...records: Array<Record<number, Job>>): string[] => {
  const out: string[] = []
  for (const record of records) {
    for (const [k, job] of Object.entries(record)) out[Number(k)] = job.moment
  }
  return Array.from(out, (m) => m ?? '')
}

const runId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

// Packs jobs (from either or both sources) as one past run.
export const makePastRun = (
  jobs: Record<number, Job>,
  readJobs: Record<number, Job>,
  studentReads: Record<number, StudentReadJob>,
  note: string
): PastRun | null => {
  const any = Object.values(jobs)[0] ?? Object.values(readJobs)[0]
  if (!any) return null
  return {
    id: runId(),
    personaName: any.persona,
    model: any.model,
    reasoningEffort: any.reasoningEffort,
    moments: momentsOf(jobs, readJobs),
    jobs,
    readJobs,
    studentReads,
    archivedAt: new Date().toISOString(),
    note,
  }
}

// Splits a loaded record into the jobs that belong to its current run and,
// grouped by persona, past runs for the ones that do not. Records saved
// before runs were separated could hold both.
export const separateStrays = (saved: Saved): { jobs: Record<number, Job>; readJobs: Record<number, Job>; strays: PastRun[] } => {
  const personaName = saved.personaName ?? ''
  const moments = saved.moments ?? []
  const keep = { jobs: {} as Record<number, Job>, readJobs: {} as Record<number, Job> }
  const stray: Record<string, { jobs: Record<number, Job>; readJobs: Record<number, Job> }> = {}
  for (const which of ['jobs', 'readJobs'] as const) {
    for (const [k, job] of Object.entries(saved[which] ?? {})) {
      const index = Number(k)
      if (belongsToRun(job, index, personaName, moments)) keep[which][index] = job
      else {
        stray[job.persona] ??= { jobs: {}, readJobs: {} }
        stray[job.persona][which][index] = job
      }
    }
  }
  const strays = Object.values(stray)
    .map((s) => makePastRun(s.jobs, s.readJobs, {}, 'separated from the current run when the page loaded'))
    .filter((r): r is PastRun => r != null)
  return { ...keep, strays }
}

// The latest time any of a run's calls finished.
export const lastFinishedAt = (run: PastRun): string | null => {
  const times = [...Object.values(run.jobs), ...Object.values(run.readJobs)]
    .map((j) => j.finishedAt)
    .filter((t): t is string => Boolean(t))
    .sort()
  return times[times.length - 1] ?? null
}

// One heart shape for both states, so the filled and the outlined heart are
// the same outline: the two Unicode glyphs are drawn differently by the font.
export function HeartIcon({ filled, size = 22 }: { filled: boolean; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinejoin="round"
    >
      <path d="M12 20.5s-7.5-4.6-9.4-9.3C1.2 7.7 3.3 4.5 6.6 4.5c2 0 3.6 1.1 4.4 2.6.8-1.5 2.4-2.6 4.4-2.6 3.3 0 5.4 3.2 4 6.7-1.9 4.7-9.4 9.3-9.4 9.3z" />
    </svg>
  )
}
