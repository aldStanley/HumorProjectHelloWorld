'use client'

// The saved workshop chats: a chooser on the left, the chosen conversation
// on the right, per the standing rule. Nothing here writes.
import { useState } from 'react'

import { CopyButton, FIELD_LABEL, SECTION, SECTION_NUMBER, SECTION_TITLE } from '../../pov-jokes/pov-jokes-ui'
import { words } from '../joke-analysis'

export type SavedWorkshop = {
  id: string
  persona: string
  moment: string
  joke: string
  joke_key: string
  analysis: {
    premise?: string
    primary_move?: string
    supporting_moves?: string[]
    unexplained_move?: string | null
    premise_quality?: string
    execution_quality?: string
    connection_legibility?: string
    persona_fit?: string
    specific_problem?: string | null
    action?: string
  } | null
  messages: { role: 'user' | 'assistant'; content: string; at: string }[]
  hearted: { caption: string; note?: string; asked_for?: string; hearted_at: string }[]
  model: string | null
  reasoning_effort: string | null
  created_datetime_utc: string
  modified_datetime_utc: string
}

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
const shorten = (text: string, n: number) => (text.length > n ? `${text.slice(0, n).trimEnd()}…` : text)
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]'

const asMarkdown = (r: SavedWorkshop) =>
  [
    `# Workshop chat about "${r.joke}"`,
    '',
    `- ${r.persona}, ${r.messages.length} turns on ${r.model ?? '?'}${r.reasoning_effort ? ` at ${r.reasoning_effort}` : ''}, last ${when(r.modified_datetime_utc)}`,
    `- Moment: ${r.moment}`,
    r.analysis
      ? `- Analysis: ${[r.analysis.primary_move, ...(r.analysis.supporting_moves ?? [])].filter(Boolean).join(', ')} · ${r.analysis.action ?? '?'} · ${r.analysis.premise ?? ''}`
      : null,
    ...r.hearted.map((h) => `- ♥ hearted from the chat: "${h.caption}"${h.note ? ` — ${h.note}` : ''}${h.asked_for ? ` (asked for: ${h.asked_for})` : ''}`),
    '',
    ...r.messages.flatMap((m) => [`**${m.role === 'user' ? 'Lydia' : r.model ?? 'model'}:** ${m.content.trim()}`, '']),
  ]
    .filter((l): l is string => l != null)
    .join('\n')

export default function WorkshopsClient({ rows }: { rows: SavedWorkshop[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null)
  const row = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null
  if (!rows.length)
    return (
      <p className="max-w-3xl text-sm leading-relaxed text-[rgb(var(--muted))]">
        No saved chats yet for this flavor. Open a joke in the workshop pane on the working page and send a message;
        every answer saves the conversation here.
      </p>
    )
  return (
    <section className={`${SECTION} max-w-7xl`}>
      <p className={SECTION_NUMBER}>{rows.length === 1 ? '1 conversation' : `${rows.length} conversations`}</p>
      <h2 className={SECTION_TITLE}>Read a saved workshop chat</h2>
      <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-x-10">
        <div>
          <p className={FIELD_LABEL}>The conversations, newest first</p>
          <div className="mt-3 space-y-2">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={row?.id === r.id}
                onClick={() => setSelectedId(r.id)}
                className={`block w-full rounded-lg border-2 px-3 py-2 text-left transition ${
                  row?.id === r.id
                    ? 'border-current bg-[rgb(var(--panel))] dark:bg-[rgb(var(--panel)/0.5)]'
                    : 'border-transparent hover:bg-[rgb(var(--panel)/0.8)]'
                }`}
              >
                <span className={`block text-sm leading-snug ${row?.id === r.id ? 'font-semibold' : ''}`}>
                  {shorten(r.joke, 110)}
                </span>
                <span className="mt-1 block text-[11px] text-[rgb(var(--muted))]">
                  {r.persona} · {r.messages.length} turn{r.messages.length === 1 ? '' : 's'}
                  {r.hearted.length ? ` · ${r.hearted.length} hearted` : ''} · {when(r.modified_datetime_utc)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {row ? (
          <div className="mt-8 min-w-0 lg:mt-0">
            <p className={FIELD_LABEL}>The chat about this joke</p>
            <p className="mt-2 text-xl leading-relaxed">{row.joke}</p>
            <p className="mt-1 text-xs text-[rgb(var(--muted))]">
              {row.persona} · {row.model ?? 'model unknown'}
              {row.reasoning_effort ? ` at ${row.reasoning_effort} reasoning` : ''} · started {when(row.created_datetime_utc)}, last{' '}
              {when(row.modified_datetime_utc)}
            </p>
            <div className="mt-3">
              <CopyButton text={asMarkdown(row)} label="Copy this chat as markdown" />
            </div>

            <dl className="mt-6 space-y-4">
              <div>
                <dt className={LABEL}>The moment</dt>
                <dd className="mt-1 text-sm leading-relaxed">{row.moment}</dd>
              </div>
              {row.analysis ? (
                <div>
                  <dt className={LABEL}>The analysis at the time</dt>
                  <dd className="mt-1 text-sm leading-relaxed">
                    <span className="font-semibold">{row.analysis.primary_move ? words(row.analysis.primary_move) : 'no move named'}</span>
                    {row.analysis.supporting_moves?.length ? (
                      <span className="text-[rgb(var(--muted))]"> with {row.analysis.supporting_moves.map(words).join(', ')}</span>
                    ) : null}
                    {row.analysis.action ? <span className="text-[rgb(var(--muted))]"> · {words(row.analysis.action)}</span> : null}
                    <span className="block">{row.analysis.premise}</span>
                    {row.analysis.specific_problem ? (
                      <span className="block text-xs text-[rgb(var(--muted))]">Fix: {row.analysis.specific_problem}</span>
                    ) : null}
                  </dd>
                </div>
              ) : null}
              {row.hearted.length ? (
                <div>
                  <dt className={LABEL}>Hearted from this chat</dt>
                  <dd className="mt-1 space-y-1.5">
                    {row.hearted.map((h, i) => (
                      <p key={i} className="text-sm leading-relaxed">
                        <span className="text-[rgb(var(--accent-strong))]">♥ </span>
                        {h.caption}
                        {h.note ? <span className="text-[rgb(var(--muted))]"> · {h.note}</span> : null}
                        {h.asked_for ? (
                          <span className="block text-xs text-[rgb(var(--muted))]">Asked for: {shorten(h.asked_for, 200)}</span>
                        ) : null}
                      </p>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>

            <p className={`mt-8 ${LABEL}`}>The conversation, {row.messages.length} turns</p>
            <div className="mt-3 space-y-4">
              {row.messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'pl-8' : ''}>
                  <p className={LABEL}>
                    {m.role === 'user' ? 'Lydia' : (row.model ?? 'model')}
                    <span className="ml-2 font-normal normal-case tracking-normal">{when(m.at)}</span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
