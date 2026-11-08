#!/usr/bin/env node
// Cluster recent Sidechat posts by event from the terminal — the same
// three-stage pipeline (nominate → consolidate → backstop split) as the
// "Event clusters" mode of /sidechat-topics, over the same live Brain API
// feed. Runs the page's code directly (src/app/sidechat-topics/
// event-clustering.ts, src/utils/student-brain.ts) via Node's built-in
// type stripping, so the two can't drift.
//
//   node scripts/sidechat-cluster.mjs                  # last 7 days
//   node scripts/sidechat-cluster.mjs --days 3
//   node scripts/sidechat-cluster.mjs --out clusters   # writes clusters.json + clusters.md
//
// Prints a readable report to stdout; --out also writes the JSON payload
// (same shape the page saves to sidechat_clusterings) and a Markdown report.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const days = Number(arg('days', '7'))
const outBase = arg('out', '')
const model = arg('model', 'gpt-5.5')

// The TS modules read process.env, so load .env before importing them.
const env = loadEnv(ROOT)
for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v
for (const name of [
  'OPENAI_API_KEY',
  'STUDENT_BRAIN_API_URL',
  'STUDENT_BRAIN_CLIENT_ID',
  'STUDENT_BRAIN_CLIENT_SECRET',
]) {
  if (!process.env[name]) {
    console.error(`Missing ${name} in .env`)
    process.exit(1)
  }
}

const { getStudentBrainSidechatPosts } = await import('../src/utils/student-brain.ts')
const { clusterEvents } = await import('../src/app/sidechat-topics/event-clustering.ts')

const callOpenAI = async (systemPrompt, userPrompt) => {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: 16000,
    }),
  })
  if (!res.ok) throw new Error(`model call failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const text = (data?.choices?.[0]?.message?.content ?? '').trim()
  if (!text) throw new Error('model returned no output')
  return text
}

const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
console.error(`Fetching posts since ${windowStart.toISOString().slice(0, 10)}…`)
const { posts, total } = await getStudentBrainSidechatPosts(windowStart)
console.error(`${posts.length} posts (API total ${total}). Clustering with ${model}…`)

const t0 = Date.now()
const { clusters, oneOffs } = await clusterEvents(posts, callOpenAI)
console.error(`Done in ${Math.round((Date.now() - t0) / 1000)}s: ${clusters.length} clusters, ${oneOffs.length} one-offs.`)

const newestPostAt = posts.reduce((max, p) => (max === null || p.postedAt > max ? p.postedAt : max), null)
const payload = {
  windowDays: days,
  windowStart: windowStart.toISOString(),
  createdAt: new Date().toISOString(),
  postCount: posts.length,
  newestPostAt,
  clusters,
  oneOffs,
}

const day = (iso) => (iso ? iso.slice(0, 10) : '?')
const lines = []
lines.push(`# Sidechat event clusters — last ${days} days`)
lines.push('')
lines.push(
  `${posts.length} posts from ${day(payload.windowStart)} to ${day(newestPostAt)}. ` +
    `${clusters.length} event clusters (${clusters.reduce((n, c) => n + c.posts.length, 0)} posts), ` +
    `${oneOffs.length} one-offs.`
)
lines.push('')
clusters.forEach((c, i) => {
  lines.push(`## ${i + 1}. ${c.title}`)
  lines.push(`${c.posts.length} posts · ${c.totalLikes} upvotes`)
  lines.push('')
  const postLine = (p) => `- [${p.likeCount}] ${p.content.replace(/\s*\n\s*/g, ' / ')}`
  if (c.subclusters && c.subclusters.length > 0) {
    // Reaction groups inside the event (stage 4 of the clusterer).
    for (const s of c.subclusters) {
      lines.push(`### ${s.name}${s.reaction ? ` (${s.reaction})` : ''} — ${s.posts.length} posts · ${s.totalLikes} upvotes`)
      lines.push('')
      for (const p of s.posts) lines.push(postLine(p))
      lines.push('')
    }
  } else {
    for (const p of c.posts) lines.push(postLine(p))
    lines.push('')
  }
})
lines.push(`## One-offs (${oneOffs.length})`)
lines.push('')
for (const p of oneOffs) lines.push(`- [${p.likeCount}] ${p.content.replace(/\s*\n\s*/g, ' / ')}`)
const report = lines.join('\n')

console.log(report)
if (outBase) {
  fs.writeFileSync(`${outBase}.json`, JSON.stringify(payload, null, 2))
  fs.writeFileSync(`${outBase}.md`, report)
  console.error(`Wrote ${outBase}.json and ${outBase}.md`)
}
