// Bottom-up event clustering — the "one cluster = one specific happening"
// mode of /sidechat-topics. Pure: no Supabase, no Next, no env reads, so the
// same code runs from the page's server action and from
// scripts/sidechat-cluster.mjs. The caller supplies the model call.
//
// Three stages, each mechanically validated:
//   1. NOMINATE  — per post (batched), name the specific event behind it.
//   2. CONSOLIDATE — one call over the event lines alone, merging only lines
//      that describe the SAME happening. Unmentioned lines stay their own
//      cluster, so the model can only merge, never invent themes.
//   3. BACKSTOP — clusters whose title carries the agglomeration signature
//      ("X, Y, and Z") get one forced split pass. Models rationalize around
//      soft tests; the title needing "and" is the literal symptom.
//   4. SUBCLUSTER — inside every cluster with enough posts, partition the
//      posts by the REACTION students are having to the event (fury, shopping
//      for the easier professor, waitlist dread, gallows humor...), never by
//      subject. One call per cluster, every post placed exactly once, groups
//      under two posts folded into a remainder. Best-effort: a failed call
//      leaves that cluster flat rather than failing a multi-minute run.

export type SidechatPost = {
  id: string
  content: string
  likeCount: number
  postedAt: string
}

// One reaction inside an event: name reads as what students are doing or
// feeling ("Rage at Vergil's search"), reaction is the one-or-two-word label
// of that feeling ("fury"). Posts are the cluster's posts, partitioned.
export type EventSubcluster = {
  name: string
  reaction: string
  posts: SidechatPost[]
  totalLikes: number
}

export type EventCluster = {
  title: string
  posts: SidechatPost[]
  totalLikes: number
  // present only for clusters with >= SUBCLUSTER_MIN_POSTS posts where the
  // reaction pass found two or more reactions; absent on older archives
  subclusters?: EventSubcluster[]
}

export type ModelCall = (systemPrompt: string, userPrompt: string) => Promise<string>

export const POSTS_PER_BATCH = 80
// Clusters smaller than this stay flat: fewer posts cannot show a split in reactions.
export const SUBCLUSTER_MIN_POSTS = 6
// A reaction group needs this many posts; smaller groups fold into the remainder.
const SUBCLUSTER_MIN_GROUP = 2
const SUBCLUSTER_REMAINDER_NAME = 'Other reactions'

export const parseJsonLoose = (value: string): unknown => {
  const cleaned = value
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }
  let out = tryParse(cleaned)
  if (out !== undefined) return out
  const start = cleaned.search(/[[{]/)
  const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'))
  const sub = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
  out = tryParse(sub)
  return out === undefined ? null : out
}

const NOMINATE_SYSTEM =
  'You identify the specific campus event behind each Sidechat post. You only respond in strict JSON.'

const nominatePrompt = (postsJson: string): string =>
  'POSTS (raw Sidechat posts):\n' +
  postsJson +
  '\n\nFor EACH post, name the ONE specific happening that prompted it — the event a ' +
  'campus reporter would file it under: who/what/where, one line, under 12 words.\n' +
  'The test: could every post given this exact event line have been prompted by the ' +
  'same single occurrence? "facilities problems" fails (covers many occurrences); ' +
  '"Uris pool closed by maintenance alert" passes.\n' +
  'WRONG: "campus disruptions" / RIGHT: "police activity outside Kent Hall"\n' +
  'If the post is a pure vibe, meme, or personal one-off with no shared event behind ' +
  'it, use null.\n\n' +
  'Output ONLY a strict JSON array with one entry per post, no prose:\n' +
  '[{"post_id": "<EXACT id copied VERBATIM from POSTS>", "event": "<one-line specific happening, or null>"}]\n\n' +
  'Before answering, check: (1) every post appears exactly once; (2) every event line ' +
  'names a concrete occurrence, not a theme; (3) vibes and one-offs got null.'

const MERGE_SYSTEM =
  'You merge duplicate descriptions of the same campus event. You only respond in strict JSON.'

const mergePrompt = (numberedLines: string): string =>
  'EVENT LINES (each nominated from one Sidechat post):\n' +
  numberedLines +
  '\n\nMerge ONLY lines that describe the SAME specific happening — same occurrence, ' +
  'same actors and place. Different happenings that merely share a theme stay separate.\n' +
  'WRONG: merging "police activity outside Kent Hall" + "construction near Alma Mater" ' +
  'into "campus disruptions: police and construction".\n' +
  'RIGHT: leaving them as two separate events.\n\n' +
  'Output ONLY a strict JSON array of merge groups, no prose. Only output groups of 2 ' +
  'or more lines — lines you leave out automatically stay their own event:\n' +
  '[{"title": "<the one specific happening, under 12 words>", "line_ids": [<numbers of lines that are this same event>]}]\n\n' +
  'Before answering, check: (1) every line id exists; (2) no line id appears in two ' +
  'groups; (3) no title needs "and" or a comma list to cover its members — if it does, ' +
  'the group is an agglomeration and must not be merged.'

const SPLIT_SYSTEM =
  'You split a lumped cluster of Sidechat posts into single specific events. You only respond in strict JSON.'

const splitPrompt = (title: string, postsJson: string): string =>
  `This cluster was titled "${title}" — flagged as possibly lumping several events.\n` +
  'POSTS:\n' +
  postsJson +
  '\n\nRegroup the posts so each group is ONE specific happening (same occurrence, same ' +
  'actors and place). If all posts truly belong to one happening, output a single group ' +
  'with a title that no longer reads as a list.\n\n' +
  'Output ONLY a strict JSON array, no prose, every post in exactly one group:\n' +
  '[{"title": "<one specific happening, under 12 words>", "post_ids": ["<EXACT ids copied VERBATIM from POSTS>"]}]'

const SUBCLUSTER_SYSTEM =
  'You group Sidechat posts about one campus event by the reaction the students are having. You only respond in strict JSON.'

const subclusterPrompt = (title: string, postsJson: string): string =>
  `EVENT: "${title}"\n` +
  'POSTS (every one is about this event):\n' +
  postsJson +
  '\n\nPartition the posts by the REACTION the poster is having to the event — the feeling ' +
  'or the move they are making — NOT by the subject they mention.\n' +
  'The test: would the writer of one post nod at the other for the SAME REASON? Two posts ' +
  'asking "Piechnik or de Silva for calc 3?" and "Alonso or Xavier for macro?" pass (both ' +
  'are shopping for the easier professor). "Calc 3 waitlist movement?" and "Piechnik for ' +
  'calc 3?" fail (same course, different reaction: dread vs shopping).\n' +
  'WRONG groups: "Calc 3 posts", "CC section posts", "Barnard classes" — those are subjects.\n' +
  'RIGHT groups: "Rage at Vergil\'s search", "Shopping for the easier professor", ' +
  '"Begging for a section swap", "Waitlist dread", "Hunting for an easy A", ' +
  '"Laughing at their own schedule".\n' +
  'Name each group so it completes "students are ...": a feeling or a move, under 8 words, ' +
  'no course names. Give the reaction itself in one or two words (fury, dread, bargaining, ' +
  'curiosity, gallows humor, relief).\n' +
  'These examples are illustrations only — never copy them into the output unless the posts ' +
  'genuinely show that reaction.\n\n' +
  'Output ONLY a strict JSON array, no prose, every post in exactly one group:\n' +
  '[{"name": "<what students are doing or feeling, under 8 words>", "reaction": "<one or two words>", ' +
  '"post_ids": ["<EXACT ids copied VERBATIM from POSTS>"]}]\n\n' +
  'Before answering, check: (1) every post id appears exactly once; (2) no group is defined ' +
  'by a course, department, school, or subject; (3) every name reads as a feeling or a move, ' +
  'not a topic; (4) no name needs "and" to cover its posts — if it does, split it; ' +
  '(5) two groups with the same reaction word and the same move are one group.'

// A subcluster name that is really a subject: it names a course, a department,
// a school, or ends in a bare plural noun like "posts"/"classes"/"questions".
// Over-broad on purpose — a flagged group just gets folded into the remainder.
const looksLikeSubject = (name: string): boolean =>
  /\b(posts?|classes|courses|questions|threads)\s*$/i.test(name.trim()) ||
  /^(calc|physics|chem|bio|econ|cc|lit hum|art hum|music hum|barnard|columbia)\b/i.test(name.trim())

// The agglomeration signature: comma lists, "and"/"&" joins, "colon then list".
// Deliberately over-broad — a false positive just costs one split call that may
// return the cluster unchanged.
const looksAgglomerated = (title: string): boolean => /,\s|\sand\s|\s&\s/i.test(title)

const normalizeEventLine = (line: string): string => line.trim().replace(/\.+$/, '').toLowerCase()

const postsJsonOf = (posts: SidechatPost[]): string =>
  JSON.stringify(
    posts.map((p) => ({ id: p.id, content: p.content })),
    null,
    2
  )

const sumLikes = (posts: SidechatPost[]): number => posts.reduce((sum, p) => sum + p.likeCount, 0)

// Errors carry the failed stage in their message so a UI can show it as-is.
export async function clusterEvents(
  posts: SidechatPost[],
  callModel: ModelCall
): Promise<{ clusters: EventCluster[]; oneOffs: SidechatPost[] }> {
  if (posts.length === 0) return { clusters: [], oneOffs: [] }

  // 1. NOMINATE. A post whose nomination is missing or invalid falls back to
  // null (one-off) rather than being guessed at.
  const batches: SidechatPost[][] = []
  for (let i = 0; i < posts.length; i += POSTS_PER_BATCH) {
    batches.push(posts.slice(i, i + POSTS_PER_BATCH))
  }
  const eventByPost = new Map<string, string | null>()
  try {
    const perBatch = await Promise.all(
      batches.map(async (batch) => {
        const text = await callModel(NOMINATE_SYSTEM, nominatePrompt(postsJsonOf(batch)))
        const parsed = parseJsonLoose(text)
        return Array.isArray(parsed) ? (parsed as { post_id?: unknown; event?: unknown }[]) : []
      })
    )
    const postIds = new Set(posts.map((p) => p.id))
    for (const n of perBatch.flat()) {
      const postId = typeof n.post_id === 'string' ? n.post_id : null
      if (!postId || !postIds.has(postId) || eventByPost.has(postId)) continue
      const event =
        typeof n.event === 'string' && n.event.trim() && n.event.trim().toLowerCase() !== 'null'
          ? n.event.trim()
          : null
      eventByPost.set(postId, event)
    }
  } catch (err) {
    throw new Error(`Event nomination failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Distinct event lines, exact-duplicate nominations collapsed mechanically.
  const lineIdByNorm = new Map<string, number>()
  const lines: string[] = []
  const lineIdByPost = new Map<string, number>()
  for (const p of posts) {
    const event = eventByPost.get(p.id) ?? null
    if (event === null) continue
    const norm = normalizeEventLine(event)
    let lineId = lineIdByNorm.get(norm)
    if (lineId === undefined) {
      lineId = lines.length
      lines.push(event)
      lineIdByNorm.set(norm, lineId)
    }
    lineIdByPost.set(p.id, lineId)
  }

  // 2. CONSOLIDATE. clusterOfLine maps every line to its cluster; default is
  // "own cluster" and the model's merge groups only ever overwrite that.
  const clusterOfLine = lines.map((_, i) => i)
  const clusterTitles = new Map<number, string>(lines.map((l, i) => [i, l]))
  if (lines.length > 1) {
    try {
      const numbered = lines.map((l, i) => `${i}. ${l}`).join('\n')
      const text = await callModel(MERGE_SYSTEM, mergePrompt(numbered))
      const parsed = parseJsonLoose(text)
      const groups = Array.isArray(parsed) ? (parsed as { title?: unknown; line_ids?: unknown }[]) : []
      const claimed = new Set<number>()
      for (const g of groups) {
        const ids = Array.isArray(g.line_ids)
          ? (g.line_ids as unknown[]).filter(
              (id): id is number =>
                typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < lines.length
            )
          : []
        const fresh = ids.filter((id) => !claimed.has(id))
        if (fresh.length < 2) continue
        fresh.forEach((id) => claimed.add(id))
        const home = fresh[0]
        for (const id of fresh) clusterOfLine[id] = home
        clusterTitles.set(
          home,
          typeof g.title === 'string' && g.title.trim() ? g.title.trim() : lines[home]
        )
      }
    } catch (err) {
      throw new Error(
        `Event consolidation failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // Assemble clusters mechanically: post → its line → the line's cluster.
  const postsByCluster = new Map<number, SidechatPost[]>()
  for (const p of posts) {
    const lineId = lineIdByPost.get(p.id)
    if (lineId === undefined) continue
    const home = clusterOfLine[lineId]
    const list = postsByCluster.get(home) ?? []
    list.push(p)
    postsByCluster.set(home, list)
  }

  // 3. BACKSTOP: force-split multi-post clusters whose title reads as a list.
  let clusters: EventCluster[] = [...postsByCluster.entries()].map(([home, members]) => ({
    title: clusterTitles.get(home) ?? lines[home],
    posts: members,
    totalLikes: sumLikes(members),
  }))
  const suspicious = clusters.filter((c) => c.posts.length >= 2 && looksAgglomerated(c.title))
  if (suspicious.length > 0) {
    try {
      const replacements = await Promise.all(
        suspicious.map(async (cluster) => {
          const text = await callModel(SPLIT_SYSTEM, splitPrompt(cluster.title, postsJsonOf(cluster.posts)))
          const parsed = parseJsonLoose(text)
          const groups = Array.isArray(parsed) ? (parsed as { title?: unknown; post_ids?: unknown }[]) : []
          const byId = new Map(cluster.posts.map((p) => [p.id, p]))
          const claimed = new Set<string>()
          const split: EventCluster[] = []
          for (const g of groups) {
            const members = (Array.isArray(g.post_ids) ? (g.post_ids as unknown[]) : [])
              .filter((id): id is string => typeof id === 'string' && byId.has(id) && !claimed.has(id))
              .map((id) => {
                claimed.add(id)
                return byId.get(id) as SidechatPost
              })
            if (members.length === 0) continue
            split.push({
              title: typeof g.title === 'string' && g.title.trim() ? g.title.trim() : cluster.title,
              posts: members,
              totalLikes: sumLikes(members),
            })
          }
          // Posts the split answer dropped keep the original cluster.
          const leftover = cluster.posts.filter((p) => !claimed.has(p.id))
          if (leftover.length > 0) {
            split.push({ title: cluster.title, posts: leftover, totalLikes: sumLikes(leftover) })
          }
          return split.length > 0 ? split : [cluster]
        })
      )
      const suspiciousSet = new Set(suspicious)
      clusters = [...clusters.filter((c) => !suspiciousSet.has(c)), ...replacements.flat()]
    } catch (err) {
      throw new Error(`Cluster split pass failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const byLikesDesc = (a: SidechatPost, b: SidechatPost) => b.likeCount - a.likeCount

  // 4. SUBCLUSTER by reaction, one call per big-enough cluster, in parallel.
  // Mechanical rules: only ids from this cluster count, a post is placed once,
  // groups under SUBCLUSTER_MIN_GROUP or named like a subject fold into the
  // remainder, and a partition with fewer than two real groups is discarded.
  await Promise.all(
    clusters
      .filter((c) => c.posts.length >= SUBCLUSTER_MIN_POSTS)
      .map(async (cluster) => {
        let text: string
        try {
          text = await callModel(SUBCLUSTER_SYSTEM, subclusterPrompt(cluster.title, postsJsonOf(cluster.posts)))
        } catch {
          return // best-effort: this cluster stays flat
        }
        const parsed = parseJsonLoose(text)
        const groups = Array.isArray(parsed)
          ? (parsed as { name?: unknown; reaction?: unknown; post_ids?: unknown }[])
          : []
        const byId = new Map(cluster.posts.map((p) => [p.id, p]))
        const claimed = new Set<string>()
        const kept: EventSubcluster[] = []
        const remainder: SidechatPost[] = []
        for (const g of groups) {
          const members = (Array.isArray(g.post_ids) ? (g.post_ids as unknown[]) : [])
            .filter((id): id is string => typeof id === 'string' && byId.has(id) && !claimed.has(id))
            .map((id) => {
              claimed.add(id)
              return byId.get(id) as SidechatPost
            })
          if (members.length === 0) continue
          const name = typeof g.name === 'string' ? g.name.trim() : ''
          if (members.length < SUBCLUSTER_MIN_GROUP || !name || looksLikeSubject(name)) {
            remainder.push(...members)
            continue
          }
          kept.push({
            name,
            reaction: typeof g.reaction === 'string' && g.reaction.trim() ? g.reaction.trim().toLowerCase() : '',
            posts: members,
            totalLikes: sumLikes(members),
          })
        }
        remainder.push(...cluster.posts.filter((p) => !claimed.has(p.id)))
        if (kept.length < 2) return
        if (remainder.length > 0) {
          kept.push({ name: SUBCLUSTER_REMAINDER_NAME, reaction: '', posts: remainder, totalLikes: sumLikes(remainder) })
        }
        kept.forEach((s) => s.posts.sort(byLikesDesc))
        // Ranked by upvotes, remainder always last.
        kept.sort((a, b) =>
          a.name === SUBCLUSTER_REMAINDER_NAME ? 1 : b.name === SUBCLUSTER_REMAINDER_NAME ? -1 : b.totalLikes - a.totalLikes
        )
        cluster.subclusters = kept
      })
  )

  clusters.forEach((c) => c.posts.sort(byLikesDesc))
  clusters.sort((a, b) => b.totalLikes - a.totalLikes)
  const oneOffs = posts.filter((p) => (eventByPost.get(p.id) ?? null) === null).sort(byLikesDesc)
  return { clusters, oneOffs }
}
