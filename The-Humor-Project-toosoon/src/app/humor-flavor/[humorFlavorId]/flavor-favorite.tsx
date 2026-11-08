'use client'

import { useState, useTransition } from 'react'

import { saveFlavorFavorite } from './actions'

type Props = {
  flavorId: number
  initialIsFavorite: boolean
  initialComment: string
}

// Per-user favorite toggle + free-text comment for a flavor. The star saves
// immediately; the comment saves on its own button so typing isn't chatty.
export default function FlavorFavorite({
  flavorId,
  initialIsFavorite,
  initialComment,
}: Props) {
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite)
  const [comment, setComment] = useState(initialComment)
  const [savedComment, setSavedComment] = useState(initialComment)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const commentDirty = comment !== savedComment

  const save = (nextFavorite: boolean, nextComment: string) => {
    setError(null)
    startTransition(async () => {
      const res = await saveFlavorFavorite({
        flavorId,
        isFavorite: nextFavorite,
        comment: nextComment,
      })
      if (!res.ok) {
        setError(res.error ?? 'Could not save.')
        return
      }
      setIsFavorite(nextFavorite)
      setSavedComment(nextComment.trim())
      setComment(nextComment.trim())
    })
  }

  return (
    <section className="gloss-panel rounded-[32px] border border-[rgb(var(--primary)/0.35)] bg-[linear-gradient(140deg,rgb(var(--primary-bright)/0.18),rgb(var(--primary)/0.08))] p-6 shadow-[0_30px_70px_-48px_rgb(var(--primary-deep)/0.4)] backdrop-blur dark:border-[rgb(var(--primary)/0.25)] dark:bg-[linear-gradient(140deg,rgb(var(--primary-deep)/0.22),rgb(var(--primary)/0.08))]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.3em] text-[rgb(var(--muted))]">
          My take on this flavor
        </p>
        <button
          type="button"
          onClick={() => save(!isFavorite, comment)}
          disabled={pending}
          aria-pressed={isFavorite}
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition disabled:opacity-50 ${
            isFavorite
              ? 'border-[rgb(var(--primary))] bg-[rgb(var(--primary)/0.15)] text-[rgb(var(--accent-strong))]'
              : 'border-[rgb(var(--gloss)/0.6)] text-[rgb(var(--muted))] hover:text-[rgb(var(--accent-strong))] dark:border-[rgb(var(--gloss)/0.2)]'
          }`}
        >
          <span aria-hidden>{isFavorite ? '★' : '☆'}</span>
          {isFavorite ? 'Favorited' : 'Favorite'}
        </button>
      </div>

      <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.22em] text-[rgb(var(--muted))]">
        Comment
      </label>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={5}
        placeholder="A general comment about this flavor…"
        className="mt-2 w-full rounded-2xl border border-[rgb(var(--gloss)/0.6)] bg-[rgb(var(--panel)/0.7)] p-3 text-sm leading-relaxed text-[rgb(var(--ink))] outline-none focus:ring-1 focus:ring-[rgb(var(--primary))] dark:border-[rgb(var(--gloss)/0.15)] dark:bg-[rgb(var(--panel)/0.2)]"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => save(isFavorite, comment)}
          disabled={pending || !commentDirty}
          className="rounded-full border border-[rgb(var(--gloss)/0.6)] bg-[linear-gradient(120deg,rgb(var(--primary-deep)),rgb(var(--primary)),rgb(var(--primary-bright)))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(var(--on-primary))] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50 dark:border-[rgb(var(--gloss)/0.1)]"
        >
          {pending ? 'Saving…' : commentDirty ? 'Save comment' : 'Saved'}
        </button>
        {error ? (
          <span className="text-xs text-[rgb(var(--accent-strong))]">{error}</span>
        ) : null}
      </div>
    </section>
  )
}
