'use client'

// Sidechat Event Clusters: fetch the last N days of posts, cluster them by the
// specific event behind each one, and read the result as a ranked report with
// a nested sidebar. The clustering itself is the shared pipeline in
// ../sidechat-topics/event-clustering.ts, reached through the same server
// actions the Sidechat topics page uses. Design rationale:
// ./sidechat-events-rationale.md

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  clusterEventsAction,
  listClusteringsAction,
  loadClusteringAction,
  saveClusteringAction,
  type SavedClusteringMeta,
} from '../sidechat-topics/actions'
import {
  SUBCLUSTER_MIN_POSTS,
  type EventCluster,
  type EventSubcluster,
  type SidechatPost,
} from '../sidechat-topics/event-clustering'

const WINDOW_CHOICES = [3, 7, 14, 30] as const
const ONE_OFFS_SHOWN = 40

type Result = {
  clusters: EventCluster[]
  oneOffs: SidechatPost[]
  postCount: number
  windowStart: string
  newestPostAt: string | null
  windowDays: number
  // set when the result came from a saved clustering instead of a fresh run
  loadedFrom?: string
}

type LoadState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; error: string }
  | ({ status: 'done' } & Result)

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; name: string }
  | { status: 'error'; error: string }

const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return '?'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '?'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const dateRange = (posts: SidechatPost[]): string => {
  const times = posts
    .map((p) => new Date(p.postedAt).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b)
  if (times.length === 0) return ''
  const a = shortDate(new Date(times[0]).toISOString())
  const b = shortDate(new Date(times[times.length - 1]).toISOString())
  return a === b ? a : `${a} – ${b}`
}

const SECTION_IDS = {
  overview: 'overview',
  multi: 'multi',
  single: 'single',
  oneOffs: 'oneoffs',
} as const

const SECTION_TITLES = {
  overview: 'What this clustering covers',
  multi: 'Events students posted about more than once',
  single: 'Events named by a single post',
  oneOffs: 'Posts with no shared event behind them',
} as const

function PostRow({ post }: { post: SidechatPost }) {
  return (
    <li className="grid grid-cols-[52px_minmax(0,1fr)_56px] gap-3 border-t border-[rgb(var(--gloss)/0.4)] py-2 first:border-t-0 dark:border-[rgb(var(--gloss)/0.1)]">
      <span className="text-right text-sm font-semibold tabular-nums text-[rgb(var(--muted))]">
        {post.likeCount}
      </span>
      <span className="whitespace-pre-line text-sm [overflow-wrap:anywhere]">{post.content}</span>
      <span className="pt-0.5 text-right text-xs tabular-nums text-[rgb(var(--muted))]">
        {shortDate(post.postedAt)}
      </span>
    </li>
  )
}

// One reaction group inside an event: what students are doing or feeling,
// the reaction word, the posts that share it.
function SubclusterBlock({ sub }: { sub: EventSubcluster }) {
  return (
    <section className="mt-6 first:mt-2">
      <h4 className="text-base font-semibold leading-tight [text-wrap:balance]">{sub.name}</h4>
      <p className="mt-0.5 mb-1.5 text-[12.5px] tabular-nums text-[rgb(var(--muted))]">
        {sub.reaction ? <>reaction: {sub.reaction} · </> : null}
        {sub.posts.length} posts · {sub.totalLikes} upvotes
      </p>
      <ol>
        {sub.posts.map((p) => (
          <PostRow key={p.id} post={p} />
        ))}
      </ol>
    </section>
  )
}

function ClusterBlock({
  id,
  rank,
  cluster,
  compact,
}: {
  id: string
  rank: number
  cluster: EventCluster
  compact: boolean
}) {
  const subclusters = !compact && cluster.subclusters && cluster.subclusters.length > 0 ? cluster.subclusters : null
  return (
    <article
      id={id}
      data-spy
      className={`grid grid-cols-[56px_minmax(0,1fr)] gap-2 scroll-mt-6 ${compact ? 'mb-8' : 'mb-12'}`}
    >
      <div
        className={`pr-3 text-right tabular-nums leading-none text-[rgb(var(--muted))] ${
          compact ? 'pt-1 text-xl' : 'pt-1 text-3xl'
        }`}
      >
        {rank}
      </div>
      <div className="min-w-0">
        <h3 className={`font-semibold leading-tight [text-wrap:balance] ${compact ? 'text-lg' : 'text-2xl'}`}>
          {cluster.title}
        </h3>
        {!compact ? (
          <p className="mt-1 mb-3 text-[13px] tabular-nums text-[rgb(var(--muted))]">
            {cluster.posts.length} posts · {cluster.totalLikes} upvotes total · posted{' '}
            {dateRange(cluster.posts)}
            {subclusters ? ` · ${subclusters.length} reactions` : ''}
          </p>
        ) : null}
        {subclusters ? (
          subclusters.map((s, i) => <SubclusterBlock key={`${s.name}-${i}`} sub={s} />)
        ) : (
          <ol>
            {cluster.posts.map((p) => (
              <PostRow key={p.id} post={p} />
            ))}
          </ol>
        )}
      </div>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Sidebar navigation: sections at the top level, every event beneath its
// section. The chevron alone toggles a branch; clicking a label navigates
// (and opens its branch). Scrollspy opens a branch only when the section
// being read changes, so a manual collapse sticks while scrolling.
// ---------------------------------------------------------------------------

type NavLeaf = { id: string; label: string; status: string }
type NavBranch = NavLeaf & { kids: NavLeaf[] }
type NavItem = NavLeaf | NavBranch

const isBranch = (n: NavItem): n is NavBranch => 'kids' in n

function SideNav({
  items,
  activeId,
  open,
  onToggle,
  onNavigate,
}: {
  items: NavItem[]
  activeId: string | null
  open: Set<string>
  onToggle: (id: string) => void
  onNavigate: (id: string) => void
}) {
  const navRef = useRef<HTMLElement>(null)

  // Keep the active entry in view inside the nav's own scroll area.
  useEffect(() => {
    if (!activeId || !navRef.current) return
    const el = navRef.current.querySelector<HTMLElement>(`[data-nav="${activeId}"]`)
    if (!el) return
    const r = el.getBoundingClientRect()
    const n = navRef.current.getBoundingClientRect()
    if (r.top < n.top || r.bottom > n.bottom) el.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  const link = (n: NavLeaf, depth: 0 | 1) => (
    <a
      href={`#${n.id}`}
      data-nav={n.id}
      onClick={() => onNavigate(n.id)}
      className={`flex min-w-0 flex-1 flex-col rounded px-1.5 py-1 transition hover:bg-[rgb(var(--panel)/0.8)] dark:hover:bg-[rgb(var(--panel)/0.15)] ${
        activeId === n.id ? 'bg-[rgb(var(--panel)/0.8)] text-[rgb(var(--accent-strong))] dark:bg-[rgb(var(--panel)/0.15)]' : 'text-[rgb(var(--ink))]'
      }`}
    >
      <span className={depth === 0 ? 'text-[13px] font-semibold' : 'truncate text-[12.5px]'}>
        {n.label}
      </span>
      <span className="text-[11px] tabular-nums text-[rgb(var(--muted))]">{n.status}</span>
    </a>
  )

  return (
    <nav
      ref={navRef}
      aria-label="Clustering contents"
      className="sticky top-6 hidden max-h-[calc(100vh-3rem)] self-start overflow-y-auto pr-2 lg:block"
    >
      <ul className="space-y-1.5">
        {items.map((n) => {
          const opened = isBranch(n) && open.has(n.id)
          return (
            <li key={n.id}>
              <div className="flex items-start gap-1">
                {isBranch(n) ? (
                  <button
                    type="button"
                    aria-label={opened ? 'Collapse list' : 'Expand list'}
                    aria-expanded={opened}
                    onClick={() => onToggle(n.id)}
                    className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[rgb(var(--muted))] hover:bg-[rgb(var(--panel)/0.8)] dark:hover:bg-[rgb(var(--panel)/0.15)]"
                  >
                    <span
                      className={`inline-block transition-transform motion-reduce:transition-none ${opened ? 'rotate-90' : ''}`}
                      aria-hidden
                    >
                      ›
                    </span>
                  </button>
                ) : (
                  <span className="h-5 w-5 shrink-0" aria-hidden />
                )}
                {link(n, 0)}
              </div>
              {isBranch(n) && opened ? (
                <ul className="ml-[22px] mt-0.5 border-l border-[rgb(var(--gloss)/0.5)] pl-1.5 dark:border-[rgb(var(--gloss)/0.15)]">
                  {n.kids.map((k) => (
                    <li key={k.id}>{link(k, 1)}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default function SidechatEventsClient() {
  const [state, setState] = useState<LoadState>({ status: 'idle' })
  const [windowDays, setWindowDays] = useState<number>(7)
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' })
  const [saved, setSaved] = useState<SavedClusteringMeta[]>([])
  // Why the archive list is empty, when it is: still loading, the archive table
  // does not exist yet (migration not run), or the list call itself failed.
  const [archiveStatus, setArchiveStatus] = useState<
    { status: 'loading' } | { status: 'ready' } | { status: 'table-missing' } | { status: 'error'; error: string }
  >({ status: 'loading' })
  const [showAllOneOffs, setShowAllOneOffs] = useState(false)
  const busy = state.status === 'running'

  const refreshSaved = useCallback(async () => {
    try {
      const result = await listClusteringsAction()
      if (result.ok === false) {
        setArchiveStatus({ status: 'error', error: result.error })
        return
      }
      setSaved(result.clusterings)
      setArchiveStatus(result.tableMissing ? { status: 'table-missing' } : { status: 'ready' })
    } catch (err) {
      setArchiveStatus({
        status: 'error',
        error: err instanceof Error ? err.message : 'Could not list the archived clusterings.',
      })
    }
  }, [])
  useEffect(() => {
    void refreshSaved()
  }, [refreshSaved])

  const run = async () => {
    setState({ status: 'running' })
    setSaveState({ status: 'idle' })
    setShowAllOneOffs(false)
    try {
      const result = await clusterEventsAction(windowDays)
      if (result.ok === false) {
        setState({ status: 'error', error: result.error })
        return
      }
      setState({ status: 'done', ...result, windowDays })
      // Every fresh run is archived automatically: a run costs minutes, and
      // an archived clustering opens instantly here and in the Batch Runner.
      if (result.postCount > 0) void archive({ ...result, windowDays })
    } catch (err) {
      setState({ status: 'error', error: err instanceof Error ? err.message : 'Failed to load.' })
    }
  }

  const archive = async (r: Result) => {
    setSaveState({ status: 'saving' })
    try {
      const result = await saveClusteringAction({
        windowDays: r.windowDays,
        windowStart: r.windowStart,
        postCount: r.postCount,
        clusters: r.clusters,
        oneOffs: r.oneOffs,
        newestPostAt: r.newestPostAt,
      })
      if (result.ok === false) {
        setSaveState({ status: 'error', error: result.error })
        return
      }
      setSaveState({ status: 'saved', name: result.saved.name })
      void refreshSaved()
    } catch (err) {
      setSaveState({ status: 'error', error: err instanceof Error ? err.message : 'Archiving failed.' })
    }
  }

  const loadSaved = async (meta: SavedClusteringMeta) => {
    setState({ status: 'running' })
    setSaveState({ status: 'idle' })
    setShowAllOneOffs(false)
    try {
      const result = await loadClusteringAction(meta.id)
      if (result.ok === false) {
        setState({ status: 'error', error: result.error })
        return
      }
      setState({
        status: 'done',
        clusters: result.clusters,
        oneOffs: result.oneOffs,
        postCount: result.postCount,
        windowStart: result.windowStart,
        newestPostAt: result.newestPostAt,
        windowDays: result.windowDays,
        loadedFrom: result.name,
      })
    } catch (err) {
      setState({ status: 'error', error: err instanceof Error ? err.message : 'Load failed.' })
    }
  }

  // Result partition: shared events / single-post events / one-offs.
  const parts = useMemo(() => {
    if (state.status !== 'done') return null
    const multi = state.clusters.filter((c) => c.posts.length >= 2)
    const single = state.clusters.filter((c) => c.posts.length === 1)
    return { multi, single, oneOffs: state.oneOffs }
  }, [state])

  const navItems = useMemo<NavItem[]>(() => {
    if (!parts || state.status !== 'done') return []
    const multiPosts = parts.multi.reduce((n, c) => n + c.posts.length, 0)
    return [
      { id: SECTION_IDS.overview, label: SECTION_TITLES.overview, status: `${state.postCount} posts` },
      {
        id: SECTION_IDS.multi,
        label: SECTION_TITLES.multi,
        status: `${parts.multi.length} events · ${multiPosts} posts`,
        kids: parts.multi.map((c, i) => ({
          id: `e${i + 1}`,
          label: c.title,
          status: `${c.posts.length} posts · ${c.totalLikes} upvotes`,
        })),
      },
      {
        id: SECTION_IDS.single,
        label: SECTION_TITLES.single,
        status: `${parts.single.length} events`,
        kids: parts.single.map((c, i) => ({
          id: `s${i + 1}`,
          label: c.title,
          status: `${c.totalLikes} upvotes`,
        })),
      },
      { id: SECTION_IDS.oneOffs, label: SECTION_TITLES.oneOffs, status: `${parts.oneOffs.length} posts` },
    ]
  }, [parts, state])

  // Sidebar open/active state. The shared-events branch starts open; the
  // single-post branch (often 100+ entries) starts closed.
  const [open, setOpen] = useState<Set<string>>(() => new Set([SECTION_IDS.multi]))
  const [activeId, setActiveId] = useState<string | null>(null)
  const lastSectionRef = useRef<string | null>(null)
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const openBranch = (id: string) =>
    setOpen((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  const sectionOf = (id: string): string =>
    id.startsWith('e') && /^e\d+$/.test(id)
      ? SECTION_IDS.multi
      : /^s\d+$/.test(id)
        ? SECTION_IDS.single
        : id
  const navigate = (id: string) => {
    const sec = sectionOf(id)
    if (sec === SECTION_IDS.multi || sec === SECTION_IDS.single) openBranch(sec)
  }

  useEffect(() => {
    if (state.status !== 'done') return
    const onScroll = () => {
      const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-spy]'))
      const y = window.scrollY + 90
      let best: HTMLElement | null = null
      for (const t of targets) {
        if (t.offsetTop <= y) best = t
        else break
      }
      const id = (best ?? targets[0])?.id ?? null
      if (!id) return
      setActiveId(id)
      const sec = sectionOf(id)
      if (sec !== lastSectionRef.current) {
        lastSectionRef.current = sec
        if (sec === SECTION_IDS.multi || sec === SECTION_IDS.single) openBranch(sec)
      }
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [state.status])

  const card = 'rounded-2xl bg-[rgb(var(--panel)/0.6)] p-6 dark:bg-[rgb(var(--panel)/0.25)]'

  return (
    <div className="space-y-10">
      {/* 1 — fetch and cluster */}
      <section className={card}>
        <h2 className="text-lg font-semibold">1. Fetch the recent posts and cluster them by event</h2>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-[rgb(var(--muted))]">
          <li>Pick how many days back to look. Seven days is about 650 posts and takes two to three minutes.</li>
          <li>Every fresh run is archived automatically. Opening an archived clustering is instant and makes no model calls.</li>
          <li>
            Inside any event with {SUBCLUSTER_MIN_POSTS} or more posts, the posts are grouped again by the
            reaction students are having (fury, shopping for the easier professor, waitlist dread), never by subject.
          </li>
        </ul>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="rounded-lg bg-[rgb(var(--accent-strong))] px-6 py-3 text-base font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? 'Fetching and clustering…' : `▶ Fetch the last ${windowDays} days and cluster by event`}
          </button>
          <label className="text-sm text-[rgb(var(--muted))]">
            Days back:{' '}
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
              Naming the event behind each post, merging same-event names, then splitting any lumps.
            </span>
          ) : null}
        </div>

        {state.status === 'done' ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-[rgb(var(--muted))]">
              {state.loadedFrom
                ? `Loaded “${state.loadedFrom}”: `
                : 'Fresh run: '}
              {state.postCount} posts from {shortDate(state.windowStart)} to {shortDate(state.newestPostAt)}.
            </span>
            {saveState.status === 'saving' ? (
              <span className="text-[rgb(var(--muted))]">Archiving…</span>
            ) : null}
            {saveState.status === 'saved' ? (
              <span className="text-[rgb(var(--muted))]">Archived as “{saveState.name}”.</span>
            ) : null}
            {saveState.status === 'error' ? (
              <span className="text-red-600 dark:text-red-400">Not archived: {saveState.error}</span>
            ) : null}
          </div>
        ) : null}

        {state.status === 'error' ? (
          <p className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {state.error}
          </p>
        ) : null}

        <div className="mt-6">
          <h3 className="text-sm font-semibold">
            Archived clusterings{archiveStatus.status === 'ready' ? ` (${saved.length})` : ''}
          </h3>
          <p className="mt-0.5 text-xs text-[rgb(var(--muted))]">
            Every fresh run on this page or on Sidechat topics is saved here. Opening one is instant and makes no model calls.
          </p>
          {archiveStatus.status === 'loading' ? (
            <p className="mt-2 text-sm text-[rgb(var(--muted))]">Loading the archive…</p>
          ) : null}
          {archiveStatus.status === 'table-missing' ? (
            <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Nothing can be archived yet: the <code>sidechat_clusterings</code> table does not exist in this
              database. Run <code>supabase/migrations/20260812000000_sidechat_clusterings.sql</code> in the
              Supabase SQL editor, then reload this page.
            </p>
          ) : null}
          {archiveStatus.status === 'error' ? (
            <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              Could not list the archive: {archiveStatus.error}
            </p>
          ) : null}
          {archiveStatus.status === 'ready' && saved.length === 0 ? (
            <p className="mt-2 text-sm text-[rgb(var(--muted))]">No archived clusterings yet. Run a fresh clustering above and it will appear here.</p>
          ) : null}
          {saved.length > 0 ? (
            <ul className="mt-1">
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
                    {s.windowDays}-day window · {s.postCount} posts · saved {shortDate(s.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      {/* 2 — read the events */}
      {state.status === 'done' && parts ? (
        state.postCount === 0 ? (
          <section className={card}>
            <h2 className="text-lg font-semibold">2. Read the events</h2>
            <p className="mt-2 text-sm text-[rgb(var(--muted))]">
              No Sidechat posts in this window. The newest post in the feed is from{' '}
              {shortDate(state.newestPostAt)}.
            </p>
          </section>
        ) : (
          <section className="lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-12">
            <SideNav
              items={navItems}
              activeId={activeId}
              open={open}
              onToggle={toggle}
              onNavigate={navigate}
            />
            <div className="min-w-0 max-w-[72ch]">
              <h2 className="text-lg font-semibold">2. Read the events</h2>

              <section id={SECTION_IDS.overview} data-spy className="mt-6 scroll-mt-6 mb-14">
                <h3 className="text-2xl font-semibold [text-wrap:balance]">{SECTION_TITLES.overview}</h3>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
                  <li>
                    <b>{state.postCount} posts</b> from the Student Brain feed, {shortDate(state.windowStart)} through{' '}
                    {shortDate(state.newestPostAt)}, a {state.windowDays}-day window.
                  </li>
                  <li>
                    <b>{parts.multi.length} events</b> drew two or more posts. They are listed first, ranked by
                    total upvotes, with every post under them.
                  </li>
                  <li>
                    <b>{parts.single.length} events</b> were named by only one post, and{' '}
                    <b>{parts.oneOffs.length} posts</b> had no shared event behind them.
                  </li>
                  <li>
                    <b>{parts.multi.filter((c) => c.subclusters && c.subclusters.length > 0).length} events</b> had
                    enough posts to be split further by the reaction students had to them. Those reaction groups
                    are the subheadings inside an event; “Other reactions” holds posts that matched no group.
                    Archives made before this pass show events without reaction groups.
                  </li>
                  <li>
                    The number before each post is its upvote count. Negative counts are real: downvoted posts.
                  </li>
                </ul>
              </section>

              <section id={SECTION_IDS.multi} data-spy className="scroll-mt-6 mb-16">
                <h3 className="text-2xl font-semibold [text-wrap:balance]">{SECTION_TITLES.multi}</h3>
                <p className="mt-2 mb-8 text-sm text-[rgb(var(--muted))]">
                  These happenings got more than one post, so they are the safest bets for a moment the
                  campus actually shared. Ranked by total upvotes across the posts in each event.
                </p>
                {parts.multi.length === 0 ? (
                  <p className="text-sm text-[rgb(var(--muted))]">No event drew more than one post in this window.</p>
                ) : null}
                {parts.multi.map((c, i) => (
                  <ClusterBlock key={`e${i}`} id={`e${i + 1}`} rank={i + 1} cluster={c} compact={false} />
                ))}
              </section>

              <section id={SECTION_IDS.single} data-spy className="scroll-mt-6 mb-16">
                <h3 className="text-2xl font-semibold [text-wrap:balance]">{SECTION_TITLES.single}</h3>
                <p className="mt-2 mb-8 text-sm text-[rgb(var(--muted))]">
                  Each of these is a specific happening only one post mentioned. Some are real events with
                  one loud post; others are the model reading an event into a post that may not carry one.
                  Ranked by upvotes.
                </p>
                {parts.single.map((c, i) => (
                  <ClusterBlock key={`s${i}`} id={`s${i + 1}`} rank={i + 1} cluster={c} compact />
                ))}
              </section>

              <section id={SECTION_IDS.oneOffs} data-spy className="scroll-mt-6">
                <h3 className="text-2xl font-semibold [text-wrap:balance]">{SECTION_TITLES.oneOffs}</h3>
                <p className="mt-2 mb-6 text-sm text-[rgb(var(--muted))]">
                  Posts the grouping left alone: pure vibes, memes, and personal moments with no campus
                  occurrence to file them under. Most upvoted first.
                </p>
                <ol>
                  {(showAllOneOffs ? parts.oneOffs : parts.oneOffs.slice(0, ONE_OFFS_SHOWN)).map((p) => (
                    <PostRow key={p.id} post={p} />
                  ))}
                </ol>
                {!showAllOneOffs && parts.oneOffs.length > ONE_OFFS_SHOWN ? (
                  <button
                    type="button"
                    onClick={() => setShowAllOneOffs(true)}
                    className="mt-4 text-sm font-semibold text-[rgb(var(--accent-strong))] hover:underline"
                  >
                    Show the remaining {parts.oneOffs.length - ONE_OFFS_SHOWN} one-off posts
                  </button>
                ) : null}
              </section>
            </div>
          </section>
        )
      ) : null}
    </div>
  )
}
