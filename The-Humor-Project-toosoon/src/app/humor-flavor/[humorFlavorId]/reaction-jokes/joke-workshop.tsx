'use client'

// The workshop pane for ONE joke (Lydia, 2026-09-09: "click on a meme and
// open a pane to workshop it. It should have all its info in (moment,
// analysis, etc) and I just want to have a chat with gpt 5.6 sol medium
// reasoning"). Everything known about the joke sits at the top, quiet; the
// chat is below it. The chat's context is assembled here into one system
// prompt: the persona voice, the moment, the student read, the joke, its
// analysis, its variants, and the comic-moves catalog as editing knowledge.
// The conversation is saved on the job, per joke, in the browser record.
import { useEffect, useRef, useState } from 'react'

import { TEXTAREA } from '../pov-jokes/pov-jokes-ui'
import { analysisScore, words, type AnalysisJob, type RefineJob } from './joke-analysis'
import type { HeartedJoke } from './hearted-jokes'
import { HeartIcon } from './run-record'
import { studentReadAsText, type StudentRead } from './student-read'

// A rewrite the model offered, picked out of its prose: a line that is a
// quoted joke, optionally followed by a dash and the model's own tag
// ("— douchiest version"). Everything else in the message is prose.
export type WorkshopLine = { kind: 'joke'; caption: string; note?: string } | { kind: 'text'; text: string }
const QUOTED = /^\s*(?:[-*•]|\d+[.)])?\s*[“"](.+?)[”"]\s*(?:[—–-]+\s*(.*))?$/
export const parseWorkshopLines = (content: string): WorkshopLine[] =>
  content.split(/\r?\n/).map((line) => {
    const m = QUOTED.exec(line)
    if (m && m[1].trim().length > 8) return { kind: 'joke', caption: m[1].trim(), note: m[2]?.trim() || undefined }
    return { kind: 'text', text: line }
  })

export type WorkshopMessage = { role: 'user' | 'assistant'; content: string; at: string }
export type WorkshopChat = {
  // The conversation's id, also the row id in reaction_joke_workshops.
  // "Start over" drops the chat from the page; the next message starts a
  // new id, so the old row stays in the database.
  chatId?: string
  messages: WorkshopMessage[]
  // Set while an answer is on its way; failed answers are kept as an error.
  pending?: boolean
  error?: string
  model?: string
  reasoningEffort?: string
  // When the database last accepted this chat, or why it did not.
  savedAt?: string
  saveError?: string
}

export const WORKSHOP_MODEL = 'gpt-5.6-sol'
export const WORKSHOP_EFFORT = 'medium' as const

export function workshopSystemPrompt(input: {
  personaName: string
  personaText: string
  moment: string
  studentRead: StudentRead | null
  joke: string
  analysis: AnalysisJob | null
  refinement: RefineJob | null
  comicMoves: string | null
  // The other jokes written for the same moment, so rewrites of this one do
  // not drift into its neighbours (seen 2026-09-09: rewrites of one joke
  // borrowed "rests" and "mourning" from the joke above it).
  siblings?: string[]
}): string {
  const a = input.analysis?.status === 'done' ? input.analysis.data : null
  const L: string[] = []
  L.push(
    `You are workshopping ONE reaction joke with its editor. The joke was written in the voice of a persona about a real campus moment. The editor will say what they want: tighter wording, a different turn, more of the persona, alternatives, or just talk about why it works or does not. Answer in plain prose, briefly; when you offer rewrites, give two or three, one per line, in the persona's voice, and say in a few words what each changes. Keep the campus anchor in every rewrite. Do not explain the joke back to the editor unless asked. This is a conversation: when the editor pushes back, reconsider.`
  )
  L.push('')
  L.push(`THE JOKE:\n"${input.joke}"`)
  L.push('')
  L.push(`THE PERSONA (${input.personaName}), its voice prompt as written:\n${input.personaText}`)
  L.push('')
  L.push(`THE MOMENT it reacts to:\n${input.moment}`)
  if (input.studentRead) {
    L.push('')
    L.push(`THE STUDENT READ of the moment (what students are collectively doing, feeling, and risking):\n${studentReadAsText(input.studentRead)}`)
  }
  if (a) {
    L.push('')
    L.push(
      `THE ANALYSIS of the joke (from a separate analyzer; treat it as one reading, not the truth):\n` +
        `premise: ${a.premise ?? '–'}\n` +
        `moves: ${[a.primary_move, ...(a.supporting_moves ?? [])].filter(Boolean).join(', ') || 'none named'}\n` +
        (a.unexplained_move ? `not in the catalog: ${a.unexplained_move}\n` : '') +
        `premise quality ${a.premise_quality ?? '?'}, execution quality ${a.execution_quality ?? '?'}, connection legibility ${a.connection_legibility ?? '?'}, persona fit ${a.persona_fit ?? '?'}\n` +
        `action: ${a.action ?? '?'}` +
        (a.specific_problem ? `\ndiagnosed problem: ${a.specific_problem}` : '') +
        (a.preserve ? `\nmust be preserved: ${a.preserve}` : '')
    )
  }
  if (input.siblings?.length) {
    L.push('')
    L.push(`THE OTHER JOKES already written for this moment. They are NOT the subject; do not drift into their wording or premises. A rewrite of THE JOKE must keep its own premise and stay distinct from every line here:\n${input.siblings.map((s) => `- ${s}`).join('\n')}`)
  }
  if (input.refinement?.status === 'done' && input.refinement.variants?.length) {
    L.push('')
    L.push(`VARIANTS a refiner already wrote (keeping the premise):\n${input.refinement.variants.map((v, i) => `${i + 1}. ${v.joke}${v.fix ? ` (${v.fix})` : ''}`).join('\n')}`)
  }
  if (input.comicMoves) {
    L.push('')
    L.push(`THE CATALOG OF COMIC MOVES, as editing knowledge (the checks under each move are what a rewrite must pass):\n${input.comicMoves}`)
  }
  return L.join('\n')
}

const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]'

export function WorkshopPane({
  joke,
  moment,
  studentRead,
  analysis,
  refinement,
  chat,
  onSend,
  onClear,
  onClose,
  isHearted,
  onToggleHeart,
  edits,
  onMint,
}: {
  joke: string
  moment: string
  studentRead: StudentRead | null
  analysis: AnalysisJob | null
  refinement: RefineJob | null
  chat: WorkshopChat | null
  onSend: (text: string) => void
  onClear: () => void
  onClose: () => void
  isHearted: (caption: string) => boolean
  // Hearts a rewrite from the chat: the line, the model's tag, and what the
  // editor asked for in the turn before it.
  onToggleHeart: (caption: string, note: string | undefined, askedFor: string | undefined) => void
  // Versions of this joke minted by hand, already hearted.
  edits: HeartedJoke[]
  // Mints an edited version as a new joke and hearts it (Lydia,
  // 2026-09-09: "How can I indicate that I want to mint a new joke like this?").
  onMint: (caption: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [edit, setEdit] = useState(joke)
  useEffect(() => {
    setEdit(joke)
  }, [joke])
  const editReady = edit.trim().length > 0 && edit.trim() !== joke.trim() && !edits.some((e) => e.caption === edit.trim())
  const [showMoment, setShowMoment] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)
  const messages = chat?.messages ?? []
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length, chat?.pending])
  const a = analysis?.status === 'done' ? analysis.data : null
  const score = a ? analysisScore(a) : null
  const send = () => {
    const text = draft.trim()
    if (!text || chat?.pending) return
    setDraft('')
    onSend(text)
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-[rgb(var(--gloss)/0.5)] pb-2 dark:border-[rgb(var(--gloss)/0.2)]">
        <p className={LABEL}>Workshop this joke</p>
        <button type="button" className="text-xs font-semibold text-[rgb(var(--accent-strong))] hover:underline" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="mt-2 text-lg leading-relaxed">{joke}</p>

      <dl className="mt-4 space-y-3">
        <div>
          <dt className={LABEL}>The moment</dt>
          <dd className="mt-0.5 text-sm leading-relaxed">
            {showMoment || moment.length <= 240 ? moment : `${moment.slice(0, 240).trimEnd()}…`}
            {moment.length > 240 ? (
              <button
                type="button"
                className="ml-2 text-xs font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                onClick={() => setShowMoment((v) => !v)}
              >
                {showMoment ? 'less' : 'more'}
              </button>
            ) : null}
          </dd>
        </div>
        {studentRead?.event_kernel ? (
          <div>
            <dt className={LABEL}>The student read</dt>
            <dd className="mt-0.5 text-sm leading-relaxed">
              {studentRead.event_kernel}
              {studentRead.primary_emotion ? (
                <span className="text-[rgb(var(--muted))]"> · {studentRead.primary_emotion}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {a ? (
          <div>
            <dt className={LABEL}>The analysis</dt>
            <dd className="mt-0.5 text-sm leading-relaxed">
              <span className="font-semibold">{a.primary_move ? words(a.primary_move) : 'no move named'}</span>
              {a.supporting_moves?.length ? (
                <span className="text-[rgb(var(--muted))]"> with {a.supporting_moves.map(words).join(', ')}</span>
              ) : null}
              {score != null ? <span className="text-[rgb(var(--muted))]"> · {score} · {a.action ? words(a.action) : ''}</span> : null}
              <span className="block">{a.premise}</span>
              {a.unexplained_move ? (
                <span className="block text-xs text-[rgb(var(--muted))]">Not in the catalog: {a.unexplained_move}</span>
              ) : null}
              {a.specific_problem ? (
                <span className="block text-xs text-[rgb(var(--muted))]">Fix: {a.specific_problem}</span>
              ) : null}
            </dd>
          </div>
        ) : (
          <div>
            <dt className={LABEL}>The analysis</dt>
            <dd className="mt-0.5 text-sm text-[rgb(var(--muted))]">Not analyzed yet.</dd>
          </div>
        )}
        {refinement?.status === 'done' && refinement.variants?.length ? (
          <div>
            <dt className={LABEL}>Variants the refiner wrote</dt>
            <dd className="mt-0.5 space-y-1 text-sm leading-relaxed">
              {refinement.variants.map((v, i) => (
                <p key={i}>{v.joke}</p>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-6 rounded-xl bg-[rgb(var(--canvas))] p-4 dark:bg-[rgb(var(--canvas)/0.6)]">
        <p className={LABEL}>Mint a version by hand</p>
        <p className="mt-1 text-xs text-[rgb(var(--muted))]">
          Edit the line below and mint it: it becomes a new joke, hearted, shown under the original, and saved with
          this chat as your edit.
        </p>
        <textarea
          className={`${TEXTAREA} mt-2`}
          rows={2}
          value={edit}
          onChange={(e) => setEdit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && editReady) {
              e.preventDefault()
              onMint(edit.trim())
            }
          }}
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            className="rounded-lg bg-[rgb(var(--accent-strong))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!editReady}
            onClick={() => onMint(edit.trim())}
          >
            Mint this version and heart it
          </button>
          {edit.trim() === joke.trim() ? (
            <span className="text-xs text-[rgb(var(--muted))]">Change something first.</span>
          ) : null}
        </div>
        {edits.length ? (
          <div className="mt-3 space-y-1.5">
            {edits.map((e) => (
              <div key={e.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-baseline gap-x-1">
                <button
                  type="button"
                  aria-pressed={isHearted(e.caption)}
                  title="Remove the heart from this edit (it stays in the saved chat)"
                  onClick={() => onToggleHeart(e.caption, 'edited by hand', undefined)}
                  className={`self-center transition ${
                    isHearted(e.caption) ? 'text-[rgb(var(--accent-strong))]' : 'text-[rgb(var(--muted)/0.55)]'
                  }`}
                >
                  <HeartIcon filled={isHearted(e.caption)} size={16} />
                </button>
                <p className="text-sm leading-relaxed">
                  {e.caption} <span className="text-xs text-[rgb(var(--muted))]">· your edit</span>
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-xl bg-[rgb(var(--canvas))] p-4 dark:bg-[rgb(var(--canvas)/0.6)]">
        <div className="flex items-baseline justify-between gap-3">
          <p className={LABEL}>
            Chat about it with {WORKSHOP_MODEL} at {WORKSHOP_EFFORT} reasoning
          </p>
          {messages.length ? (
            <button type="button" className="text-xs font-semibold text-[rgb(var(--accent-strong))] hover:underline" onClick={onClear}>
              Start over
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-[rgb(var(--muted))]">
          It has everything above, the persona&rsquo;s voice prompt, and the comic-moves catalog. Say what you want: a
          tighter line, a different turn, more of the persona, alternatives.
        </p>
        <div className="mt-3 space-y-3">
          {messages.map((m, i) => {
            if (m.role === 'user')
              return (
                <div key={i} className="pl-6">
                  <p className={LABEL}>You</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                </div>
              )
            const askedFor = [...messages.slice(0, i)].reverse().find((x) => x.role === 'user')?.content
            const lines = parseWorkshopLines(m.content)
            return (
              <div key={i}>
                <p className={LABEL}>{WORKSHOP_MODEL}</p>
                <div className="mt-0.5 text-sm leading-relaxed">
                  {lines.map((l, k) =>
                    l.kind === 'joke' ? (
                      <div key={k} className="my-1.5 grid grid-cols-[1.75rem_minmax(0,1fr)] items-baseline gap-x-1">
                        <button
                          type="button"
                          aria-pressed={isHearted(l.caption)}
                          title={
                            isHearted(l.caption)
                              ? 'Remove the heart from this rewrite'
                              : 'Heart this rewrite: it goes to step 5 like any joke, and remembers what you asked for'
                          }
                          onClick={() => onToggleHeart(l.caption, l.note, askedFor)}
                          className={`self-center transition ${
                            isHearted(l.caption)
                              ? 'text-[rgb(var(--accent-strong))]'
                              : 'text-[rgb(var(--muted)/0.55)] hover:text-[rgb(var(--accent-strong))]'
                          }`}
                        >
                          <HeartIcon filled={isHearted(l.caption)} size={16} />
                        </button>
                        <p>
                          <span className="text-base">{l.caption}</span>
                          {l.note ? <span className="text-[rgb(var(--muted))]"> · {l.note}</span> : null}
                        </p>
                      </div>
                    ) : (
                      <p key={k} className="whitespace-pre-wrap">
                        {l.text}
                      </p>
                    )
                  )}
                </div>
              </div>
            )
          })}
          {chat?.pending ? <p className="text-sm text-[rgb(var(--muted))]">Thinking…</p> : null}
          {chat?.error ? <p className="text-sm text-red-700 dark:text-red-400">{chat.error}</p> : null}
          {chat?.saveError ? (
            <p className="text-xs text-red-700 dark:text-red-400">{chat.saveError}</p>
          ) : chat?.savedAt ? (
            <p className="text-[11px] text-[rgb(var(--muted))]">
              Saved to the database {new Date(chat.savedAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}.
            </p>
          ) : null}
          <div ref={endRef} />
        </div>
        <textarea
          className={`${TEXTAREA} mt-3`}
          rows={3}
          value={draft}
          placeholder="What do you want to do with this joke?"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            className="rounded-lg bg-[rgb(var(--accent-strong))] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!draft.trim() || Boolean(chat?.pending)}
            onClick={send}
          >
            Send
          </button>
          <span className="text-xs text-[rgb(var(--muted))]">⌘↩ sends</span>
        </div>
      </div>
    </div>
  )
}
