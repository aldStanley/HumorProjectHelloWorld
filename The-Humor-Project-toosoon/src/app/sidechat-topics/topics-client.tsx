'use client'

// Two grouping modes, visible up top:
//   Brain topics   — the brain's own clusters (same retrieval as
//                    ${studentBrainOutput}), posts assigned under them.
//   Event clusters — bottom-up from the raw posts: nominate the specific
//                    event behind each post, merge only same-event lines,
//                    force-split anything that still reads as a list.
// Everything runs server-side in one action call per run.

import { useCallback, useEffect, useState } from 'react'

import {
  clusterEventsAction,
  listClusteringsAction,
  loadClusteringAction,
  mapPostsToTopicsAction,
  saveClusteringAction,
  type SavedClusteringMeta,
  type TopicGroup,
} from './actions'
import type { EventCluster, SidechatPost } from './event-clustering'

// 7 days is the ask; posts come live from the Brain API, and the wider
// windows are for looking further back.
const WINDOW_CHOICES = [3, 7, 30, 90] as const

type Mode = 'events' | 'brain'

type DoneMeta = {
  postCount: number
  windowStart: string
  newestPostAt: string | null
  windowDays: number
}

type LoadState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; error: string }
  | ({ status: 'done'; mode: 'brain'; groups: TopicGroup[]; unmatched: SidechatPost[] } & DoneMeta)
  | ({
      status: 'done'
      mode: 'events'
      clusters: EventCluster[]
      oneOffs: SidechatPost[]
      // set when this result came from a saved clustering instead of a fresh run
      loadedFrom?: string
    } & DoneMeta)

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; name: string }
  | { status: 'error'; error: string }

const shortDate = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function PostRow({ post }: { post: SidechatPost }) {
  return (
    <li className="flex items-baseline gap-3 border-t border-[rgb(var(--gloss)/0.4)] py-2 first:border-t-0 dark:border-[rgb(var(--gloss)/0.1)]">
      <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-[rgb(var(--accent-strong))]">
        ▲ {post.likeCount}
      </span>
      <span className="w-14 shrink-0 text-xs tabular-nums text-[rgb(var(--muted))]">
        {shortDate(post.postedAt)}
      </span>
      <span className="text-sm">{post.content}</span>
    </li>
  )
}

function LeftoverSection({ title, note, posts }: { title: string; note: string; posts: SidechatPost[] }) {
  if (posts.length === 0) return null
  return (
    <section className="rounded-xl border border-dashed border-[rgb(var(--gloss)/0.6)] p-4 dark:border-[rgb(var(--gloss)/0.15)]">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold text-[rgb(var(--muted))]">{title}</h2>
        <span className="text-xs text-[rgb(var(--muted))]">
          {posts.length} post{posts.length === 1 ? '' : 's'} — {note}
        </span>
      </div>
      <ul className="mt-3">
        {posts.map((p) => (
          <PostRow key={p.id} post={p} />
        ))}
      </ul>
    </section>
  )
}

export default function SidechatTopicsClient() {
  const [state, setState] = useState<LoadState>({ status: 'idle' })
  const [mode, setMode] = useState<Mode>('events')
  const [windowDays, setWindowDays] = useState<number>(7)
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })
  const [saved, setSaved] = useState<SavedClusteringMeta[]>([])
  const busy = state.status === 'running'

  const refreshSaved = useCallback(async () => {
    try {
      const result = await listClusteringsAction()
      if (result.ok) setSaved(result.clusterings)
    } catch {
      /* list is best-effort — the page works without it */
    }
  }, [])
  useEffect(() => {
    void refreshSaved()
  }, [refreshSaved])

  const run = async () => {
    setState({ status: 'running' })
    setSaveState({ status: 'idle' })
    try {
      if (mode === 'brain') {
        const result = await mapPostsToTopicsAction(windowDays)
        if (result.ok === false) {
          setState({ status: 'error', error: result.error })
          return
        }
        setState({
          status: 'done',
          mode: 'brain',
          groups: result.groups,
          unmatched: result.unmatched,
          postCount: result.postCount,
          windowStart: result.windowStart,
          newestPostAt: result.newestPostAt,
          windowDays,
        })
      } else {
        const result = await clusterEventsAction(windowDays)
        if (result.ok === false) {
          setState({ status: 'error', error: result.error })
          return
        }
        setState({
          status: 'done',
          mode: 'events',
          clusters: result.clusters,
          oneOffs: result.oneOffs,
          postCount: result.postCount,
          windowStart: result.windowStart,
          newestPostAt: result.newestPostAt,
          windowDays,
        })
      }
    } catch (err) {
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to load.',
      })
    }
  }

  const save = async () => {
    if (state.status !== 'done' || state.mode !== 'events') return
    setSaveState({ status: 'saving' })
    try {
      const result = await saveClusteringAction({
        windowDays: state.windowDays,
        windowStart: state.windowStart,
        postCount: state.postCount,
        clusters: state.clusters,
        oneOffs: state.oneOffs,
        newestPostAt: state.newestPostAt,
      })
      if (result.ok === false) {
        setSaveState({ status: 'error', error: result.error })
        return
      }
      setSaveState({ status: 'saved', name: result.saved.name })
      void refreshSaved()
    } catch (err) {
      setSaveState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Save failed.',
      })
    }
  }

  const loadSaved = async (meta: SavedClusteringMeta) => {
    setState({ status: 'running' })
    setSaveState({ status: 'idle' })
    try {
      const result = await loadClusteringAction(meta.id)
      if (result.ok === false) {
        setState({ status: 'error', error: result.error })
        return
      }
      setMode('events')
      setState({
        status: 'done',
        mode: 'events',
        clusters: result.clusters,
        oneOffs: result.oneOffs,
        postCount: result.postCount,
        windowStart: result.windowStart,
        newestPostAt: result.newestPostAt,
        windowDays: result.windowDays,
        loadedFrom: result.name,
      })
    } catch (err) {
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Load failed.',
      })
    }
  }

  const modeButton = (value: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      disabled={busy}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50 ${
        mode === value
          ? 'bg-[rgb(var(--accent-strong))] text-white'
          : 'border border-[rgb(var(--gloss)/0.6)] text-[rgb(var(--muted))] hover:brightness-110 dark:border-[rgb(var(--gloss)/0.15)]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {modeButton('events', 'Event clusters')}
          {modeButton('brain', 'Brain topics')}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="rounded-md bg-[rgb(var(--accent-strong))] px-4 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          title={
            mode === 'events'
              ? 'Nominate the event behind each post, merge same-event lines, split lumps'
              : "Fetch the brain's topics + recent Sidechat posts, then group"
          }
        >
          {busy ? 'Fetching & grouping…' : `▶ Fetch & group last ${windowDays} days`}
        </button>
        <label className="text-sm text-[rgb(var(--muted))]">
          Window:{' '}
          <select
            className="rounded-md border border-[rgb(var(--gloss)/0.6)] bg-transparent px-2 py-1 text-sm dark:border-[rgb(var(--gloss)/0.15)]"
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            disabled={busy}
          >
            {WINDOW_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
        {busy ? (
          <span className="text-sm text-[rgb(var(--muted))]">
            {mode === 'events'
              ? 'Nominate → consolidate → split takes a couple of minutes on a big window.'
              : 'Topics + posts fetch fast; the grouping pass takes ~30–60s.'}
          </span>
        ) : null}
        {state.status === 'done' ? (
          <span className="text-sm text-[rgb(var(--muted))]">
            {state.postCount} posts since {shortDate(state.windowStart)}
            {state.mode === 'events'
              ? ` · ${state.clusters.filter((c) => c.posts.length > 1).length} multi-post events · ${state.oneOffs.length} one-offs`
              : ` · ${state.groups.filter((g) => g.posts.length > 0).length} topics with posts · ${state.unmatched.length} unmatched`}
          </span>
        ) : null}
        {state.status === 'done' && state.mode === 'events' && !state.loadedFrom ? (
          <button
            type="button"
            onClick={save}
            disabled={saveState.status === 'saving' || saveState.status === 'saved'}
            className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-3 py-1.5 text-sm font-semibold text-[rgb(var(--accent-strong))] transition hover:brightness-110 disabled:opacity-50 dark:border-[rgb(var(--gloss)/0.15)]"
            title="Save this clustering (named with the run time and your username)"
          >
            {saveState.status === 'saving'
              ? 'Saving…'
              : saveState.status === 'saved'
                ? '✓ Saved'
                : '💾 Save this clustering'}
          </button>
        ) : null}
        {saveState.status === 'saved' ? (
          <span className="text-sm text-[rgb(var(--muted))]">Saved as “{saveState.name}”</span>
        ) : null}
        {saveState.status === 'error' ? (
          <span className="text-sm text-red-600 dark:text-red-400">{saveState.error}</span>
        ) : null}
      </div>

      {saved.length > 0 ? (
        <section className="rounded-xl border border-[rgb(var(--gloss)/0.6)] p-4 dark:border-[rgb(var(--gloss)/0.15)]">
          <h2 className="text-sm font-semibold text-[rgb(var(--muted))]">Saved clusterings</h2>
          <ul className="mt-2">
            {saved.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[rgb(var(--gloss)/0.4)] py-1.5 first:border-t-0 dark:border-[rgb(var(--gloss)/0.1)]"
              >
                <button
                  type="button"
                  onClick={() => loadSaved(s)}
                  disabled={busy}
                  className="text-sm font-semibold text-[rgb(var(--accent-strong))] transition hover:brightness-110 disabled:opacity-50"
                >
                  {s.name}
                </button>
                <span className="text-xs text-[rgb(var(--muted))]">
                  {s.windowDays}-day window · {s.postCount} posts
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {state.status === 'error' ? (
        <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      ) : null}

      {state.status === 'done' && state.postCount === 0 ? (
        <p className="rounded-md border border-[rgb(var(--gloss)/0.6)] px-3 py-2 text-sm text-[rgb(var(--muted))] dark:border-[rgb(var(--gloss)/0.15)]">
          No Sidechat posts in this window — the newest post in this database is from{' '}
          {state.newestPostAt ? shortDate(state.newestPostAt) : 'unknown'}. Widen the window,
          or note the scraper may not be running against this environment.
        </p>
      ) : null}

      {state.status === 'done' && state.postCount > 0 && state.mode === 'events' ? (
        <div className="space-y-4">
          {state.loadedFrom ? (
            <p className="text-xs text-[rgb(var(--muted))]">
              Loaded saved clustering “{state.loadedFrom}” — no LLM calls were re-run.
            </p>
          ) : null}
          {state.clusters
            .filter((c) => c.posts.length > 1)
            .map((cluster, i) => (
              <section
                key={`${cluster.title}-${i}`}
                className="rounded-xl border border-[rgb(var(--gloss)/0.6)] p-4 dark:border-[rgb(var(--gloss)/0.15)]"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-base font-semibold">
                    <span className="mr-2 text-[rgb(var(--muted))]">{i + 1}.</span>
                    {cluster.title}
                  </h2>
                  <span className="text-xs text-[rgb(var(--muted))]">
                    ▲ {cluster.totalLikes} total · {cluster.posts.length} posts
                  </span>
                </div>
                <ul className="mt-3">
                  {cluster.posts.map((p) => (
                    <PostRow key={p.id} post={p} />
                  ))}
                </ul>
              </section>
            ))}

          {state.clusters.some((c) => c.posts.length === 1) ? (
            <section className="rounded-xl border border-[rgb(var(--gloss)/0.6)] p-4 dark:border-[rgb(var(--gloss)/0.15)]">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-base font-semibold text-[rgb(var(--muted))]">
                  Single-post events
                </h2>
                <span className="text-xs text-[rgb(var(--muted))]">
                  a real happening, but only one post mentioned it
                </span>
              </div>
              <ul className="mt-3">
                {state.clusters
                  .filter((c) => c.posts.length === 1)
                  .map((c, i) => (
                    <li
                      key={`${c.title}-single-${i}`}
                      className="border-t border-[rgb(var(--gloss)/0.4)] py-2 first:border-t-0 dark:border-[rgb(var(--gloss)/0.1)]"
                    >
                      <p className="text-xs font-semibold text-[rgb(var(--muted))]">{c.title}</p>
                      <div className="mt-1 flex items-baseline gap-3">
                        <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums text-[rgb(var(--accent-strong))]">
                          ▲ {c.posts[0].likeCount}
                        </span>
                        <span className="w-14 shrink-0 text-xs tabular-nums text-[rgb(var(--muted))]">
                          {shortDate(c.posts[0].postedAt)}
                        </span>
                        <span className="text-sm">{c.posts[0].content}</span>
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}

          <LeftoverSection
            title="No event (vibes & one-offs)"
            note="pure vibes, memes, or personal posts with no shared happening behind them"
            posts={state.oneOffs}
          />
        </div>
      ) : null}

      {state.status === 'done' && state.postCount > 0 && state.mode === 'brain' ? (
        <div className="space-y-4">
          {[...state.groups]
            .sort((a, b) => b.posts.length - a.posts.length || a.topic.rank - b.topic.rank)
            .map((group, i) => (
              <section
                key={group.topic.topicId}
                className={`rounded-xl border border-[rgb(var(--gloss)/0.6)] p-4 dark:border-[rgb(var(--gloss)/0.15)] ${
                  group.posts.length === 0 ? 'opacity-50' : ''
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-base font-semibold">
                    <span className="mr-2 text-[rgb(var(--muted))]">{i + 1}.</span>
                    {group.topic.title}
                  </h2>
                  <span className="text-xs text-[rgb(var(--muted))]">
                    brain rank #{group.topic.rank}
                    {group.topic.primaryEmotion ? ` · ${group.topic.primaryEmotion}` : ''}
                    {' · '}
                    {group.posts.length} post{group.posts.length === 1 ? '' : 's'}
                  </span>
                </div>
                {group.topic.summary ? (
                  <p className="mt-1 text-xs text-[rgb(var(--muted))]">{group.topic.summary}</p>
                ) : null}
                {group.posts.length > 0 ? (
                  <ul className="mt-3">
                    {group.posts.map((p) => (
                      <PostRow key={p.id} post={p} />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs italic text-[rgb(var(--muted))]">
                    No posts in this window matched this topic.
                  </p>
                )}
              </section>
            ))}

          <LeftoverSection
            title="Unmatched posts"
            note="fit none of the brain's topics"
            posts={state.unmatched}
          />
        </div>
      ) : null}
    </div>
  )
}
