#!/usr/bin/env node
// Fetch recent Sidechat posts from the Student Brain API (lolumbia,
// GET /v1/sidechat-posts) — the same live data behind
// brain.almostcrackd.ai/sidechat-posts. Auth is the OAuth client-credentials
// exchange already used by src/utils/student-brain.ts, with the same
// STUDENT_BRAIN_* env vars.
//
//   node scripts/sidechat-recent.mjs                 # last 7 days, most-upvoted first
//   node scripts/sidechat-recent.mjs --days 3
//   node scripts/sidechat-recent.mjs --order newest  # newest first instead
//   node scripts/sidechat-recent.mjs --limit 50
//   node scripts/sidechat-recent.mjs --json > posts.json
//
// --json prints the flat [{id, content, likeCount, postedAt}] shape the
// sidechat-topics surface uses.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const days = Number(arg('days', '7'))
const order = arg('order', 'likes') // likes | newest
const limit = Number(arg('limit', '0')) // 0 = server default (max page, 999)
const asJson = process.argv.includes('--json')

const env = loadEnv(ROOT)
for (const name of [
  'STUDENT_BRAIN_API_URL',
  'STUDENT_BRAIN_CLIENT_ID',
  'STUDENT_BRAIN_CLIENT_SECRET',
]) {
  if (!env[name]) {
    console.error(`Missing ${name} in .env`)
    process.exit(1)
  }
}
const apiUrl = env.STUDENT_BRAIN_API_URL.replace(/\/+$/, '')

const tokenRes = await fetch(`${apiUrl}/v1/oauth/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    grant_type: 'client_credentials',
    client_id: env.STUDENT_BRAIN_CLIENT_ID,
    client_secret: env.STUDENT_BRAIN_CLIENT_SECRET,
  }),
})
if (!tokenRes.ok) {
  console.error(`Token request failed: ${tokenRes.status} ${await tokenRes.text()}`)
  process.exit(1)
}
const { access_token: accessToken } = await tokenRes.json()

// start_date is a calendar day (inclusive, API-fixed timezone); no end_date
// means "through to now".
const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10)

const params = new URLSearchParams({
  start_date: startDate,
  order_by: order === 'newest' ? 'created_at' : 'upvote_count',
  order: 'desc',
})
if (limit > 0) params.set('limit', String(limit))

const res = await fetch(`${apiUrl}/v1/sidechat-posts?${params}`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!res.ok) {
  console.error(`sidechat-posts request failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}
const body = await res.json()
const result = body.result ?? body
const rows = result.posts ?? []

const posts = rows
  .filter((p) => (p.content ?? '').trim().length > 0)
  .map((p) => ({
    id: p.id,
    content: (p.content ?? '').trim(),
    likeCount: p.upvote_count ?? 0,
    postedAt: p.created_at,
  }))

if (asJson) {
  console.log(JSON.stringify(posts, null, 2))
} else {
  const w = result.window ?? {}
  console.log(
    `${posts.length} of ${result.total} posts, window ${w.since ?? '(open)'} → ${w.until ?? 'now'} (${w.tz ?? '?'})\n`
  )
  for (const p of posts) {
    console.log(`[${String(p.likeCount).padStart(4)} upvotes] ${p.postedAt}`)
    console.log(`  ${p.content.replace(/\n/g, '\n  ')}\n`)
  }
}
