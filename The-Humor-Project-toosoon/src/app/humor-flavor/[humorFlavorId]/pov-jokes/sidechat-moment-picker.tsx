'use client'

// Step 1 of the POV Joke Maker takes one or more typed moments. This picker
// fills those boxes from an archived Sidechat event clustering (the same
// archive that /sidechat-events writes and the reverse Batch Runner reads) so
// a moment can be a real happening with the students' own posts under it,
// not a headline typed from memory. Each moment's button toggles: add it as
// another box, or remove the box it filled. Which are picked is the parent's
// state, so the picker can be closed and reopened without losing track.
//
// It reuses the shared chunker in @/app/sidechat-topics/sidechat-moments.ts,
// so a moment picked here has exactly the text a reverse-surface moment has:
// event title, reaction group, then the loudest posts verbatim with upvotes.
// Loading an archive makes no model calls.
import { useEffect, useState } from 'react'

import {
  listClusteringsAction,
  loadClusteringAction,
  type SavedClusteringMeta,
} from '@/app/sidechat-topics/actions'
import {
  clusteringToMoments,
  groupMomentsByEvent,
  type SidechatMoment,
} from '@/app/sidechat-topics/sidechat-moments'

import { FIELD_HELP, SMALL_BUTTON } from './pov-jokes-ui'

const SELECT =
  'rounded-md border border-[rgb(var(--gloss)/0.6)] bg-transparent px-2 py-1.5 text-sm dark:border-[rgb(var(--gloss)/0.2)]'

type Loaded = {
  name: string
  postCount: number
  events: ReturnType<typeof groupMomentsByEvent>
}

export function SidechatMomentPicker({
  disabled,
  selectedTexts,
  onPick,
  onRemove,
}: {
  disabled?: boolean
  // The step-1 boxes as they stand; a moment whose text matches one is
  // shown as picked, with that box's number.
  selectedTexts: string[]
  // Adds the moment as another step-1 box.
  onPick: (moment: SidechatMoment) => void
  // Removes the box this moment filled.
  onRemove: (moment: SidechatMoment) => void
}) {
  const [archive, setArchive] = useState<SavedClusteringMeta[]>([])
  const [archiveId, setArchiveId] = useState('')
  const [archiveNote, setArchiveNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  // Box number (1-based) a moment's text sits in, or 0 when not picked.
  const boxOf = (text: string) => selectedTexts.findIndex((t) => t.trim() === text.trim()) + 1
  const pickedCount = selectedTexts.filter((t) => t.trim()).length

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await listClusteringsAction()
        if (cancelled) return
        if (res.ok === false) {
          setArchiveNote(res.error)
          return
        }
        setArchive(res.clusterings)
        setArchiveId(res.clusterings[0]?.id ?? '')
        if (res.tableMissing) {
          setArchiveNote('The sidechat_clusterings table has not been created yet, so there is nothing to load.')
        } else if (res.clusterings.length === 0) {
          setArchiveNote('No clustering has been archived yet.')
        }
      } catch (err) {
        if (!cancelled) setArchiveNote(err instanceof Error ? err.message : 'Could not list the archive.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const load = async (): Promise<void> => {
    if (!archiveId) return
    setLoading(true)
    setError(null)
    try {
      const res = await loadClusteringAction(archiveId)
      if (res.ok === false) {
        setError(res.error)
        return
      }
      const moments = clusteringToMoments(res.clusters)
      setLoaded({ name: res.name, postCount: res.postCount, events: groupMomentsByEvent(moments) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive load failed.')
    } finally {
      setLoading(false)
    }
  }

  const momentCount = loaded ? loaded.events.reduce((n, e) => n + e.moments.length, 0) : 0

  return (
    <div>
      <p className={FIELD_HELP}>
        Every clustering saved by the Sidechat Event Clusters tool is listed
        here. Loading one makes no model calls; pressing &ldquo;Use this
        moment&rdquo; fills the box above with the event, the reaction, and the
        students&rsquo; own posts.{' '}
        <a href="/sidechat-events" className="font-semibold text-[rgb(var(--accent-strong))] hover:underline">
          Run a fresh clustering on the Sidechat Event Clusters page
        </a>
        .
      </p>

      {archive.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-semibold">Archived clustering</span>
            <select
              value={archiveId}
              onChange={(e) => setArchiveId(e.target.value)}
              disabled={disabled || loading}
              className={`${SELECT} max-w-[22rem]`}
              aria-label="Archived Sidechat clustering to load"
            >
              {archive.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.windowDays} days · {a.postCount} posts
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={SMALL_BUTTON}
            disabled={disabled || loading || !archiveId}
            onClick={load}
          >
            {loading ? 'Loading the clustering…' : 'Load this clustering'}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-[rgb(var(--muted))]">
          {archiveNote ?? 'Listing the archive…'}
        </p>
      )}

      {error ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">Archive: {error}</p>
      ) : null}

      {loaded ? (
        <div className="mt-6">
          <p className="text-sm">
            <span className="font-semibold">&ldquo;{loaded.name}&rdquo;</span>{' '}
            <span className="text-[rgb(var(--muted))]">
              holds {loaded.postCount} posts, which became {momentCount}{' '}
              {momentCount === 1 ? 'moment' : 'moments'} across {loaded.events.length}{' '}
              {loaded.events.length === 1 ? 'event' : 'events'}. Loudest event first.
            </span>
          </p>

          <ol className="mt-5 space-y-8">
            {loaded.events.map((event, i) => (
              <li key={event.eventIndex} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3">
                <span className="text-2xl font-semibold leading-none text-[rgb(var(--muted))]">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h4 className="text-base font-semibold leading-snug">{event.eventTitle}</h4>
                  <ul className="mt-3 space-y-4">
                    {event.moments.map((m) => {
                      const box = boxOf(m.text)
                      const picked = box > 0
                      return (
                        <li key={m.key} className="rounded-lg bg-[rgb(var(--panel)/0.7)] p-4 dark:bg-[rgb(var(--panel)/0.35)]">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold leading-snug">
                                {m.reaction ?? 'The whole event, no reaction groups'}
                                {m.reactionWord ? (
                                  <span className="font-normal text-[rgb(var(--muted))]">
                                    {' '}
                                    — students are {m.reactionWord}
                                  </span>
                                ) : null}
                              </p>
                              <p className={FIELD_HELP}>
                                {m.postCount} {m.postCount === 1 ? 'post' : 'posts'}, {m.totalLikes} upvotes in total
                              </p>
                            </div>
                            <button
                              type="button"
                              className={SMALL_BUTTON}
                              disabled={disabled}
                              onClick={() => (picked ? onRemove(m) : onPick(m))}
                            >
                              {picked
                                ? `Remove — it is moment ${box} above`
                                : pickedCount
                                  ? 'Add this as another moment'
                                  : 'Use this moment'}
                            </button>
                          </div>
                          <p className="mt-3 text-xs leading-relaxed text-[rgb(var(--muted))]">{m.text}</p>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}
