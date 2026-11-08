// Turns an archived Sidechat event clustering into the moments the reverse
// pipelines consume (/reverse batch runner, /ops-reverse). Pure: no React, no
// Supabase, so every surface chunks an archive identically.
//
// The unit of a moment is the REACTION GROUP inside an event (stage 4 of
// event-clustering.ts), framed by its event. A flat list of 100+ posts hides
// what students are going through; the R-steps score on the feeling, so the
// feeling is what each moment carries. Rules:
//   - event with reaction groups → one moment per group, "Other reactions" skipped
//   - event without groups → one moment when it has 2+ posts, or one post
//     that drew SIDECHAT_SINGLE_POST_MIN_UPVOTES upvotes
//   - moment text = event, reaction, then the group's loudest posts verbatim
//     with upvote counts, so the context carries student voice, not a headline

import type { EventCluster, EventSubcluster, SidechatPost } from './event-clustering'

export type SidechatMoment = {
  // sc-<event index>-<group index> for a reaction group, sc-<event index> for a whole event
  key: string
  text: string
  eventIndex: number
  eventTitle: string
  // the reaction group's name ("Shopping for the easier professor"); null for a whole-event moment
  reaction: string | null
  // the one-or-two-word reaction label ("bargaining"); null when absent
  reactionWord: string | null
  postCount: number
  totalLikes: number
}

export const SIDECHAT_SINGLE_POST_MIN_UPVOTES = 50
export const SIDECHAT_POSTS_PER_MOMENT = 6
const REMAINDER_GROUP_NAME = 'Other reactions'

const quoteOf = (p: SidechatPost): string =>
  `"${p.content.replace(/\s+/g, ' ').trim().slice(0, 300)}" (${p.likeCount} upvotes)`

const quotesOf = (posts: SidechatPost[]): string =>
  posts.slice(0, SIDECHAT_POSTS_PER_MOMENT).map(quoteOf).join(' · ')

const isWholeEventWorthy = (c: EventCluster): boolean =>
  c.posts.length >= 2 || c.totalLikes >= SIDECHAT_SINGLE_POST_MIN_UPVOTES

const groupMoment = (c: EventCluster, eventIndex: number, g: EventSubcluster, groupIndex: number): SidechatMoment => ({
  key: `sc-${eventIndex}-${groupIndex}`,
  eventIndex,
  eventTitle: c.title,
  reaction: g.name,
  reactionWord: g.reaction || null,
  postCount: g.posts.length,
  totalLikes: g.totalLikes,
  text:
    `${c.title} — ${g.name}` +
    (g.reaction ? ` (reaction: ${g.reaction})` : '') +
    `. Sidechat posts: ${quotesOf(g.posts)}`,
})

const wholeEventMoment = (c: EventCluster, eventIndex: number): SidechatMoment => ({
  key: `sc-${eventIndex}`,
  eventIndex,
  eventTitle: c.title,
  reaction: null,
  reactionWord: null,
  postCount: c.posts.length,
  totalLikes: c.totalLikes,
  text: `${c.title}. Sidechat posts: ${quotesOf(c.posts)}`,
})

// Clusters keep their archived order (ranked by total upvotes), so moments
// come out event by event, loudest event first, loudest reaction first.
export function clusteringToMoments(clusters: EventCluster[]): SidechatMoment[] {
  const out: SidechatMoment[] = []
  clusters.forEach((c, i) => {
    const groups = (c.subclusters ?? []).filter((g) => g.name !== REMAINDER_GROUP_NAME && g.posts.length > 0)
    if (groups.length > 0) {
      groups.forEach((g, j) => out.push(groupMoment(c, i, g, j)))
    } else if (isWholeEventWorthy(c)) {
      out.push(wholeEventMoment(c, i))
    }
  })
  return out
}

// Moments grouped under their event, in order — for pickers that show the
// event as a heading with its reactions beneath.
export function groupMomentsByEvent(
  moments: SidechatMoment[]
): { eventIndex: number; eventTitle: string; moments: SidechatMoment[] }[] {
  const byEvent = new Map<number, { eventIndex: number; eventTitle: string; moments: SidechatMoment[] }>()
  for (const m of moments) {
    const e = byEvent.get(m.eventIndex) ?? { eventIndex: m.eventIndex, eventTitle: m.eventTitle, moments: [] }
    e.moments.push(m)
    byEvent.set(m.eventIndex, e)
  }
  return [...byEvent.values()]
}

// The picker-row shape shared by the reverse surfaces: the badge shows the
// reaction (or the event when the moment is a whole event).
export const toStudyMoment = (m: SidechatMoment): { key: string; text: string; brainTitle: string } => ({
  key: m.key,
  text: m.text,
  brainTitle: m.reaction ?? m.eventTitle,
})

// The whole archive as one prompt-context block: one moment per line, in
// archive order. This is what the ops page sends when a step's
// ${allCommunityContexts} or ${studentBrainOutput} slot is switched from the
// live runtime source to a saved clustering, so the step reads real student
// posts from a chosen window instead of whatever the corpus/Brain returns.
export function clusteringToContextText(clusters: EventCluster[]): string {
  return clusteringToMoments(clusters)
    .map((m) => m.text)
    .join('\n')
}
