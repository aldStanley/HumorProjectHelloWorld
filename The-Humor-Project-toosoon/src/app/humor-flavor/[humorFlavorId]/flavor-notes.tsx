'use client'

import { useEffect, useState, useTransition } from 'react'

import { addFlavorNote, type FlavorNote } from './actions'

type Props = {
  flavorId: number
  initialNotes: FlavorNote[]
}

const noteCardClass =
  'rounded-lg border border-[rgb(var(--gloss)/0.5)] bg-white px-3 py-2 dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.2)]'

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

// Append-only notes log for the flavor maker pages (ops / ops-reverse): a
// running record of progress + thoughts. Posted notes can't be edited or
// deleted (no update/delete RLS on humor_flavor_notes).
//
// The composer + the latest note are always visible; "See all notes" slides
// out a sidebar with the full log.
export default function FlavorNotes({ flavorId, initialNotes }: Props) {
  const [notes, setNotes] = useState<FlavorNote[]>(initialNotes)
  const [showAll, setShowAll] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Escape closes the all-notes sidebar.
  useEffect(() => {
    if (!showAll) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowAll(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showAll])

  const post = () => {
    const body = draft.trim()
    if (!body || pending) return
    setError(null)
    startTransition(async () => {
      const res = await addFlavorNote({ flavorId, body })
      if (res.ok && res.note) {
        const note = res.note
        setNotes((prev) => [note, ...prev])
        setDraft('')
      } else {
        setError(res.error ?? 'Could not save the note.')
      }
    })
  }

  const latest = notes[0]

  return (
    <section className="rounded-xl border border-[rgb(var(--gloss)/0.6)] dark:border-[rgb(var(--gloss)/0.2)]">
      <div className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium">
        <span aria-hidden>📝</span>
        <span>
          Notes
          {notes.length > 0 && (
            <span className="ml-1.5 text-[rgb(var(--muted))]">
              ({notes.length})
            </span>
          )}
        </span>
        <span className="ml-auto text-xs font-normal text-[rgb(var(--muted))]">
          append-only log
        </span>
      </div>

      <div className="space-y-4 border-t border-[rgb(var(--gloss)/0.6)] px-4 py-4 dark:border-[rgb(var(--gloss)/0.2)]">
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post()
            }}
            rows={4}
            placeholder="What did you try, learn, or decide? (⌘↵ to post — notes can't be edited or deleted)"
            className="w-full rounded-lg border-2 border-[rgb(var(--gloss))] bg-white px-3 py-2.5 text-sm text-[rgb(var(--ink))] shadow-inner outline-none transition placeholder:text-[rgb(var(--muted)/0.7)] focus:border-[rgb(var(--primary))] focus:ring-2 focus:ring-[rgb(var(--primary)/0.2)] dark:border-[rgb(var(--gloss)/0.35)] dark:bg-[rgb(var(--panel)/0.3)]"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={post}
              disabled={pending || !draft.trim()}
              className="rounded-lg bg-[rgb(var(--primary))] px-5 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {pending ? 'Posting…' : 'Post note'}
            </button>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
          </div>
        </div>

        {latest ? (
          <div className="space-y-2">
            <div className={noteCardClass}>
              <p
                suppressHydrationWarning
                className="text-xs text-[rgb(var(--muted))]"
              >
                Latest · {formatWhen(latest.createdAt)}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{latest.body}</p>
            </div>
            {notes.length > 1 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="rounded-lg border border-[rgb(var(--gloss)/0.6)] px-4 py-1.5 text-sm font-medium transition hover:border-[rgb(var(--primary))] hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.2)]"
              >
                See all notes ({notes.length})
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-[rgb(var(--muted))]">
            No notes yet. Start the log for this flavor.
          </p>
        )}
      </div>

      {/* All-notes sidebar: backdrop + right-hand drawer with the full log. */}
      {showAll && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setShowAll(false)}
            aria-hidden
          />
          <aside
            role="dialog"
            aria-label="All notes"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--canvas))] shadow-2xl dark:border-[rgb(var(--gloss)/0.2)]"
          >
            <div className="flex items-center gap-2 border-b border-[rgb(var(--gloss)/0.6)] px-4 py-3 dark:border-[rgb(var(--gloss)/0.2)]">
              <span aria-hidden>📝</span>
              <h2 className="text-sm font-semibold">
                All notes ({notes.length})
              </h2>
              <button
                type="button"
                onClick={() => setShowAll(false)}
                aria-label="Close notes sidebar"
                className="ml-auto rounded-lg px-2 py-1 text-lg leading-none text-[rgb(var(--muted))] transition hover:text-[rgb(var(--accent-strong))]"
              >
                ✕
              </button>
            </div>
            <ul className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {notes.map((note) => (
                <li key={note.id} className={noteCardClass}>
                  <p
                    suppressHydrationWarning
                    className="text-xs text-[rgb(var(--muted))]"
                  >
                    {formatWhen(note.createdAt)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {note.body}
                  </p>
                </li>
              ))}
            </ul>
          </aside>
        </>
      )}
    </section>
  )
}
