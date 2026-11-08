'use client'

// Reaction Joke Maker (/reaction-jokes) — the simplest moment surface.
//
// Five numbered sections: the moments, the student read of each moment, the
// persona, the jokes, the memes. The flavor has ONE step, whose prompt takes
// {{PERSONA}}, {{MOMENT}}, and {{JOKE_COUNT}} and returns that many jokes one per
// line (the count is a field on the page, DEFAULT_JOKE_COUNT to start). The page fans
// that step out over the moments, three at a time, and lays the lines out as
// a numbered list. The persona text is not typed here: it is the file's text
// for the persona picked, passed through from the server. The student read is
// a second prompt file ({{EVENT}} in, JSON out), run once per moment on the
// same model. The flavor's step 2 is a SIBLING of step 1, not a successor: the
// same job with {{STUDENT_READ}} added, offered as a second button so the two
// sets of jokes can be compared moment by moment.
//
// A flavor with steps 3 and 4 (flavor 1564) analyzes its jokes AFTER they
// exist: step 3, one call per joke, reconstructs the premise, labels comic
// moves against the catalog file, judges the idea and the wording
// separately, and marks keep | refine | reject; step 4 rewrites only the
// marked ones, keeping the premise. The writer never sees the catalog
// (Lydia, 2026-09-09: "do NOT let the analyzer affect the initial
// voice-first generation"). Both live inside section 4, per joke set.
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PovStep } from '../pov-jokes/pov-jokes-client'
import { loadRecord, saveRecord } from '../pov-jokes/pov-jokes-store'
import {
  BIG_BUTTON,
  CopyButton,
  FIELD_HELP,
  FIELD_LABEL,
  GOAL_TEXT,
  SECTION,
  SECTION_NUMBER,
  SECTION_TITLE,
  SMALL_BUTTON,
  TEXTAREA,
} from '../pov-jokes/pov-jokes-ui'
import { runStepWithSession } from '../pov-jokes/run-step'
import { chatAction } from '../chiltrix/actions'
import { SidechatMomentPicker } from '../pov-jokes/sidechat-moment-picker'
import type { AnalysisPrompt } from './analysis-prompts'
import type { PersonaPrompt } from './persona-pov-prompts'
import type { EvaluatorPrompt } from './evaluator-prompts'
import { HeartedJokesSection, heartId, type HeartedJoke, type MemePicture } from './hearted-jokes'
import {
  ActionLabel,
  AnalysisInline,
  AnalysisScoreCell,
  VariantList,
  analysisScore,
  parseAnalysis,
  parseVariants,
  type AnalysisJob,
  type RefineJob,
} from './joke-analysis'
import { EvaluationPanel, ScoreCell, parseEvaluation, type EvalJob } from './joke-evaluation'
import { WORKSHOP_EFFORT, WORKSHOP_MODEL, WorkshopPane, workshopSystemPrompt, type WorkshopChat } from './joke-workshop'
import { saveWorkshopAction } from './workshop-actions'
import { shareRunAction } from './share-actions'
import { PersonaPromptView } from './persona-prompt-view'
import { buildRunBundle } from './run-bundle'
import {
  HeartIcon,
  SOURCE_LABEL,
  belongsToRun,
  finishInterrupted,
  finishInterruptedReads,
  makePastRun,
  separateStrays,
  storageKey,
  type Job,
  type PastRun,
  type RunSnapshot,
  type Saved,
  type SharedRun,
  type Source,
} from './run-record'
import { StudentReadPanel, parseStudentRead, studentReadAsText, type StudentReadJob } from './student-read'

// How many per-moment calls are in flight at once.
const CONCURRENCY = 3
// How many jokes each moment's call asks for, until the field on the page is
// changed. Fills {{JOKE_COUNT}} in both steps' prompts.
const DEFAULT_JOKE_COUNT = 5
// High for every call this page makes: the jokes, the student reads, and
// the scoring (Lydia, 2026-09-09: "change the reasoning to high for all
// future runs. That should be the default"). It ran at medium before. The
// face tagging and visual-word calls in the meme section stay at low; they
// are lookups, not runs.
const REASONING_EFFORT = 'high' as const
// These budgets are max_completion_tokens, which on GPT-5 models INCLUDES
// the reasoning tokens. At high effort the model can spend several thousand
// on reasoning before writing a word, and a budget it exhausts there comes
// back as an empty answer (seen on the first high-effort command-line run
// at 8,000). So each is a multiple of what the answer itself needs.
const MAX_OUTPUT_TOKENS = 24000
// The evaluator returns a few hundred tokens of JSON per joke.
const EVAL_MAX_OUTPUT_TOKENS = 12000
// The student read is eleven short JSON fields.
const STUDENT_READ_MAX_OUTPUT_TOKENS = 12000
// The analyzer returns one short JSON object per joke; the refiner two or
// three variants.
const ANALYSIS_MAX_OUTPUT_TOKENS = 12000
const REFINE_MAX_OUTPUT_TOKENS = 12000

const fillTemplate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole
  )

const unfilledPlaceholders = (filled: string): string[] => [
  ...new Set([...filled.matchAll(/\{\{\s*([A-Z_]+)\s*\}\}/g)].map((m) => m[1])),
]

// "Output only the jokes, one per line." Models still number or bullet them
// sometimes, and some wrap the list in a code fence; strip both.
const parseJokes = (raw: string): string[] =>
  raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line && !line.startsWith('```'))

const shorten = (text: string, n: number) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text)

const seconds = (ms?: number) => (ms == null ? '' : `${Math.round(ms / 1000)}s`)

// The two source columns: the buttons at the top of section 4 and every
// moment's two sets use the same grid, so a set sits under its button.
const SET_COLUMNS = 'lg:grid lg:grid-cols-2 lg:gap-x-10'

type NavEntry = {
  id: string
  label: string
  note?: string
  children: NavEntry[]
}

// Sticky table of contents: the five sections, and under the jokes section
// one entry per moment with where its call stands. Hidden below lg, where the
// page is one column and scrolling is the navigation.
// Where the share-by-link press stands.
type ShareState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'done'; url: string }
  | { status: 'failed'; error: string }

function PageNav({
  entries,
  onClear,
  canClear,
  historyCount,
  historyHref,
  workshopsHref,
  bundle,
  shared,
  onShare,
  shareState,
}: {
  entries: NavEntry[]
  onClear: () => void
  canClear: boolean
  historyCount: number
  historyHref: string
  // The saved-chats page, on flavors with the workshop pane.
  workshopsHref: string | null
  // The current run as one markdown document, or null when there is none.
  bundle: string | null
  // Viewing someone's shared run: no clearing, sharing, or past runs.
  shared: boolean
  onShare: () => void
  shareState: ShareState
}) {
  return (
    <nav
      aria-label="Sections of this page"
      className="sticky top-6 hidden max-h-[calc(100vh-3rem)] w-64 shrink-0 self-start overflow-y-auto pb-8 lg:block"
    >
      {shared ? null : (
        <button
          type="button"
          className={`${SMALL_BUTTON} w-full text-left`}
          disabled={!canClear}
          onClick={onClear}
          title="Moves this run to the past-runs page and empties the moments, the persona choice, and every set of jokes here. Hearted jokes in step 5 stay."
        >
          {canClear ? 'Put this run in the past and start over' : 'Nothing here to put in the past'}
        </button>
      )}
      {bundle ? (
        <div className="mt-3">
          <CopyButton text={bundle} label="Copy this run as one document" />
          <p className="mt-1 text-[11px] text-[rgb(var(--muted))]">
            Persona prompt, step prompts, every moment with its student read, every joke with its score and
            heart. Markdown, {Math.round(bundle.length / 1000)}k characters, ready to paste into a critic.
          </p>
        </div>
      ) : null}
      {bundle && !shared ? (
        <div className="mt-3">
          <button
            type="button"
            className={`${SMALL_BUTTON} w-full text-left`}
            disabled={shareState.status === 'saving'}
            onClick={onShare}
            title="Saves a frozen copy of this run to the database and gives you a link that shows it to anyone signed in."
          >
            {shareState.status === 'saving' ? 'Saving the run…' : 'Share this run by link'}
          </button>
          <p className="mt-1 text-[11px] text-[rgb(var(--muted))]">
            Saves a copy of these moments, jokes, and hearts as they are now. Anyone signed in can open the
            link and see exactly this. Later changes here need a new link.
          </p>
          {shareState.status === 'done' ? (
            <div className="mt-2 space-y-1">
              <a
                href={shareState.url}
                className="block break-all text-[12px] underline hover:text-[rgb(var(--accent-strong))]"
              >
                {shareState.url}
              </a>
              <CopyButton text={shareState.url} label="Copy the link" />
            </div>
          ) : shareState.status === 'failed' ? (
            <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">{shareState.error}</p>
          ) : null}
        </div>
      ) : null}
      {shared ? null : (
        <>
          <Link href={historyHref} className="mt-3 block text-sm font-semibold hover:text-[rgb(var(--accent-strong))]">
            Past runs{historyCount ? ` (${historyCount})` : ''}
          </Link>
          <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">
            Every run that left this page: other personas, other moments, re-runs.
          </p>
        </>
      )}
      {workshopsHref && !shared ? (
        <>
          <Link href={workshopsHref} className="mt-3 block text-sm font-semibold hover:text-[rgb(var(--accent-strong))]">
            Saved workshop chats
          </Link>
          <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">
            Every conversation about a joke, from the database, with what was hearted from it.
          </p>
        </>
      ) : null}
      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
        Jump to a section
      </p>
      <ul className="mt-4 space-y-4">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              className="block text-sm font-semibold leading-snug hover:text-[rgb(var(--accent-strong))]"
            >
              {entry.label}
            </a>
            {entry.note ? <p className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">{entry.note}</p> : null}
            {entry.children.length ? (
              <ul className="mt-2 space-y-1.5 border-l border-[rgb(var(--gloss)/0.4)] pl-3 dark:border-[rgb(var(--gloss)/0.15)]">
                {entry.children.map((child) => (
                  <li key={child.id}>
                    <a
                      href={`#${child.id}`}
                      className="block text-[13px] leading-snug text-[rgb(var(--muted))] hover:text-[rgb(var(--accent-strong))]"
                    >
                      {child.label}
                      {child.note ? <span className="block text-[11px] opacity-70">{child.note}</span> : null}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ONE set of jokes for a moment, from one source. The joke is the thing being
// judged, so it is the largest text in the row; the numeral is an anchor in a
// gutter; everything about the call sits under quiet labels, collapsed.
function JokeSet({
  job,
  label,
  isHearted,
  onToggleHeart,
  evaluator,
  onScore,
  scoring,
  selected,
  onSelect,
  analyzer,
  onAnalyze,
  analyzing,
  refiner,
  onRefine,
  refining,
  workshop,
  editsOf,
}: {
  job: Job
  // Which source these came from, as a phrase: "from the persona alone".
  label: string
  // The joke whose breakdown is open in the moment's panel, if it is one of
  // these. The panel belongs to the moment, not the set, so two sets side
  // by side share one.
  selected: number | null
  onSelect: (index: number) => void
  isHearted: (caption: string) => boolean
  // refinedFrom is the original joke when the caption is one of its variants.
  onToggleHeart: (caption: string, refinedFrom?: string) => void
  // The evaluator for this job's persona, if one exists.
  evaluator: EvaluatorPrompt | null
  onScore: () => void
  scoring: boolean
  // Whether this flavor can analyze (step 3 + catalog) and refine (step 4).
  analyzer: boolean
  onAnalyze: () => void
  analyzing: boolean
  refiner: boolean
  onRefine: () => void
  refining: boolean
  // Whether clicking a joke opens the workshop pane (flavors with step 3).
  workshop: boolean
  // Versions of a joke minted by hand in the workshop, to show under it.
  editsOf: (joke: string) => HeartedJoke[]
}) {
  const [order, setOrder] = useState<'written' | 'score' | 'analysis'>('written')
  const byScore = order === 'score'
  const setByScore = (fn: (v: boolean) => boolean) => setOrder(fn(order === 'score') ? 'score' : 'written')
  const evals = job.evals ?? {}
  const hasEvals = Object.keys(evals).length > 0
  const analyses = job.analyses ?? {}
  const hasAnalyses = Object.keys(analyses).length > 0
  const analyzed = Object.values(analyses).filter((a) => a.status === 'done' && a.data?.action)
  const scoreOf = (i: number) => {
    const d = analyses[i]?.data
    return d ? (analysisScore(d) ?? -1) : -1
  }
  const actionCount = (action: string) => analyzed.filter((a) => a.data?.action === action).length
  const toRefine = actionCount('refine_execution')
  const refinements = job.refinements ?? {}
  const variantCount = Object.values(refinements).reduce((n, r) => n + (r.variants?.length ?? 0), 0)
  const scored = Object.values(evals).filter((e) => e.status === 'done' && typeof e.data?.score === 'number')
  const rows = (job.jokes ?? []).map((_, i) => i)
  if (byScore) rows.sort((a, b) => (evals[b]?.data?.score ?? -1) - (evals[a]?.data?.score ?? -1))
  if (order === 'analysis') rows.sort((a, b) => scoreOf(b) - scoreOf(a))
  const mean = scored.length ? Math.round(scored.reduce((n, e) => n + (e.data?.score ?? 0), 0) / scored.length) : null
  return (
    <div className="mt-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
        {job.status === 'running'
          ? `${job.persona} is reacting, ${label}…`
          : job.status === 'failed'
            ? `The call for ${job.persona} ${label} failed`
            : `${job.jokes?.length ?? 0} reaction jokes as ${job.persona}, ${label}${
                job.durationMs ? `, written in ${seconds(job.durationMs)}` : ''
              }`}
      </p>

      {job.status === 'failed' ? <p className="mt-3 text-sm text-red-700 dark:text-red-400">{job.error}</p> : null}

      {job.status === 'done' && job.jokes?.length ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {evaluator ? (
              <button type="button" className={SMALL_BUTTON} disabled={scoring} onClick={onScore}>
                {scoring
                  ? `Scoring ${job.jokes.length} jokes…`
                  : Object.keys(evals).length
                    ? `Score these ${job.jokes.length} jokes again`
                    : `Score these ${job.jokes.length} jokes with the ${evaluator.name.toLowerCase()}`}
              </button>
            ) : (
              <p className={FIELD_HELP}>
                No evaluator prompt exists for {job.persona} yet, so these jokes cannot be scored. One goes in
                docs/prompts/evaluators/.
              </p>
            )}
            {scored.length ? (
              <>
                <span className="text-sm text-[rgb(var(--muted))]">
                  {scored.length} scored, mean {mean} / 100
                  {job.evaluatorFile && evaluator && job.evaluatorFile !== evaluator.file
                    ? ' · scored by an older evaluator than the one now on file'
                    : ''}
                </span>
                <button
                  type="button"
                  className="text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                  onClick={() => setByScore((v) => !v)}
                >
                  {byScore ? 'Show in the order they were written' : 'Order by score'}
                </button>
              </>
            ) : null}
          </div>
          {analyzer ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className={SMALL_BUTTON} disabled={analyzing || refining} onClick={onAnalyze}>
                {analyzing
                  ? `Analyzing ${job.jokes.length} jokes…`
                  : hasAnalyses
                    ? `Analyze these ${job.jokes.length} jokes again`
                    : `Analyze these ${job.jokes.length} jokes: premise, comic moves, keep or refine or reject`}
              </button>
              {analyzed.length ? (
                <>
                  <span className="text-sm text-[rgb(var(--muted))]">
                    {actionCount('keep')} keep, {toRefine} refine, {actionCount('reject')} reject
                  </span>
                  <button
                    type="button"
                    className="text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                    onClick={() => setOrder((o) => (o === 'analysis' ? 'written' : 'analysis'))}
                    title="One number out of 100 from the four judgments (premise counts double); hover a number to see them"
                  >
                    {order === 'analysis' ? 'Show in the order they were written' : 'Order by analysis score'}
                  </button>
                </>
              ) : null}
              {hasAnalyses && refiner ? (
                <button
                  type="button"
                  className={SMALL_BUTTON}
                  disabled={analyzing || refining || !toRefine}
                  onClick={onRefine}
                  title="Runs step 4 only on the jokes marked refine: two or three variants each that keep the premise and fix the one diagnosed problem"
                >
                  {refining
                    ? `Rewriting ${toRefine} marked jokes…`
                    : variantCount
                      ? `Rewrite the ${toRefine} marked jokes again`
                      : `Rewrite the ${toRefine} jokes marked refine, keeping their premises`}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="mt-5">
            <ol className="space-y-5">
              {rows.map((i) => {
                const joke = job.jokes![i]
                const hearted = isHearted(joke)
                const ev = evals[i]
                const an = analyses[i]
                const rf = refinements[i]
                // Literal class strings, one per combination, so Tailwind
                // can see them at build time.
                // Literal class strings, one per combination, so Tailwind
                // can see them at build time. Number, heart, joke, then the
                // analysis across the rest of the row, the action, the score.
                const columns =
                  hasAnalyses && hasEvals
                    ? 'grid-cols-[2.75rem_2.25rem_minmax(0,2fr)_minmax(0,3fr)_3rem_4rem_4.5rem]'
                    : hasAnalyses
                      ? 'grid-cols-[2.75rem_2.25rem_minmax(0,2fr)_minmax(0,3fr)_3rem_4rem]'
                      : hasEvals
                        ? 'grid-cols-[2.75rem_2.25rem_minmax(0,1fr)_4.5rem]'
                        : 'grid-cols-[2.75rem_2.25rem_minmax(0,1fr)]'
                const heart = (
                  <button
                    type="button"
                    aria-pressed={hearted}
                    aria-label={hearted ? 'Remove the heart from this joke' : 'Heart this joke'}
                    title={
                      hearted
                        ? 'Remove the heart from this joke'
                        : 'Heart this joke: it goes to step 5, where it becomes a meme'
                    }
                    onClick={() => onToggleHeart(joke)}
                    // On the joke's first line, like the numeral, not the row's middle.
                    className={`mt-1 self-start transition ${
                      hearted
                        ? 'text-[rgb(var(--accent-strong))]'
                        : 'text-[rgb(var(--muted)/0.55)] hover:text-[rgb(var(--accent-strong))]'
                    }`}
                  >
                    <HeartIcon filled={hearted} />
                  </button>
                )
                return (
                  <li key={i} className={`grid items-baseline gap-x-4 ${columns}`}>
                    <span className="text-xl font-semibold text-[rgb(var(--muted))]">{i + 1}</span>
                    {heart}
                    <div className="min-w-0">
                      {workshop ? (
                        <button
                          type="button"
                          aria-pressed={selected === i}
                          title="Open this joke in the workshop pane on the right: its moment, read, analysis, variants, and a chat"
                          onClick={() => onSelect(i)}
                          className={`block w-full rounded-md text-left text-lg leading-relaxed transition hover:bg-[rgb(var(--panel)/0.8)] ${
                            selected === i ? 'bg-[rgb(var(--panel))] font-semibold dark:bg-[rgb(var(--panel)/0.5)]' : ''
                          }`}
                        >
                          {joke}
                        </button>
                      ) : (
                        <p className="text-lg leading-relaxed">{joke}</p>
                      )}
                      {rf ? (
                        <VariantList
                          job={rf}
                          isHearted={isHearted}
                          onToggleHeart={(caption) => onToggleHeart(caption, joke)}
                        />
                      ) : null}
                      {editsOf(joke).map((e) => (
                        <p key={e.id} className="mt-1.5 flex items-baseline gap-2 text-base leading-relaxed">
                          <button
                            type="button"
                            aria-pressed
                            aria-label="Remove the heart from this edit"
                            title="Remove the heart from this edit: it leaves step 5 and this list; the saved chat still records it"
                            onClick={() => onToggleHeart(e.caption, joke)}
                            className="self-center text-[rgb(var(--accent-strong))] transition hover:text-[rgb(var(--muted))]"
                          >
                            <HeartIcon filled size={16} />
                          </button>
                          <span>
                            {e.caption} <span className="text-xs text-[rgb(var(--muted))]">· your edit</span>
                          </span>
                        </p>
                      ))}
                    </div>
                    {hasAnalyses ? <div className="min-w-0">{an ? <AnalysisInline job={an} /> : null}</div> : null}
                    {hasAnalyses ? an ? <AnalysisScoreCell job={an} /> : <span /> : null}
                    {hasAnalyses ? an ? <ActionLabel job={an} /> : <span /> : null}
                    {hasEvals ? (
                      ev ? (
                        <ScoreCell job={ev} selected={selected === i} onSelect={() => onSelect(i)} />
                      ) : (
                        <span />
                      )
                    ) : null}
                  </li>
                )
              })}
            </ol>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <CopyButton text={job.jokes.join('\n')} label="Copy all the jokes for this moment" />
          </div>
        </>
      ) : null}

      {job.status === 'done' && !job.jokes?.length ? (
        <p className="mt-3 text-sm text-[rgb(var(--muted))]">
          The model returned text, but no line survived as a joke. The raw output is below.
        </p>
      ) : null}

      {job.status !== 'running' && (job.sentPrompt || job.raw) ? (
        <details className="mt-6">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
            What was sent to the model, and what came back
          </summary>
          {job.sentPrompt ? (
            <>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                The prompt this moment was sent with
              </p>
              <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 text-xs leading-relaxed dark:bg-[rgb(var(--panel)/0.3)]">
                {job.sentPrompt}
              </pre>
            </>
          ) : null}
          {job.raw ? (
            <>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">
                The model&rsquo;s raw output
              </p>
              <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-[rgb(var(--panel)/0.6)] p-3 text-xs leading-relaxed dark:bg-[rgb(var(--panel)/0.3)]">
                {job.raw}
              </pre>
            </>
          ) : null}
        </details>
      ) : null}
    </div>
  )
}

// ONE moment: its text, then the sets side by side, one column per source,
// the persona-alone set on the left (under its button) and the student-read
// set on the right (under its button), so the two are compared line by line
// (Lydia, 2026-09-08). One score panel per moment sits in a third column and
// shows whichever joke, from either set, was last clicked.
function MomentJokes({
  index,
  moment,
  job,
  readJob,
  isHearted,
  onToggleHeart,
  evaluator,
  onScore,
  scoring,
  analyzer,
  onAnalyze,
  analyzing,
  refiner,
  onRefine,
  refining,
  readOnly,
  studentRead,
  onWorkshopSend,
  onWorkshopClear,
  onWorkshopHeart,
  onWorkshopMint,
  editsOf,
}: {
  index: number
  moment: string
  job: Job | null
  readJob: Job | null
  isHearted: (job: Job, caption: string) => boolean
  onToggleHeart: (job: Job, caption: string, refinedFrom?: string) => void
  evaluator: EvaluatorPrompt | null
  onScore: (source: Source) => void
  scoring: (source: Source) => boolean
  analyzer: boolean
  onAnalyze: (source: Source) => void
  analyzing: (source: Source) => boolean
  refiner: boolean
  onRefine: (source: Source) => void
  refining: (source: Source) => boolean
  // On a flavor that only writes with the student read, the persona-alone
  // column is not rendered at all, and clicking a joke opens the workshop.
  readOnly: boolean
  studentRead: StudentReadJob | null
  onWorkshopSend: (source: Source, jokeIndex: number, text: string) => void
  onWorkshopClear: (source: Source, jokeIndex: number) => void
  onWorkshopHeart: (job: Job, caption: string, original: string, note?: string, askedFor?: string) => void
  onWorkshopMint: (job: Job, caption: string, original: string) => void
  editsOf: (job: Job, joke: string) => HeartedJoke[]
}) {
  const [selected, setSelected] = useState<{
    source: Source
    index: number
  } | null>(null)
  const jobOf = (source: Source) => (source === 'persona' ? job : readJob)
  const hasEvals = Boolean(Object.keys(job?.evals ?? {}).length || Object.keys(readJob?.evals ?? {}).length)
  const hasAnalyses = Boolean(
    Object.keys(job?.analyses ?? {}).length || Object.keys(readJob?.analyses ?? {}).length
  )
  // The analysis sits inside each row; the side panel is for scores, and on
  // a workshop flavor for the selected joke's workshop.
  const selectedJob = selected ? jobOf(selected.source) : null
  const selectedJoke = selected && selectedJob ? (selectedJob.jokes?.[selected.index] ?? null) : null
  const workshopOpen = readOnly && selected != null && selectedJob != null
  const hasPanel = hasEvals || workshopOpen
  const set = (source: Source) => {
    const j = jobOf(source)
    if (!j) return null
    return (
      <JokeSet
        job={j}
        label={SOURCE_LABEL[source]}
        selected={selected?.source === source ? selected.index : null}
        onSelect={(i) => setSelected({ source, index: i })}
        isHearted={(caption) => isHearted(j, caption)}
        onToggleHeart={(caption, refinedFrom) => onToggleHeart(j, caption, refinedFrom)}
        evaluator={evaluator}
        onScore={() => onScore(source)}
        scoring={scoring(source)}
        analyzer={analyzer}
        onAnalyze={() => onAnalyze(source)}
        analyzing={analyzing(source)}
        refiner={refiner}
        onRefine={() => onRefine(source)}
        refining={refining(source)}
        workshop={readOnly}
        editsOf={(joke) => editsOf(j, joke)}
      />
    )
  }
  return (
    <article
      id={`jokes-moment-${index + 1}`}
      className="scroll-mt-6 border-t border-[rgb(var(--gloss)/0.4)] pt-8 dark:border-[rgb(var(--gloss)/0.15)]"
    >
      <p className={SECTION_NUMBER}>Moment {index + 1}</p>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed">{moment}</p>
      <div
        className={
          readOnly
            ? `lg:grid lg:gap-x-10 ${hasPanel ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]' : 'lg:grid-cols-1'}`
            : `${SET_COLUMNS} ${hasPanel ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,22rem)]' : ''}`
        }
      >
        {/* Each set stays in its source's column even when the other has
            not run, so the column under a button is always that button's. */}
        {readOnly ? null : <div className="min-w-0">{set('persona')}</div>}
        <div className="min-w-0">{set('persona-read')}</div>
        {hasPanel ? (
          <aside
            className={
              readOnly
                ? // The workshop is a bounded card, so the eye can tell where
                  // the pane begins and ends among the rows (Lydia, 2026-09-09).
                  'mt-8 min-w-0 rounded-2xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] p-5 shadow-sm lg:sticky lg:top-6 lg:mt-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto dark:border-[rgb(var(--gloss)/0.25)] dark:bg-[rgb(var(--panel)/0.35)]'
                : 'mt-8 min-w-0 lg:col-span-2 xl:col-span-1 xl:sticky xl:top-6 xl:mt-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto'
            }
          >
            {workshopOpen && selected && selectedJob && selectedJoke ? (
              <WorkshopPane
                joke={selectedJoke}
                moment={moment}
                studentRead={studentRead?.status === 'done' ? (studentRead.data ?? null) : null}
                analysis={selectedJob.analyses?.[selected.index] ?? null}
                refinement={selectedJob.refinements?.[selected.index] ?? null}
                chat={selectedJob.workshops?.[selected.index] ?? null}
                onSend={(text) => onWorkshopSend(selected.source, selected.index, text)}
                onClear={() => onWorkshopClear(selected.source, selected.index)}
                onClose={() => setSelected(null)}
                isHearted={(caption) => isHearted(selectedJob, caption)}
                onToggleHeart={(caption, note, askedFor) =>
                  onWorkshopHeart(selectedJob, caption, selectedJoke, note, askedFor)
                }
                edits={editsOf(selectedJob, selectedJoke)}
                onMint={(caption) => onWorkshopMint(selectedJob, caption, selectedJoke)}
              />
            ) : null}
            {hasEvals ? (
              <>
                <p
                  className={`text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))] ${
                    hasAnalyses || workshopOpen ? 'mt-8' : ''
                  }`}
                >
                  How the selected joke was scored
                  {selected ? `, ${SOURCE_LABEL[selected.source]}` : ''}
                </p>
                <div className="mt-2">
                  <EvaluationPanel
                    joke={selectedJoke}
                    job={selected && selectedJob ? (selectedJob.evals?.[selected.index] ?? null) : null}
                  />
                </div>
              </>
            ) : null}
          </aside>
        ) : null}
      </div>
    </article>
  )
}

export default function ReactionJokesClient({
  flavorId,
  steps,
  personas,
  evaluators,
  studentRead,
  comicMoves,
  share,
  shareError,
}: {
  flavorId: number
  steps: PovStep[]
  personas: PersonaPrompt[]
  evaluators: EvaluatorPrompt[]
  // The Student Read prompt, or null when none is on file.
  studentRead: AnalysisPrompt | null
  // The comic-moves catalog, {{COMIC_MOVES}} in steps 3 and 4, or null.
  comicMoves: AnalysisPrompt | null
  // A run someone shared by link (?share=<id>): shown in place of the
  // browser record, read-only, and never saved over it.
  share: SharedRun | null
  // Why a ?share= link could not be loaded, when it could not.
  shareError: string | null
}) {
  const shared = share != null
  const snapshot = share?.snapshot ?? null
  // An evaluator belongs to a persona by folder name.
  const evaluatorFor = useCallback(
    (personaName: string): EvaluatorPrompt | null => {
      const folder = personas.find((p) => p.name === personaName)?.folder
      return (folder && evaluators.find((e) => e.personaFolder === folder)) ?? null
    },
    [personas, evaluators]
  )
  // Keyed "<source>:<moment index>".
  const [scoringJobs, setScoringJobs] = useState<Record<string, boolean>>({})
  const [analyzingJobs, setAnalyzingJobs] = useState<Record<string, boolean>>({})
  const [refiningJobs, setRefiningJobs] = useState<Record<string, boolean>>({})
  const step = steps.find((s) => s.orderBy === 1) ?? null
  const stepPlaceholders = useMemo(() => (step ? unfilledPlaceholders(step.userPrompt) : []), [step])
  const stepIsUsable =
    Boolean(step) &&
    stepPlaceholders.includes('PERSONA') &&
    stepPlaceholders.includes('MOMENT') &&
    stepPlaceholders.includes('JOKE_COUNT')
  // Step 2: the same job with the student read. A sibling of step 1.
  const step2 = steps.find((s) => s.orderBy === 2) ?? null
  const step2Placeholders = useMemo(() => (step2 ? unfilledPlaceholders(step2.userPrompt) : []), [step2])
  const step2IsUsable =
    Boolean(step2) &&
    step2Placeholders.includes('PERSONA') &&
    step2Placeholders.includes('MOMENT') &&
    step2Placeholders.includes('STUDENT_READ') &&
    step2Placeholders.includes('JOKE_COUNT')
  // Steps 3 and 4, on a flavor that has them: the analyzer and the refiner.
  const step3 = steps.find((s) => s.orderBy === 3) ?? null
  const step3Placeholders = useMemo(() => (step3 ? unfilledPlaceholders(step3.userPrompt) : []), [step3])
  const analyzerUsable =
    Boolean(step3) &&
    Boolean(comicMoves) &&
    ['PERSONA', 'MOMENT', 'STUDENT_READ', 'JOKE', 'COMIC_MOVES'].every((n) => step3Placeholders.includes(n))
  // A flavor with an analyzer writes only with the student read (Lydia,
  // 2026-09-09, on 1564: "we want to focus only on the ones with a student
  // read"), so the persona-alone button and column are not shown.
  const readOnly = Boolean(step3)
  const step4 = steps.find((s) => s.orderBy === 4) ?? null
  const step4Placeholders = useMemo(() => (step4 ? unfilledPlaceholders(step4.userPrompt) : []), [step4])
  const refinerUsable =
    analyzerUsable &&
    Boolean(step4) &&
    ['PERSONA', 'MOMENT', 'JOKE', 'PREMISE', 'MOVES', 'PROBLEM', 'PRESERVE', 'COMIC_MOVES'].every((n) =>
      step4Placeholders.includes(n)
    )

  const [moments, setMoments] = useState<string[]>(snapshot?.moments.length ? snapshot.moments : [''])
  const liveMoments = useMemo(() => moments.map((m) => m.trim()).filter(Boolean), [moments])
  const [showSidechatPicker, setShowSidechatPicker] = useState(false)
  const [personaName, setPersonaName] = useState<string>(snapshot?.personaName ?? '')
  const [jokeCount, setJokeCount] = useState<number>(snapshot?.jokeCount || DEFAULT_JOKE_COUNT)
  const persona = personas.find((p) => p.name === personaName) ?? null
  const [jobs, setJobs] = useState<Record<number, Job>>(() => finishInterrupted(snapshot?.jobs))
  const [readJobs, setReadJobs] = useState<Record<number, Job>>(() => finishInterrupted(snapshot?.readJobs))
  const [studentReads, setStudentReads] = useState<Record<number, StudentReadJob>>(() =>
    finishInterruptedReads(snapshot?.studentReads)
  )
  const [analyzing, setAnalyzing] = useState(false)
  const [selectedRead, setSelectedRead] = useState<number | null>(null)
  const [hearted, setHearted] = useState<HeartedJoke[]>(snapshot?.hearted ?? [])
  // Past runs, newest first. Written here, read on the past-runs page.
  const [history, setHistory] = useState<PastRun[]>([])
  // Which source is being written right now, if any. One run at a time.
  const [runningSource, setRunningSource] = useState<Source | null>(null)
  const running = runningSource != null
  const [notSent, setNotSent] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)

  // ---- browser cache of the last run
  // On a shared run the page shows the snapshot instead, and `loaded` stays
  // false so the save below never writes it over the browser record.
  const loaded = useRef(false)
  useEffect(() => {
    if (shared) return
    let cancelled = false
    void (async () => {
      try {
        const saved = await loadRecord<Saved>(storageKey(flavorId))
        if (cancelled) return
        if (saved?.moments?.length) setMoments(saved.moments)
        if (saved?.personaName) setPersonaName(saved.personaName)
        if (saved?.jokeCount) setJokeCount(saved.jokeCount)
        if (saved?.hearted) setHearted(saved.hearted)
        if (saved?.studentReads) setStudentReads(finishInterruptedReads(saved.studentReads))
        if (saved) {
          // Jokes from another persona or other moments than the saved run's
          // are past results: they go to the past-runs page, not beside the
          // current ones.
          const { jobs: current, readJobs: currentRead, strays } = separateStrays({
            ...saved,
            jobs: finishInterrupted(saved.jobs),
            readJobs: finishInterrupted(saved.readJobs),
          })
          setJobs(current)
          setReadJobs(currentRead)
          setHistory([...strays, ...(saved.history ?? [])])
        }
      } catch (err) {
        if (!cancelled) setStorageError(err instanceof Error ? err.message : String(err))
      } finally {
        loaded.current = true
      }
    })()
    return () => {
      cancelled = true
    }
  }, [flavorId, shared])

  const saveTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!loaded.current) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveRecord(storageKey(flavorId), {
        moments,
        personaName,
        jokeCount,
        jobs,
        readJobs,
        studentReads,
        hearted,
        history,
      } satisfies Saved).catch((err) => setStorageError(err instanceof Error ? err.message : String(err)))
    }, 300)
  }, [flavorId, moments, personaName, jokeCount, jobs, readJobs, studentReads, hearted, history])

  // Moves jokes off the working page onto the past-runs page. Nothing is
  // deleted here; the past-runs page has the delete button.
  const archive = useCallback(
    (which: { jobs: Record<number, Job>; readJobs: Record<number, Job> }, note: string) => {
      const run = makePastRun(which.jobs, which.readJobs, studentReads, note)
      if (run) setHistory((prev) => [{ ...run, jokeCount }, ...prev])
    },
    [studentReads, jokeCount]
  )

  // Puts the run in the past and clears the page; the hearts stay.
  const clearRun = useCallback(() => {
    archive({ jobs, readJobs }, 'cleared from the working page')
    setMoments([''])
    setPersonaName('')
    setJobs({})
    setReadJobs({})
    setStudentReads({})
    setSelectedRead(null)
    setNotSent(null)
  }, [archive, jobs, readJobs])

  // ---- hearts
  const heartedIds = useMemo(() => new Set(hearted.map((h) => h.id)), [hearted])
  // extras: where a rewrite came from, for the feedback record.
  const toggleHeart = useCallback(
    (job: Job, caption: string, refinedFrom?: string, extras?: Pick<HeartedJoke, 'origin' | 'note' | 'askedFor'>) => {
      const id = heartId(job.persona, job.moment, caption)
      setHearted((prev) =>
        prev.some((h) => h.id === id)
          ? prev.filter((h) => h.id !== id)
          : [
              {
                id,
                caption,
                persona: job.persona,
                moment: job.moment,
                heartedAt: new Date().toISOString(),
                ...(refinedFrom ? { refinedFrom, origin: 'variant' as const } : {}),
                ...(extras ?? {}),
              },
              ...prev,
            ]
      )
    },
    []
  )
  const unheart = useCallback((id: string) => setHearted((prev) => prev.filter((h) => h.id !== id)), [])
  const setVisualWords = useCallback((id: string, words: string[]) => {
    setHearted((prev) => prev.map((h) => (h.id === id ? { ...h, visualWords: words } : h)))
  }, [])
  const setPicture = useCallback((id: string, frameId: string, picture: MemePicture | null) => {
    setHearted((prev) =>
      prev.map((h) => {
        if (h.id !== id) return h
        const memes = { ...(h.memes ?? {}) }
        if (picture) memes[frameId] = picture
        else delete memes[frameId]
        return { ...h, memes }
      })
    )
  }, [])

  // ---- the jokes: one call per moment, from step 1 (persona alone) or
  // step 2 (persona + the moment's student read)
  const stepFor = useCallback((source: Source) => (source === 'persona' ? step : step2), [step, step2])
  const setJobsFor = useCallback((source: Source) => (source === 'persona' ? setJobs : setReadJobs), [])
  // The values a source's prompt is filled with for one moment.
  const valuesFor = useCallback(
    (source: Source, index: number, moment: string, who: PersonaPrompt): Record<string, string> => {
      const values: Record<string, string> = {
        PERSONA: who.text,
        MOMENT: moment,
        JOKE_COUNT: String(jokeCount),
      }
      if (source === 'persona-read') {
        const read = studentReads[index]?.data
        values.STUDENT_READ = read ? studentReadAsText(read) : ''
      }
      return values
    },
    [studentReads, jokeCount]
  )
  // Every live moment has a finished read for the text it has now.
  const readsReadyCount = liveMoments.filter(
    (m, i) => studentReads[i]?.status === 'done' && studentReads[i].data && studentReads[i].moment === m
  ).length
  const readsReady = liveMoments.length > 0 && readsReadyCount === liveMoments.length

  const runOne = useCallback(
    async (source: Source, index: number, moment: string, who: PersonaPrompt) => {
      const theStep = stepFor(source)
      if (!theStep) return
      const filled = fillTemplate(theStep.userPrompt, valuesFor(source, index, moment, who))
      const startedAt = Date.now()
      const res = await runStepWithSession({
        imageId: null,
        systemPrompt: theStep.systemPrompt,
        userPrompt: filled,
        providerModelId: theStep.providerModelId,
        temperature: theStep.temperature,
        includeImage: false,
        isTemperatureSupported: theStep.isTemperatureSupported,
        priorOutputs: {},
        reasoningEffort: REASONING_EFFORT,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
      const durationMs = Date.now() - startedAt
      const finishedAt = new Date().toISOString()
      const base = {
        moment,
        persona: who.name,
        source,
        sentPrompt: filled,
        durationMs,
        finishedAt,
        model: theStep.modelName,
        reasoningEffort: REASONING_EFFORT,
      }
      setJobsFor(source)((prev) => ({
        ...prev,
        [index]: res.ok
          ? {
              ...base,
              status: 'done',
              jokes: parseJokes(res.text ?? ''),
              raw: res.text ?? '',
            }
          : {
              ...base,
              status: 'failed',
              error: res.error ?? 'The call failed.',
            },
      }))
    },
    [stepFor, valuesFor, setJobsFor]
  )

  const runAll = useCallback(
    async (source: Source) => {
      const theStep = stepFor(source)
      if (!theStep || !persona || !liveMoments.length) return
      if (source === 'persona-read' && !readsReady) return
      setNotSent(null)
      // Check the template once before spending anything.
      const probe = fillTemplate(theStep.userPrompt, valuesFor(source, 0, liveMoments[0], persona))
      const missing = unfilledPlaceholders(probe)
      if (missing.length) {
        setNotSent(
          `Not sent: the step's prompt still contains ${missing
            .map((n) => `{{${n}}}`)
            .join(
              ', '
            )} after this page filled it in. This page fills {{PERSONA}}, {{MOMENT}}, and {{JOKE_COUNT}}, and {{STUDENT_READ}} for step 2. Nothing was spent.`
        )
        return
      }
      // What is on the page now either belongs to this run (same persona,
      // same moments) or is a past run. A past run leaves whole; a set from
      // this run that is being re-run leaves on its own.
      const isThisRun = (record: Record<number, Job>) =>
        Object.entries(record).every(([k, j]) => belongsToRun(j, Number(k), persona.name, liveMoments))
      if (!isThisRun(jobs) || !isThisRun(readJobs)) {
        archive({ jobs, readJobs }, `replaced by a run as ${persona.name}`)
        setJobs({})
        setReadJobs({})
      } else {
        const own = source === 'persona' ? jobs : readJobs
        if (Object.keys(own).length) {
          archive(
            source === 'persona' ? { jobs: own, readJobs: {} } : { jobs: {}, readJobs: own },
            `re-run ${SOURCE_LABEL[source]}`
          )
        }
      }
      setRunningSource(source)
      setJobsFor(source)(
        Object.fromEntries(
          liveMoments.map((m, i) => [
            i,
            {
              moment: m,
              persona: persona.name,
              source,
              status: 'running',
            } satisfies Job,
          ])
        )
      )
      const queue = liveMoments.map((_, i) => i)
      const worker = async () => {
        while (queue.length) {
          const i = queue.shift()
          if (i == null) return
          await runOne(source, i, liveMoments[i], persona)
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
      setRunningSource(null)
    },
    [stepFor, valuesFor, setJobsFor, persona, liveMoments, readsReady, runOne, jobs, readJobs, archive]
  )

  // ---- the student read: one analysis call per moment, CONCURRENCY at a time
  const runStudentReads = useCallback(async () => {
    if (!step || !studentRead || !liveMoments.length) return
    setAnalyzing(true)
    setSelectedRead(null)
    setStudentReads(
      Object.fromEntries(liveMoments.map((m, i) => [i, { moment: m, status: 'running' } satisfies StudentReadJob]))
    )
    const one = async (i: number) => {
      const moment = liveMoments[i]
      const filled = fillTemplate(studentRead.text, { EVENT: moment })
      const startedAt = Date.now()
      const res = await runStepWithSession({
        imageId: null,
        systemPrompt: 'Return only JSON.',
        userPrompt: filled,
        providerModelId: step.providerModelId,
        temperature: step.temperature,
        includeImage: false,
        isTemperatureSupported: step.isTemperatureSupported,
        priorOutputs: {},
        reasoningEffort: REASONING_EFFORT,
        maxOutputTokens: STUDENT_READ_MAX_OUTPUT_TOKENS,
      })
      const durationMs = Date.now() - startedAt
      const finishedAt = new Date().toISOString()
      const data = res.ok ? parseStudentRead(res.text ?? '') : null
      const base = {
        moment,
        sentPrompt: filled,
        durationMs,
        finishedAt,
        promptFile: studentRead.file,
        model: step.modelName,
        reasoningEffort: REASONING_EFFORT,
      }
      const result: StudentReadJob = res.ok
        ? data
          ? { ...base, status: 'done', data, raw: res.text ?? '' }
          : {
              ...base,
              status: 'failed',
              error: 'The analysis did not return readable JSON.',
              raw: res.text ?? '',
            }
        : { ...base, status: 'failed', error: res.error ?? 'The call failed.' }
      setStudentReads((prev) => ({ ...prev, [i]: result }))
    }
    const queue = liveMoments.map((_, i) => i)
    const worker = async () => {
      while (queue.length) {
        const i = queue.shift()
        if (i == null) return
        await one(i)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    setAnalyzing(false)
  }, [step, studentRead, liveMoments])

  // ---- scoring: one evaluator call per joke, CONCURRENCY at a time
  const scoreJob = useCallback(
    async (source: Source, index: number) => {
      const job = (source === 'persona' ? jobs : readJobs)[index]
      const evaluator = evaluatorFor(job?.persona ?? '')
      if (!step || !job?.jokes?.length || !evaluator) return
      const key = `${source}:${index}`
      setScoringJobs((prev) => ({ ...prev, [key]: true }))
      const jokes = job.jokes
      const setRecord = setJobsFor(source)
      setRecord((prev) => ({
        ...prev,
        [index]: {
          ...prev[index],
          evaluatorFile: evaluator.file,
          evals: Object.fromEntries(jokes.map((_, i) => [i, { status: 'running' } satisfies EvalJob])),
        },
      }))
      const one = async (i: number) => {
        const filled = fillTemplate(evaluator.text, {
          EVENT: job.moment,
          JOKE: jokes[i],
        })
        const startedAt = Date.now()
        const res = await runStepWithSession({
          imageId: null,
          systemPrompt: 'Return only JSON.',
          userPrompt: filled,
          providerModelId: step.providerModelId,
          temperature: step.temperature,
          includeImage: false,
          isTemperatureSupported: step.isTemperatureSupported,
          priorOutputs: {},
          reasoningEffort: REASONING_EFFORT,
          maxOutputTokens: EVAL_MAX_OUTPUT_TOKENS,
        })
        const durationMs = Date.now() - startedAt
        const data = res.ok ? parseEvaluation(res.text ?? '') : null
        const meta = { model: step.modelName, reasoningEffort: REASONING_EFFORT }
        const result: EvalJob = res.ok
          ? data
            ? { status: 'done', data, raw: res.text ?? '', durationMs, ...meta }
            : {
                status: 'failed',
                error: 'The evaluator did not return readable JSON.',
                raw: res.text ?? '',
                durationMs,
              }
          : {
              status: 'failed',
              error: res.error ?? 'The call failed.',
              durationMs,
            }
        setRecord((prev) => ({
          ...prev,
          [index]: {
            ...prev[index],
            evals: { ...(prev[index]?.evals ?? {}), [i]: result },
          },
        }))
      }
      const queue = jokes.map((_, i) => i)
      const worker = async () => {
        while (queue.length) {
          const i = queue.shift()
          if (i == null) return
          await one(i)
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
      setScoringJobs((prev) => ({ ...prev, [key]: false }))
    },
    [jobs, readJobs, step, evaluatorFor, setJobsFor]
  )

  // ---- analysis: one step 3 call per joke, CONCURRENCY at a time. The
  // action comes from the rule in code (parseAnalysis), not the model.
  const analyzeJob = useCallback(
    async (source: Source, index: number) => {
      const job = (source === 'persona' ? jobs : readJobs)[index]
      const who = personas.find((p) => p.name === job?.persona) ?? null
      if (!step3 || !comicMoves || !job?.jokes?.length || !who) return
      const key = `${source}:${index}`
      setAnalyzingJobs((prev) => ({ ...prev, [key]: true }))
      const jokes = job.jokes
      const setRecord = setJobsFor(source)
      setRecord((prev) => ({
        ...prev,
        [index]: {
          ...prev[index],
          comicMovesFile: comicMoves.file,
          analyses: Object.fromEntries(jokes.map((_, i) => [i, { status: 'running' } satisfies AnalysisJob])),
        },
      }))
      const read = studentReads[index]?.data
      const one = async (i: number) => {
        const filled = fillTemplate(step3.userPrompt, {
          PERSONA: who.text,
          MOMENT: job.moment,
          STUDENT_READ: read ? studentReadAsText(read) : '(no student read for this moment)',
          JOKE: jokes[i],
          COMIC_MOVES: comicMoves.text,
        })
        const startedAt = Date.now()
        const res = await runStepWithSession({
          imageId: null,
          systemPrompt: step3.systemPrompt || 'Return only JSON.',
          userPrompt: filled,
          providerModelId: step3.providerModelId,
          temperature: step3.temperature,
          includeImage: false,
          isTemperatureSupported: step3.isTemperatureSupported,
          priorOutputs: {},
          reasoningEffort: REASONING_EFFORT,
          maxOutputTokens: ANALYSIS_MAX_OUTPUT_TOKENS,
        })
        const durationMs = Date.now() - startedAt
        const parsed = res.ok ? parseAnalysis(res.text ?? '') : null
        const meta = { model: step3.modelName, reasoningEffort: REASONING_EFFORT, sentPrompt: filled, durationMs }
        const result: AnalysisJob = res.ok
          ? parsed
            ? { status: 'done', data: parsed.data, backstop: parsed.backstop, raw: res.text ?? '', ...meta }
            : { status: 'failed', error: 'The analyzer did not return readable JSON.', raw: res.text ?? '', ...meta }
          : { status: 'failed', error: res.error ?? 'The call failed.', ...meta }
        setRecord((prev) => ({
          ...prev,
          [index]: { ...prev[index], analyses: { ...(prev[index]?.analyses ?? {}), [i]: result } },
        }))
      }
      const queue = jokes.map((_, i) => i)
      const worker = async () => {
        while (queue.length) {
          const i = queue.shift()
          if (i == null) return
          await one(i)
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
      setAnalyzingJobs((prev) => ({ ...prev, [key]: false }))
    },
    [jobs, readJobs, personas, step3, comicMoves, studentReads, setJobsFor]
  )

  // ---- refinement: one step 4 call per joke the analysis marked
  // refine_execution. The original joke is never replaced.
  const refineJob = useCallback(
    async (source: Source, index: number) => {
      const job = (source === 'persona' ? jobs : readJobs)[index]
      const who = personas.find((p) => p.name === job?.persona) ?? null
      if (!step4 || !comicMoves || !job?.jokes?.length || !who) return
      const marked = Object.entries(job.analyses ?? {})
        .filter(([, a]) => a.status === 'done' && a.data?.action === 'refine_execution')
        .map(([i]) => Number(i))
      if (!marked.length) return
      const key = `${source}:${index}`
      setRefiningJobs((prev) => ({ ...prev, [key]: true }))
      const jokes = job.jokes
      const analyses = job.analyses ?? {}
      const setRecord = setJobsFor(source)
      setRecord((prev) => ({
        ...prev,
        [index]: {
          ...prev[index],
          refinements: Object.fromEntries(marked.map((i) => [i, { status: 'running' } satisfies RefineJob])),
        },
      }))
      const one = async (i: number) => {
        const d = analyses[i]?.data ?? {}
        const filled = fillTemplate(step4.userPrompt, {
          PERSONA: who.text,
          MOMENT: job.moment,
          JOKE: jokes[i],
          PREMISE: d.premise ?? '',
          MOVES: [d.primary_move, ...(d.supporting_moves ?? [])].filter(Boolean).join(', ') || 'unknown',
          PROBLEM: d.specific_problem ?? '',
          PRESERVE: d.preserve ?? 'the premise and the anchor',
          COMIC_MOVES: comicMoves.text,
        })
        const startedAt = Date.now()
        const res = await runStepWithSession({
          imageId: null,
          systemPrompt: step4.systemPrompt || 'Return only JSON.',
          userPrompt: filled,
          providerModelId: step4.providerModelId,
          temperature: step4.temperature,
          includeImage: false,
          isTemperatureSupported: step4.isTemperatureSupported,
          priorOutputs: {},
          reasoningEffort: REASONING_EFFORT,
          maxOutputTokens: REFINE_MAX_OUTPUT_TOKENS,
        })
        const durationMs = Date.now() - startedAt
        const variants = res.ok ? parseVariants(res.text ?? '', jokes[i]) : null
        const meta = { model: step4.modelName, reasoningEffort: REASONING_EFFORT, sentPrompt: filled, durationMs }
        const result: RefineJob = res.ok
          ? variants
            ? { status: 'done', variants, raw: res.text ?? '', ...meta }
            : { status: 'failed', error: 'The refiner did not return readable JSON variants.', raw: res.text ?? '', ...meta }
          : { status: 'failed', error: res.error ?? 'The call failed.', ...meta }
        setRecord((prev) => ({
          ...prev,
          [index]: { ...prev[index], refinements: { ...(prev[index]?.refinements ?? {}), [i]: result } },
        }))
      }
      const queue = [...marked]
      const worker = async () => {
        while (queue.length) {
          const i = queue.shift()
          if (i == null) return
          await one(i)
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
      setRefiningJobs((prev) => ({ ...prev, [key]: false }))
    },
    [jobs, readJobs, personas, step4, comicMoves, setJobsFor]
  )

  // ---- the workshop chat: one conversation per joke, on WORKSHOP_MODEL at
  // WORKSHOP_EFFORT, with everything known about the joke as the system prompt.
  // Every answer and every heart from the chat rewrites the chat's row in
  // the database (reaction_joke_workshops), so the chats outlive this browser.
  const saveWorkshop = useCallback(
    async (source: Source, index: number, jokeIndex: number, chat: WorkshopChat, heartedNow: HeartedJoke[]) => {
      const job = (source === 'persona' ? jobs : readJobs)[index]
      const joke = job?.jokes?.[jokeIndex]
      const heartedHere = heartedNow.filter(
        (h) => (h.origin === 'workshop' || h.origin === 'edit') && h.refinedFrom === joke && h.moment === job?.moment
      )
      if (!job || !joke || !chat.chatId || (!chat.messages.length && !heartedHere.length)) return
      const res = await saveWorkshopAction({
        chatId: chat.chatId,
        flavorId,
        persona: job.persona,
        moment: job.moment,
        joke,
        jokeKey: heartId(job.persona, job.moment, joke),
        analysis: job.analyses?.[jokeIndex]?.data ?? null,
        messages: chat.messages,
        hearted: heartedHere.map((h) => ({
          caption: h.caption,
          note: h.origin === 'edit' ? 'edited by hand' : h.note,
          asked_for: h.askedFor,
          hearted_at: h.heartedAt,
        })),
        model: chat.model,
        reasoningEffort: chat.reasoningEffort,
      })
      setJobsFor(source)((prev) => {
        const cur = prev[index]?.workshops?.[jokeIndex]
        if (!cur || cur.chatId !== chat.chatId) return prev
        const next = res.ok ? { ...cur, savedAt: res.savedAt, saveError: undefined } : { ...cur, saveError: res.error }
        return { ...prev, [index]: { ...prev[index], workshops: { ...(prev[index]?.workshops ?? {}), [jokeIndex]: next } } }
      })
    },
    [jobs, readJobs, flavorId, setJobsFor]
  )
  // Chats that were never saved (made before the table existed, or whose
  // save failed) are saved once when the page loads, one attempt per chat id.
  const backfilled = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!loaded.current) return
    for (const source of ['persona', 'persona-read'] as Source[]) {
      const record = source === 'persona' ? jobs : readJobs
      for (const [k, job] of Object.entries(record)) {
        for (const [jk, chat] of Object.entries(job.workshops ?? {})) {
          if (chat.pending || chat.savedAt || !chat.messages.length) continue
          // A chat from before chats had ids gets one now, and keeps it. The
          // id is derived from the joke and the first message's time, so a
          // second pass (this effect re-runs before the state lands) makes
          // the SAME id and the upsert rewrites one row instead of adding one.
          const joke = job.jokes?.[Number(jk)] ?? ''
          const withId: WorkshopChat = chat.chatId
            ? chat
            : { ...chat, chatId: `legacy-${heartId(job.persona, job.moment, joke)}-${(chat.messages[0]?.at ?? '').replace(/[^0-9]/g, '').slice(0, 14)}` }
          if (backfilled.current.has(withId.chatId!)) continue
          backfilled.current.add(withId.chatId!)
          if (!chat.chatId) {
            const index = Number(k)
            setJobsFor(source)((prev) => ({
              ...prev,
              [index]: { ...prev[index], workshops: { ...(prev[index]?.workshops ?? {}), [Number(jk)]: withId } },
            }))
          }
          void saveWorkshop(source, Number(k), Number(jk), withId, hearted)
        }
      }
    }
  }, [jobs, readJobs, hearted, saveWorkshop, setJobsFor])
  // Whenever the hearts change, any chat whose hearted rewrites or edits
  // changed is saved again, so an unheart anywhere reaches the database.
  const lastSavedHearts = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    if (!loaded.current) return
    for (const source of ['persona', 'persona-read'] as Source[]) {
      const record = source === 'persona' ? jobs : readJobs
      for (const [k, job] of Object.entries(record)) {
        for (const [jk, chat] of Object.entries(job.workshops ?? {})) {
          if (!chat.chatId || chat.pending) continue
          const joke = job.jokes?.[Number(jk)]
          if (!joke) continue
          const ids = hearted
            .filter((h) => (h.origin === 'workshop' || h.origin === 'edit') && h.refinedFrom === joke && h.moment === job.moment)
            .map((h) => h.id)
            .sort()
            .join(',')
          const before = lastSavedHearts.current.get(chat.chatId)
          if (before === undefined) {
            // First sight of this chat this session: remember, do not save.
            lastSavedHearts.current.set(chat.chatId, ids)
            continue
          }
          if (before === ids) continue
          lastSavedHearts.current.set(chat.chatId, ids)
          void saveWorkshop(source, Number(k), Number(jk), chat, hearted)
        }
      }
    }
  }, [hearted, jobs, readJobs, saveWorkshop])
  const workshopSend = useCallback(
    async (source: Source, index: number, jokeIndex: number, text: string) => {
      const job = (source === 'persona' ? jobs : readJobs)[index]
      const who = personas.find((p) => p.name === job?.persona) ?? null
      const joke = job?.jokes?.[jokeIndex]
      if (!job || !who || !joke) return
      const setRecord = setJobsFor(source)
      const existing = job.workshops?.[jokeIndex]
      const chatId = existing?.chatId ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const prior = existing?.messages ?? []
      const messages = [...prior, { role: 'user' as const, content: text, at: new Date().toISOString() }]
      setRecord((prev) => ({
        ...prev,
        [index]: {
          ...prev[index],
          workshops: {
            ...(prev[index]?.workshops ?? {}),
            [jokeIndex]: { ...existing, chatId, messages, pending: true, error: undefined, model: WORKSHOP_MODEL, reasoningEffort: WORKSHOP_EFFORT },
          },
        },
      }))
      const systemPrompt = workshopSystemPrompt({
        personaName: who.name,
        personaText: who.text,
        moment: job.moment,
        siblings: (job.jokes ?? []).filter((_, k) => k !== jokeIndex),
        studentRead: studentReads[index]?.status === 'done' ? (studentReads[index].data ?? null) : null,
        joke,
        analysis: job.analyses?.[jokeIndex] ?? null,
        refinement: job.refinements?.[jokeIndex] ?? null,
        comicMoves: comicMoves?.text ?? null,
      })
      const res = await chatAction({
        providerModelId: WORKSHOP_MODEL,
        systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        reasoningEffort: WORKSHOP_EFFORT,
      })
      const finished: WorkshopChat = res.ok
        ? { ...existing, chatId, messages: [...messages, { role: 'assistant' as const, content: res.text ?? '', at: new Date().toISOString() }], pending: false, error: undefined, model: WORKSHOP_MODEL, reasoningEffort: WORKSHOP_EFFORT }
        : { ...existing, chatId, messages, pending: false, error: res.error ?? 'The call failed.', model: WORKSHOP_MODEL, reasoningEffort: WORKSHOP_EFFORT }
      setRecord((prev) => ({ ...prev, [index]: { ...prev[index], workshops: { ...(prev[index]?.workshops ?? {}), [jokeIndex]: finished } } }))
      void saveWorkshop(source, index, jokeIndex, finished, hearted)
    },
    [jobs, readJobs, personas, studentReads, comicMoves, setJobsFor, saveWorkshop, hearted]
  )
  const workshopClear = useCallback(
    (source: Source, index: number, jokeIndex: number) => {
      setJobsFor(source)((prev) => {
        const workshops = { ...(prev[index]?.workshops ?? {}) }
        delete workshops[jokeIndex]
        return { ...prev, [index]: { ...prev[index], workshops } }
      })
    },
    [setJobsFor]
  )

  // ---- outline
  // One block per moment that has jokes from either source.
  const jobList = [...new Set([...Object.keys(jobs), ...Object.keys(readJobs)].map(Number))]
    .sort((a, b) => a - b)
    .map((index) => {
      const job = jobs[index] ?? null
      const readJob = readJobs[index] ?? null
      return {
        index,
        job,
        readJob,
        moment: (job ?? readJob)!.moment,
        persona: (job ?? readJob)!.persona,
      }
    })
  const doneCount = jobList.filter(({ job, readJob }) => job?.status === 'done' || readJob?.status === 'done').length
  const readList = Object.entries(studentReads)
    .map(([k, job]) => ({ index: Number(k), job }))
    .sort((a, b) => a.index - b.index)
  const readDone = readList.filter(({ job }) => job.status === 'done').length
  // The moment whose read is open on the right: the picked one, else the first.
  const shownRead = selectedRead != null && studentReads[selectedRead] ? selectedRead : (readList[0]?.index ?? null)
  const readIsStale = readList.some(({ job }) => job.promptFile && studentRead && job.promptFile !== studentRead.file)
  const navEntries: NavEntry[] = [
    {
      id: 'pick-the-moments',
      label: '1. Pick the moments',
      note: liveMoments.length ? `${liveMoments.length} moment${liveMoments.length === 1 ? '' : 's'}` : 'none yet',
      children: [],
    },
    {
      id: 'read-as-students',
      label: '2. Read the moments as students',
      note: readList.length
        ? analyzing
          ? `${readDone} of ${readList.length} moments read`
          : `${readDone} of ${readList.length} moments have a read`
        : 'not run yet',
      children: [],
    },
    {
      id: 'pick-the-persona',
      label: '3. Pick the persona',
      note: persona ? persona.name : 'none picked',
      children: [],
    },
    {
      id: 'read-the-jokes',
      label: '4. Get jokes from the persona',
      note: jobList.length
        ? running
          ? `${doneCount} of ${jobList.length} moments done`
          : `${doneCount} of ${jobList.length} moments have jokes`
        : 'not run yet',
      children: jobList.map(({ index, job, readJob, moment }) => {
        const word = (j: Job | null) =>
          !j ? null : j.status === 'running' ? 'writing…' : j.status === 'failed' ? 'failed' : `${j.jokes?.length ?? 0}`
        const analyzedNote = (j: Job | null) => {
          const done = Object.values(j?.analyses ?? {}).filter((a) => a.status === 'done')
          if (!done.length) return null
          const n = (action: string) => done.filter((a) => a.data?.action === action).length
          return `${n('keep')} keep, ${n('refine_execution')} refine, ${n('reject')} reject`
        }
        const parts = [
          job ? `${word(job)} from the persona` : null,
          readJob ? `${word(readJob)} with the read` : null,
          analyzedNote(readJob) ?? analyzedNote(job),
        ].filter(Boolean)
        return {
          id: `jokes-moment-${index + 1}`,
          label: `Moment ${index + 1}: ${shorten(moment, 48)}`,
          note: parts.join(' · '),
          children: [],
        }
      }),
    },
    {
      id: 'hearted-jokes',
      label: '5. Turn the hearted jokes into memes',
      note: hearted.length
        ? `${hearted.length} hearted, ${hearted.reduce(
            (n, h) => n + Object.values(h.memes ?? {}).filter((m) => m.imageUrl || m.embedSrc).length,
            0
          )} memes with a picture`
        : 'nothing hearted yet',
      children: hearted.map((h) => {
        const memes = Object.values(h.memes ?? {}).filter((m) => m.imageUrl || m.embedSrc).length
        return {
          id: `hearted-${h.id}`,
          label: shorten(h.caption, 48),
          note: memes ? `${memes} meme${memes === 1 ? '' : 's'} with a picture` : 'no picture yet',
          children: [],
        }
      }),
    },
  ]
  const canClear = liveMoments.length > 0 || Boolean(personaName) || jobList.length > 0 || readList.length > 0
  const modelLine = step ? step.modelName : 'no model set'
  // The current run as one document, for the sidebar's copy button.
  const bundle = useMemo(
    () =>
      jobList.length || readList.length
        ? buildRunBundle({
            flavorId,
            label: 'the current run',
            personaName: persona?.name ?? jobList[0]?.persona ?? '',
            persona,
            step1: step,
            step2,
            studentReadPrompt: studentRead,
            evaluator: evaluatorFor(persona?.name ?? jobList[0]?.persona ?? ''),
            jokeCount,
            moments: liveMoments,
            studentReads,
            jobs,
            readJobs,
            hearted,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jobList/readList derive from jobs/readJobs/studentReads
    [flavorId, persona, step, step2, studentRead, evaluatorFor, jokeCount, liveMoments, studentReads, jobs, readJobs, hearted]
  )

  // ---- share by link: a frozen copy of the run, saved to the database
  const [shareState, setShareState] = useState<ShareState>({ status: 'idle' })
  const shareRun = useCallback(() => {
    setShareState({ status: 'saving' })
    const snapshot: RunSnapshot = {
      moments: liveMoments,
      personaName,
      jokeCount,
      jobs,
      readJobs,
      studentReads,
      hearted,
    }
    void shareRunAction(flavorId, snapshot)
      .then((r) => {
        if (r.ok === false) {
          setShareState({ status: 'failed', error: r.error })
          return
        }
        const url = `${window.location.origin}/humor-flavor/${flavorId}/reaction-jokes?share=${r.id}#read-the-jokes`
        setShareState({ status: 'done', url })
      })
      .catch((err) => setShareState({ status: 'failed', error: err instanceof Error ? err.message : String(err) }))
  }, [flavorId, liveMoments, personaName, jokeCount, jobs, readJobs, studentReads, hearted])

  return (
    <div className="lg:flex lg:gap-10">
      <PageNav
        entries={navEntries}
        onClear={clearRun}
        canClear={canClear}
        historyCount={history.length}
        historyHref={`/humor-flavor/${flavorId}/reaction-jokes/history`}
        workshopsHref={readOnly ? `/humor-flavor/${flavorId}/reaction-jokes/workshops` : null}
        bundle={bundle}
        shared={shared}
        onShare={shareRun}
        shareState={shareState}
      />

      {/* On a shared run every control inside is disabled (a disabled
          fieldset disables every button and field in it), so a viewer can
          read and copy but not run, heart, or edit what is not theirs. */}
      <fieldset disabled={shared} className="m-0 min-w-0 flex-1 space-y-8 border-0 p-0">
        {share ? (
          <div className="max-w-3xl rounded-xl border border-[rgb(var(--accent-strong)/0.5)] bg-[rgb(var(--panel)/0.35)] px-4 py-3 text-sm dark:bg-[rgb(var(--panel)/0.15)]">
            <p className="font-semibold">
              A run shared by {share.sharedBy} on{' '}
              {new Date(share.sharedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.
            </p>
            <p className="mt-1 text-[rgb(var(--muted))]">
              This is a frozen copy: {snapshot?.moments.length ?? 0} moment{snapshot?.moments.length === 1 ? '' : 's'},{' '}
              the {snapshot?.personaName || 'unnamed'} persona, and {snapshot?.hearted.length ?? 0} hearted joke
              {snapshot?.hearted.length === 1 ? '' : 's'}. Read-only: nothing here can be run, hearted, or changed, and your own
              run in this browser is untouched.{' '}
              <Link href={`/humor-flavor/${flavorId}/reaction-jokes`} className="underline hover:text-[rgb(var(--accent-strong))]">
                Back to your own run
              </Link>
              .
            </p>
          </div>
        ) : null}
        {shareError ? (
          <p className="max-w-3xl text-sm text-red-700 dark:text-red-400">
            {shareError}{' '}
            <Link href={`/humor-flavor/${flavorId}/reaction-jokes`} className="underline">
              Showing your own run instead
            </Link>
            .
          </p>
        ) : null}
        {storageError ? (
          <p className="max-w-3xl text-sm text-red-700 dark:text-red-400">
            This browser could not save the run: {storageError}
          </p>
        ) : null}
        {!stepIsUsable ? (
          <p className="max-w-3xl text-sm text-red-700 dark:text-red-400">
            {step
              ? `Step 1 of this flavor is missing a placeholder this page fills: it needs {{PERSONA}}, {{MOMENT}}, and {{JOKE_COUNT}}, and has ${
                  stepPlaceholders.length ? stepPlaceholders.map((n) => `{{${n}}}`).join(', ') : 'none'
                }.`
              : 'This flavor has no step 1, so there is nothing to run.'}
          </p>
        ) : null}

        {/* ---- 1. moments */}
        <section className={`${SECTION} max-w-3xl`} id="pick-the-moments">
          <p className={SECTION_NUMBER}>Step 1 of 5</p>
          <h2 className={SECTION_TITLE}>Pick the moments</h2>
          <ul className={`${GOAL_TEXT} list-disc space-y-1 pl-5`}>
            <li>Each moment gets its own model call and its own set of jokes; how many is set in step 4.</li>
            <li>Type a moment, or pick real ones from an archived Sidechat clustering.</li>
          </ul>

          <div className="mt-6 space-y-6">
            <div>
              <label className={FIELD_LABEL} htmlFor="reaction-moment">
                The moments the persona reacts to
              </label>
              <p className={FIELD_HELP}>
                As concrete as you have it. Fills <code>{'{{MOMENT}}'}</code>.
              </p>
              <div className="mt-2 space-y-3">
                {moments.map((text, i) => (
                  <div key={i}>
                    {moments.length > 1 ? (
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[rgb(var(--muted))]">
                          Moment {i + 1}
                        </span>
                        <button
                          type="button"
                          className="text-xs font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                          disabled={running}
                          onClick={() => setMoments((prev) => prev.filter((_, j) => j !== i))}
                        >
                          Remove this moment
                        </button>
                      </div>
                    ) : null}
                    <textarea
                      id={i === 0 ? 'reaction-moment' : `reaction-moment-${i + 1}`}
                      className={`${TEXTAREA} mt-1`}
                      rows={4}
                      value={text}
                      onChange={(e) => setMoments((prev) => prev.map((m, j) => (j === i ? e.target.value : m)))}
                      placeholder={
                        i === 0
                          ? 'Columbia agrees to a $200M federal settlement…'
                          : 'Another moment for the same persona…'
                      }
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                className={`${SMALL_BUTTON} mt-3`}
                disabled={running}
                onClick={() => setMoments((prev) => [...prev, ''])}
              >
                Add another moment
              </button>
            </div>

            <div>
              <button
                type="button"
                className="text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                onClick={() => setShowSidechatPicker((v) => !v)}
              >
                {showSidechatPicker ? 'Hide the' : 'Or pick one or more moments from an'} archived Sidechat clustering
              </button>
              {showSidechatPicker ? (
                <div className="mt-2">
                  <SidechatMomentPicker
                    disabled={running}
                    selectedTexts={moments}
                    onPick={(m) => {
                      setMoments((prev) =>
                        prev.length && !prev[prev.length - 1].trim()
                          ? [...prev.slice(0, -1), m.text]
                          : [...prev, m.text]
                      )
                    }}
                    onRemove={(m) => {
                      setMoments((prev) => {
                        const next = prev.filter((t) => t.trim() !== m.text.trim())
                        return next.length ? next : ['']
                      })
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* ---- 2. the student read. Selection on the left (which moment),
            the analysis on the right. Runs on the flavor's model, with the
            analysis prompt file's text and {{EVENT}} filled. */}
        <section className={`${SECTION} max-w-6xl`} id="read-as-students">
          <p className={SECTION_NUMBER}>Step 2 of 5</p>
          <h2 className={SECTION_TITLE}>Read the moments as students</h2>
          <ul className={`${GOAL_TEXT} list-disc space-y-1 pl-5`}>
            <li>
              One call per moment, {CONCURRENCY} at a time, to {modelLine}: what students are collectively doing,
              feeling, and risking in it, and which details are shared across the posts versus incidental to one.
            </li>
            <li>
              The prompt is the newest dated file in <code>docs/prompts/analyses/student-read/</code>, with{' '}
              <code>{'{{EVENT}}'}</code> filled. It returns JSON; the panel lays that JSON out by field.
            </li>
            <li>This step is for reading. It does not change what the persona is sent in step 4.</li>
          </ul>

          <div className="mt-6">
            <button
              type="button"
              className={BIG_BUTTON}
              disabled={analyzing || running || !step || !studentRead || !liveMoments.length}
              onClick={() => void runStudentReads()}
            >
              {analyzing
                ? `Reading ${readList.length} moment${readList.length === 1 ? '' : 's'} as students…`
                : `Read ${liveMoments.length === 1 ? 'the moment' : `all ${liveMoments.length} moments`} as students`}
            </button>
            {!studentRead ? (
              <p className={FIELD_HELP}>
                No Student Read prompt is on file in docs/prompts/analyses/student-read/, so this step cannot run.
              </p>
            ) : !liveMoments.length ? (
              <p className={FIELD_HELP}>Add a moment first.</p>
            ) : (
              <p className={FIELD_HELP}>
                Prompt version of {studentRead.date}
                {studentRead.versions > 1 ? ` (${studentRead.versions} on file)` : ''}.
                {readIsStale ? ' The reads below came from an older version than the one now on file.' : ''}
              </p>
            )}
          </div>

          {readList.length ? (
            <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-x-10">
              <div>
                <p className={FIELD_LABEL}>The moments</p>
                <div className="mt-3 space-y-2">
                  {readList.map(({ index, job }) => (
                    <button
                      key={index}
                      type="button"
                      aria-pressed={shownRead === index}
                      onClick={() => setSelectedRead(index)}
                      className={`block w-full rounded-lg border-2 px-3 py-2 text-left transition ${
                        shownRead === index
                          ? 'border-current bg-[rgb(var(--panel))] dark:bg-[rgb(var(--panel)/0.5)]'
                          : 'border-transparent hover:bg-[rgb(var(--panel)/0.8)]'
                      }`}
                    >
                      <span className="block text-xs font-semibold uppercase tracking-[0.15em] text-[rgb(var(--muted))]">
                        Moment {index + 1}
                      </span>
                      <span
                        className={`mt-0.5 block text-sm leading-snug ${shownRead === index ? 'font-semibold' : ''}`}
                      >
                        {shorten(job.moment, 120)}
                      </span>
                      <span className="mt-1 block text-[11px] text-[rgb(var(--muted))]">
                        {job.status === 'running'
                          ? 'reading…'
                          : job.status === 'failed'
                            ? 'failed'
                            : `${job.data?.primary_emotion ?? 'read'}${
                                job.data?.shared_behavior ? ` · ${shorten(job.data.shared_behavior, 60)}` : ''
                              }`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-8 min-w-0 lg:mt-0">
                <p className={FIELD_LABEL}>
                  {shownRead != null ? `The student read of moment ${shownRead + 1}` : 'The student read'}
                </p>
                <div className="mt-3">
                  <StudentReadPanel job={shownRead != null ? (studentReads[shownRead] ?? null) : null} />
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {/* ---- 3. persona. Selection on the left, the evidence (the exact
            text that will be sent) on the right, always in view. */}
        <section className={`${SECTION} max-w-6xl`} id="pick-the-persona">
          <p className={SECTION_NUMBER}>Step 3 of 5</p>
          <h2 className={SECTION_TITLE}>Pick the persona</h2>
          <ul className={`${GOAL_TEXT} list-disc space-y-1 pl-5`}>
            <li>One persona reacts to every moment above.</li>
            <li>
              Its voice prompt is the persona&rsquo;s section of the prompt file, sent as written. It fills{' '}
              <code>{'{{PERSONA}}'}</code>.
            </li>
          </ul>

          <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-x-10">
            <fieldset>
              <legend className={FIELD_LABEL}>The persona who reacts</legend>
              <div className="mt-3 space-y-1">
                {personas.map((p) => (
                  <label
                    key={p.name}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 px-3 py-2 transition ${
                      personaName === p.name
                        ? 'border-current bg-[rgb(var(--panel))] dark:bg-[rgb(var(--panel)/0.5)]'
                        : 'border-transparent hover:bg-[rgb(var(--panel)/0.8)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="reaction-persona"
                      value={p.name}
                      checked={personaName === p.name}
                      disabled={running}
                      onChange={() => setPersonaName(p.name)}
                      className="mt-1.5"
                    />
                    <span className="min-w-0">
                      <span className={`block text-base ${personaName === p.name ? 'font-semibold' : ''}`}>
                        {p.name}
                      </span>
                      {/* A minor detail: one quiet line under the name. */}
                      <span className="block text-[11px] text-[rgb(var(--muted))]">
                        {p.text.length.toLocaleString()} characters
                        {p.date ? ` · ${p.date}` : ''}
                        {p.versions > 1 ? ` · ${p.versions} versions on file` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-8 min-w-0 lg:mt-0">
              <p className={FIELD_LABEL}>
                {persona
                  ? `The voice prompt that will be sent for ${persona.name}`
                  : 'The voice prompt that will be sent'}
              </p>
              {persona ? (
                <>
                  <p className={FIELD_HELP}>
                    From <code>{persona.file}</code>, heading &ldquo;
                    {persona.heading}&rdquo;.
                    {persona.versions > 1
                      ? ` The newest of ${persona.versions} dated files in that folder is the one in use; the older ones are history.`
                      : ' The only dated file in its folder.'}
                  </p>
                  <PersonaPromptView text={persona.text} personaName={persona.name} />
                </>
              ) : (
                <p className={FIELD_HELP}>
                  Pick a persona on the left and its section of the prompt file appears here.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ---- 4. jokes */}
        <section className={SECTION} id="read-the-jokes">
          <p className={SECTION_NUMBER}>Step 4 of 5</p>
          <h2 className={SECTION_TITLE}>Get jokes from the persona</h2>
          <ul className={`${GOAL_TEXT} list-disc space-y-1 pl-5`}>
            <li>
              One call per moment, {CONCURRENCY} at a time, to {modelLine}: the persona reacts to that moment in
              as many one-line jokes as the field below asks for.
            </li>
            {readOnly ? (
              <li>
                On this flavor the jokes come from the persona and the moment&rsquo;s student read (step 2) only; the
                persona-alone source is not offered here.
              </li>
            ) : (
              <li>
                Two ways to get them, side by side: from the persona alone (the flavor&rsquo;s step 1), or from the
                persona and the moment&rsquo;s student read (step 2, the same prompt with the read added). A moment shows
                both sets when both have run.
              </li>
            )}
            <li>
              Only this run&rsquo;s jokes show here: one persona on these moments. A run as another persona
              or on other moments moves what is here to the past-runs page, and so does re-running a
              source. Everything stays in this browser.
            </li>
            <li>
              For a persona with an evaluator prompt (Sad Girl and GigaChad so far), one call per joke scores it out of 100 on the
              evaluator&rsquo;s dimensions; the score sits beside the joke and the breakdown opens under it.
            </li>
            {analyzerUsable ? (
              <>
                <li>
                  This flavor also analyzes jokes after they exist (its step 3): one call per joke reconstructs the
                  premise under it, labels its comic moves against the catalog in{' '}
                  <code>docs/prompts/analyses/comic-moves/</code> (several per joke, or one the catalog does not name),
                  judges the idea and the wording separately, and marks it keep, refine, or reject. The action beside
                  each joke opens that analysis on the right. The writer never sees the catalog.
                </li>
                {refinerUsable ? (
                  <li>
                    Then, only for jokes marked refine, its step 4 writes two or three variants that keep the premise
                    and fix the one diagnosed problem. They sit under the original, each with its own heart; the
                    original stays.
                  </li>
                ) : null}
              </>
            ) : null}
            {readOnly ? (
              <li>
                Click a joke to open it in the workshop pane on the right: its moment, student read, analysis, and
                variants, and a chat with {WORKSHOP_MODEL} at {WORKSHOP_EFFORT} reasoning that has all of that as
                context. The conversation is saved with the run.
              </li>
            ) : null}
            <li>Heart a joke to keep it: hearted jokes go to step 5, where they become memes.</li>
          </ul>

          <div className="mt-6 max-w-xs">
            <label className={FIELD_LABEL} htmlFor="reaction-joke-count">
              Jokes per moment
            </label>
            <p className={FIELD_HELP}>
              How many jokes each call asks for. Fills <code>{'{{JOKE_COUNT}}'}</code> in both steps.
            </p>
            <input
              id="reaction-joke-count"
              type="number"
              min={1}
              max={50}
              step={1}
              className={`${TEXTAREA} mt-2 w-24`}
              value={jokeCount}
              disabled={running}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value))
                if (Number.isFinite(n) && n >= 1 && n <= 50) setJokeCount(n)
              }}
            />
          </div>

          <div className={`mt-6 ${readOnly ? '' : SET_COLUMNS} space-y-4 lg:space-y-0`}>
            <div className={readOnly ? 'hidden' : ''}>
              <button
                type="button"
                className={BIG_BUTTON}
                disabled={running || !stepIsUsable || !persona || !liveMoments.length}
                onClick={() => void runAll('persona')}
              >
                {runningSource === 'persona'
                  ? `Writing jokes for ${liveMoments.length} moment${liveMoments.length === 1 ? '' : 's'}…`
                  : `Write ${jokeCount} reaction jokes for ${
                      liveMoments.length === 1 ? 'the moment' : `each of ${liveMoments.length} moments`
                    }${persona ? ` as ${persona.name}` : ''}`}
              </button>
              {!persona || !liveMoments.length ? (
                <p className={FIELD_HELP}>
                  {!liveMoments.length && !persona
                    ? 'Add a moment and pick a persona first.'
                    : !liveMoments.length
                      ? 'Add a moment first.'
                      : 'Pick a persona first.'}
                </p>
              ) : null}
              {notSent ? <p className="mt-3 text-sm text-red-700 dark:text-red-400">{notSent}</p> : null}
            </div>
            <div>
              <button
                type="button"
                className={BIG_BUTTON}
                disabled={running || !step2IsUsable || !persona || !liveMoments.length || !readsReady}
                onClick={() => void runAll('persona-read')}
              >
                {runningSource === 'persona-read'
                  ? `Writing jokes with the student read for ${liveMoments.length} moment${
                      liveMoments.length === 1 ? '' : 's'
                    }…`
                  : `Write ${jokeCount} reaction jokes for ${
                      liveMoments.length === 1 ? 'the moment' : `each of ${liveMoments.length} moments`
                    }${persona ? ` as ${persona.name}` : ''}, with the student read`}
              </button>
              {readOnly && notSent ? <p className="mt-3 text-sm text-red-700 dark:text-red-400">{notSent}</p> : null}
              {readOnly && (!persona || !liveMoments.length) ? (
                <p className={FIELD_HELP}>
                  {!liveMoments.length && !persona
                    ? 'Add a moment and pick a persona first.'
                    : !liveMoments.length
                      ? 'Add a moment first.'
                      : 'Pick a persona first.'}
                </p>
              ) : null}
              {!step2 ? (
                <p className={FIELD_HELP}>This flavor has no step 2, so the student read cannot be sent.</p>
              ) : !step2IsUsable ? (
                <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                  Step 2 of this flavor needs {'{{PERSONA}}'}, {'{{MOMENT}}'}, {'{{JOKE_COUNT}}'}, and {'{{STUDENT_READ}}'}, and has{' '}
                  {step2Placeholders.length ? step2Placeholders.map((n) => `{{${n}}}`).join(', ') : 'none'}.
                </p>
              ) : liveMoments.length && !readsReady ? (
                <p className={FIELD_HELP}>
                  Read the moments as students first (step 2 of this page): {readsReadyCount} of {liveMoments.length}{' '}
                  {liveMoments.length === 1 ? 'has' : 'have'} a read for their current text.
                </p>
              ) : null}
            </div>
          </div>

          {jobList.length ? (
            <div className="mt-10 space-y-10">
              {jobList.map(({ index, job, readJob, moment, persona: who }) => (
                <MomentJokes
                  key={index}
                  index={index}
                  moment={moment}
                  job={job}
                  readJob={readJob}
                  isHearted={(j, caption) => heartedIds.has(heartId(j.persona, j.moment, caption))}
                  onToggleHeart={toggleHeart}
                  evaluator={evaluatorFor(who)}
                  onScore={(source) => void scoreJob(source, index)}
                  scoring={(source) => Boolean(scoringJobs[`${source}:${index}`])}
                  analyzer={analyzerUsable}
                  onAnalyze={(source) => void analyzeJob(source, index)}
                  analyzing={(source) => Boolean(analyzingJobs[`${source}:${index}`])}
                  refiner={refinerUsable}
                  onRefine={(source) => void refineJob(source, index)}
                  refining={(source) => Boolean(refiningJobs[`${source}:${index}`])}
                  readOnly={readOnly}
                  studentRead={studentReads[index] ?? null}
                  onWorkshopSend={(source, jokeIndex, text) => void workshopSend(source, index, jokeIndex, text)}
                  onWorkshopClear={(source, jokeIndex) => workshopClear(source, index, jokeIndex)}
                  editsOf={(j, joke) =>
                    hearted.filter((h) => h.origin === 'edit' && h.refinedFrom === joke && h.moment === j.moment && h.persona === j.persona)
                  }
                  onWorkshopMint={(j, caption, original) => {
                    const id = heartId(j.persona, j.moment, caption)
                    if (hearted.some((h) => h.id === id)) return
                    const minted: HeartedJoke = {
                      id,
                      caption,
                      persona: j.persona,
                      moment: j.moment,
                      heartedAt: new Date().toISOString(),
                      refinedFrom: original,
                      origin: 'edit',
                      note: 'edited by hand',
                    }
                    setHearted((prev) => [minted, ...prev])
                    // Save it with the joke's chat row; start a chat record if none exists yet.
                    const jokeIndex = j.jokes?.indexOf(original) ?? -1
                    if (jokeIndex < 0) return
                    const source = j.source ?? 'persona-read'
                    const existing = j.workshops?.[jokeIndex]
                    const chat: WorkshopChat = existing?.chatId
                      ? existing
                      : { ...existing, chatId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, messages: existing?.messages ?? [] }
                    if (!existing?.chatId) {
                      setJobsFor(source)((prev) => ({
                        ...prev,
                        [index]: { ...prev[index], workshops: { ...(prev[index]?.workshops ?? {}), [jokeIndex]: chat } },
                      }))
                    }
                    void saveWorkshop(source, index, jokeIndex, chat, [minted, ...hearted])
                  }}
                  onWorkshopHeart={(j, caption, original, note, askedFor) =>
                    // The saved chat row follows the hearts (effect above).
                    toggleHeart(j, caption, original, { origin: 'workshop', note, askedFor })
                  }
                />
              ))}
            </div>
          ) : null}
        </section>

        {/* ---- 5. the keepers */}
        <HeartedJokesSection
          hearted={hearted}
          step={step}
          onUnheart={unheart}
          onSetPicture={setPicture}
          onSetVisualWords={setVisualWords}
        />
      </fieldset>
    </div>
  )
}
