'use server'

// /sidechat-topics backend: pull the Student Brain's current topics (the same
// metrics retrieval that ${studentBrainOutput} uses), pull the raw Sidechat
// posts inside the window from the Brain API (GET /v1/sidechat-posts — the
// live feed; toosoon's own sidechat_posts mirror stopped refreshing in June
// 2026), and group the posts either under the topics (LLM assignment) or
// bottom-up by event (src/app/sidechat-topics/event-clustering.ts). The brain
// exposes no topic→post membership on any read surface, so grouping is
// computed here.

import { createClient } from '@/utils/supabase/server'
import {
  getStudentBrainNewestSidechatPostAt,
  getStudentBrainOutputText,
  getStudentBrainSidechatPosts,
} from '@/utils/student-brain'

import {
  clusterEvents,
  parseJsonLoose,
  POSTS_PER_BATCH,
  type EventCluster,
  type SidechatPost,
} from './event-clustering'

const ASSIGN_MODEL = 'gpt-5.5'
// Bounded server-side regardless of what the client sends.
const MAX_WINDOW_DAYS = 90

export type BrainTopic = {
  topicId: number
  title: string
  summary: string
  rank: number
  primaryEmotion: string | null
  importance: number | null
}

export type TopicGroup = {
  topic: BrainTopic
  posts: SidechatPost[]
}

export type TopicMapResult =
  | {
      ok: true
      groups: TopicGroup[]
      unmatched: SidechatPost[]
      postCount: number
      windowStart: string
      newestPostAt: string | null
    }
  | { ok: false; error: string }

export type EventClustersResult =
  | {
      ok: true
      clusters: EventCluster[]
      oneOffs: SidechatPost[]
      postCount: number
      windowStart: string
      newestPostAt: string | null
    }
  | { ok: false; error: string }

// Raw shapes from the brain's metrics retrieval (see src/utils/student-brain.ts
// and lolumbia's /v1/prompt-time-retrieval).
type RawMemory = {
  topic_id?: number
  title?: string
  summary?: string
  rank?: number
  primary_emotion?: string
  metric_snapshot?: { importance_score?: number }
}

const ASSIGN_SYSTEM =
  'You sort campus Sidechat posts under campus cultural topics. You only respond in strict JSON.'

const assignPrompt = (topicsJson: string, postsJson: string): string =>
  'TOPICS (campus cultural topics from the student memory engine):\n' +
  topicsJson +
  '\n\nPOSTS (raw Sidechat posts):\n' +
  postsJson +
  '\n\nFor EACH post, decide which ONE topic it belongs to.\n' +
  'The test: would someone who has just read the topic title and summary point at this ' +
  'post and say "that is another post about this"? If yes for exactly one topic, assign it. ' +
  'If yes for several, pick the topic whose summary names the most specific detail the post ' +
  'shares. If no for every topic, assign null — do NOT stretch a topic to fit.\n\n' +
  'Output ONLY a strict JSON array with one entry per post, no prose:\n' +
  '[{"post_id": "<EXACT id copied VERBATIM from POSTS>", "topic_id": <topic_id number copied from TOPICS, or null>}]\n\n' +
  'Before answering, check: (1) every post appears exactly once; (2) every topic_id you ' +
  'used exists in TOPICS; (3) you used null for posts that fit nothing.'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

// Shared by both grouping modes: the raw posts inside the window, most-liked
// first, straight from the Brain API. The API's start_date is a calendar day,
// so the window snaps to the start of that UTC day.
const loadWindowPosts = async (
  days: number
): Promise<{ posts: SidechatPost[]; windowStart: string } | { error: string }> => {
  const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  try {
    const { posts } = await getStudentBrainSidechatPosts(windowStart)
    return { posts, windowStart: windowStart.toISOString() }
  } catch (err) {
    return {
      error: `Student Brain sidechat-posts fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

// Tell the caller how fresh the feed is, so an empty page explains itself.
const newestPostDate = async (): Promise<string | null> => {
  try {
    return await getStudentBrainNewestSidechatPostAt()
  } catch {
    return null
  }
}

const newestOf = (posts: SidechatPost[]): string | null =>
  posts.reduce<string | null>((max, p) => (max === null || p.postedAt > max ? p.postedAt : max), null)

const clampWindow = (windowDays: number): number =>
  Number.isInteger(windowDays) ? Math.min(Math.max(windowDays, 1), MAX_WINDOW_DAYS) : 7

const requireUser = async (supabase: SupabaseServerClient): Promise<boolean> => {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  return !error && !!user
}

const callOpenAI = async (systemPrompt: string, userPrompt: string): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ASSIGN_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: 16000,
    }),
  })
  if (!res.ok) throw new Error(`assignment model call failed (${res.status})`)
  const data = await res.json()
  const text = (data?.choices?.[0]?.message?.content ?? '').trim()
  if (!text) throw new Error('assignment model returned no output')
  return text
}

export async function mapPostsToTopicsAction(windowDays: number): Promise<TopicMapResult> {
  const days = clampWindow(windowDays)
  const supabase = await createClient({ readOnly: true })
  if (!(await requireUser(supabase))) return { ok: false, error: 'Not signed in.' }

  // 1. Topics — same call, same ranking as ${studentBrainOutput}.
  let topics: BrainTopic[]
  try {
    const raw = JSON.parse(await getStudentBrainOutputText()) as {
      result?: { selected_memories?: RawMemory[] }
    }
    topics = (raw?.result?.selected_memories ?? [])
      .filter((m) => typeof m.topic_id === 'number')
      .map((m, i) => ({
        topicId: m.topic_id as number,
        title: m.title ?? `Topic ${m.topic_id}`,
        summary: m.summary ?? '',
        rank: m.rank ?? i + 1,
        primaryEmotion: m.primary_emotion ?? null,
        importance: m.metric_snapshot?.importance_score ?? null,
      }))
  } catch (err) {
    return {
      ok: false,
      error: `Student Brain retrieval failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (topics.length === 0) return { ok: false, error: 'Student Brain returned no topics.' }

  // 2. Raw posts inside the window.
  const loaded = await loadWindowPosts(days)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { posts, windowStart } = loaded

  if (posts.length === 0) {
    return {
      ok: true,
      groups: topics.map((topic) => ({ topic, posts: [] })),
      unmatched: [],
      postCount: 0,
      windowStart,
      newestPostAt: await newestPostDate(),
    }
  }

  // 3. LLM assignment, batched. The model's answer is validated mechanically:
  // unknown post ids and topic ids are dropped, a post assigns at most once.
  const topicsJson = JSON.stringify(
    topics.map((t) => ({ topic_id: t.topicId, title: t.title, summary: t.summary })),
    null,
    2
  )
  const batches: SidechatPost[][] = []
  for (let i = 0; i < posts.length; i += POSTS_PER_BATCH) {
    batches.push(posts.slice(i, i + POSTS_PER_BATCH))
  }

  let assignments: { post_id?: unknown; topic_id?: unknown }[]
  try {
    const perBatch = await Promise.all(
      batches.map(async (batch) => {
        const postsJson = JSON.stringify(
          batch.map((p) => ({ id: p.id, content: p.content })),
          null,
          2
        )
        const text = await callOpenAI(ASSIGN_SYSTEM, assignPrompt(topicsJson, postsJson))
        const parsed = parseJsonLoose(text)
        return Array.isArray(parsed) ? (parsed as { post_id?: unknown; topic_id?: unknown }[]) : []
      })
    )
    assignments = perBatch.flat()
  } catch (err) {
    return {
      ok: false,
      error: `Topic assignment failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const postsById = new Map(posts.map((p) => [p.id, p]))
  const topicIds = new Set(topics.map((t) => t.topicId))
  const assignedTopicByPost = new Map<string, number>()
  for (const a of assignments) {
    const postId = typeof a.post_id === 'string' ? a.post_id : null
    const topicId = typeof a.topic_id === 'number' ? a.topic_id : null
    if (!postId || !postsById.has(postId) || assignedTopicByPost.has(postId)) continue
    if (topicId === null || !topicIds.has(topicId)) continue
    assignedTopicByPost.set(postId, topicId)
  }

  const byLikes = (a: SidechatPost, b: SidechatPost) => b.likeCount - a.likeCount
  const groups: TopicGroup[] = topics
    .sort((a, b) => a.rank - b.rank)
    .map((topic) => ({
      topic,
      posts: posts
        .filter((p) => assignedTopicByPost.get(p.id) === topic.topicId)
        .sort(byLikes),
    }))
  const unmatched = posts.filter((p) => !assignedTopicByPost.has(p.id)).sort(byLikes)

  return {
    ok: true,
    groups,
    unmatched,
    postCount: posts.length,
    windowStart,
    newestPostAt: newestOf(posts),
  }
}

// ---------------------------------------------------------------------------
// Bottom-up event clustering — the "one cluster = one specific happening"
// mode. The three-stage pipeline lives in ./event-clustering.ts so
// scripts/sidechat-cluster.mjs runs the identical code from the terminal.
// ---------------------------------------------------------------------------

export async function clusterEventsAction(windowDays: number): Promise<EventClustersResult> {
  const days = clampWindow(windowDays)
  const supabase = await createClient({ readOnly: true })
  if (!(await requireUser(supabase))) return { ok: false, error: 'Not signed in.' }

  const loaded = await loadWindowPosts(days)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { posts, windowStart } = loaded

  if (posts.length === 0) {
    return {
      ok: true,
      clusters: [],
      oneOffs: [],
      postCount: 0,
      windowStart,
      newestPostAt: await newestPostDate(),
    }
  }

  try {
    const { clusters, oneOffs } = await clusterEvents(posts, callOpenAI)
    return {
      ok: true,
      clusters,
      oneOffs,
      postCount: posts.length,
      windowStart,
      newestPostAt: newestOf(posts),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// Saved clusterings — table sidechat_clusterings
// (supabase/migrations/20260812000000, run by hand like ops_runs). The whole
// result payload is stored verbatim so a saved clustering reloads without
// re-running any LLM calls.
// ---------------------------------------------------------------------------

export type SavedClusteringMeta = {
  id: string
  name: string
  windowDays: number
  postCount: number
  createdAt: string
}

export type SaveClusteringResult =
  | { ok: true; saved: SavedClusteringMeta }
  | { ok: false; error: string }

export type ListClusteringsResult =
  // tableMissing: the archive table has not been created yet (the migration is
  // run by hand), so nothing can be saved or listed until it is.
  | { ok: true; clusterings: SavedClusteringMeta[]; tableMissing?: boolean }
  | { ok: false; error: string }

export type LoadClusteringResult =
  | {
      ok: true
      name: string
      windowDays: number
      clusters: EventCluster[]
      oneOffs: SidechatPost[]
      postCount: number
      windowStart: string
      newestPostAt: string | null
    }
  | { ok: false; error: string }

// "<run time in campus timezone> — <username>", e.g. "Aug 12, 3:42 PM — Lydia Chilton".
const clusteringName = (whenIso: string, username: string): string => {
  const when = new Date(whenIso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${when} — ${username}`
}

export async function saveClusteringAction(input: {
  windowDays: number
  windowStart: string
  postCount: number
  clusters: EventCluster[]
  oneOffs: SidechatPost[]
  newestPostAt: string | null
}): Promise<SaveClusteringResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) return { ok: false, error: 'Not signed in.' }

  // Username: profile name if readable, else the email, else the short id.
  let username = user.email ?? user.id.slice(0, 8)
  const { data: profileRows } = await supabase
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', user.id)
    .limit(1)
  const profile = (profileRows as { first_name: string | null; last_name: string | null }[] | null)?.[0]
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim()
  if (fullName) username = fullName

  const createdAt = new Date().toISOString()
  const name = clusteringName(createdAt, username)

  const { data: inserted, error: insertError } = await supabase
    .from('sidechat_clusterings')
    .insert({
      name,
      mode: 'events',
      window_days: input.windowDays,
      window_start_utc: input.windowStart,
      post_count: input.postCount,
      payload: {
        clusters: input.clusters,
        oneOffs: input.oneOffs,
        newestPostAt: input.newestPostAt,
      },
      profile_id: user.id,
      created_by_email: user.email ?? null,
      created_datetime_utc: createdAt,
    })
    .select('id')
    .single()
  if (insertError) {
    const hint = /sidechat_clusterings/.test(insertError.message)
      ? ' (has supabase/migrations/20260812000000_sidechat_clusterings.sql been run in the SQL editor?)'
      : ''
    return { ok: false, error: `Save failed: ${insertError.message}${hint}` }
  }

  return {
    ok: true,
    saved: {
      id: (inserted as { id: string }).id,
      name,
      windowDays: input.windowDays,
      postCount: input.postCount,
      createdAt,
    },
  }
}

export async function listClusteringsAction(): Promise<ListClusteringsResult> {
  const supabase = await createClient({ readOnly: true })
  if (!(await requireUser(supabase))) return { ok: false, error: 'Not signed in.' }

  const { data, error } = await supabase
    .from('sidechat_clusterings')
    .select('id, name, window_days, post_count, created_datetime_utc')
    .order('created_datetime_utc', { ascending: false })
    .limit(30)
  if (error) {
    // The table not existing yet means nothing has been saved — and nothing
    // can be until the migration is run. Say so instead of showing an empty list.
    if (/sidechat_clusterings/.test(error.message)) {
      return { ok: true, clusterings: [], tableMissing: true }
    }
    return { ok: false, error: `List failed: ${error.message}` }
  }

  return {
    ok: true,
    clusterings: (
      (data ?? []) as {
        id: string
        name: string
        window_days: number
        post_count: number
        created_datetime_utc: string
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      windowDays: r.window_days,
      postCount: r.post_count,
      createdAt: r.created_datetime_utc,
    })),
  }
}

export async function loadClusteringAction(id: string): Promise<LoadClusteringResult> {
  const supabase = await createClient({ readOnly: true })
  if (!(await requireUser(supabase))) return { ok: false, error: 'Not signed in.' }

  const { data, error } = await supabase
    .from('sidechat_clusterings')
    .select('name, window_days, post_count, window_start_utc, payload')
    .eq('id', id)
    .limit(1)
  if (error) return { ok: false, error: `Load failed: ${error.message}` }
  const row = (
    data as
      | {
          name: string
          window_days: number
          post_count: number
          window_start_utc: string | null
          payload: {
            clusters?: EventCluster[]
            oneOffs?: SidechatPost[]
            newestPostAt?: string | null
          } | null
        }[]
      | null
  )?.[0]
  if (!row) return { ok: false, error: 'Saved clustering not found.' }

  return {
    ok: true,
    name: row.name,
    windowDays: row.window_days,
    clusters: Array.isArray(row.payload?.clusters) ? row.payload.clusters : [],
    oneOffs: Array.isArray(row.payload?.oneOffs) ? row.payload.oneOffs : [],
    postCount: row.post_count,
    windowStart: row.window_start_utc ?? '',
    newestPostAt: row.payload?.newestPostAt ?? null,
  }
}
