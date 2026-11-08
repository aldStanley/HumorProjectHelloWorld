#!/usr/bin/env node
// Exercises every Student Brain ${...} placeholder resolver in
// src/utils/student-brain.ts against the live API, one call per variable,
// and writes the results to a report file (JSON or plain text). Credentials
// come from .env (untracked, local-only) — same convention as the other
// scripts/ tools (see scripts/meme-opt/lib.mjs's loadEnv).
//
//   node scripts/test-student-brain.mjs
//   node scripts/test-student-brain.mjs --top-k 10
//   node scripts/test-student-brain.mjs --format txt
//   node scripts/test-student-brain.mjs --out scripts/runs/sb-check.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : (argv[++i] ?? true)
}
const DEFAULT_TOP_K = 5
const TOP_K = args['top-k'] ? Number(args['top-k']) : DEFAULT_TOP_K
const FORMAT = args.format === 'txt' ? 'txt' : 'json'
const OUT_PATH = args.out
  ? path.resolve(ROOT, args.out)
  : path.join(ROOT, `scripts/test-student-brain-output.${FORMAT}`)

const REQUIRED_KEYS = ['STUDENT_BRAIN_API_URL', 'STUDENT_BRAIN_CLIENT_ID', 'STUDENT_BRAIN_CLIENT_SECRET']

const env = loadEnv(ROOT)
const missing = REQUIRED_KEYS.filter((key) => !env[key]?.trim() && !process.env[key]?.trim())
if (missing.length) {
  console.error(`Missing from .env: ${missing.join(', ')}`)
  console.error('Add them to .env at the repo root (untracked — see .gitignore), then re-run.')
  process.exit(1)
}
for (const key of REQUIRED_KEYS) process.env[key] = process.env[key] || env[key]

const {
  getStudentBrainOutputText,
  getTopByVelocityText,
  getTopByVolumeText,
  getRecentlyAddedText,
  getActiveMemoriesText,
  getPersistentMemoriesText,
  getDormantMemoriesText,
} = await import('../src/utils/student-brain.ts')

// [existing] ${studentBrainOutput} predates this script and is included as a
// baseline sanity check. The six [new] variables are what this script exists
// to verify — added together, so it's easy for one to be wired up and
// another to be silently missed.
const CHECKS = [
  { tag: 'existing', placeholder: 'studentBrainOutput', run: (topK) => getStudentBrainOutputText(topK) },
  { tag: 'new', placeholder: 'topByVelocity', run: (topK) => getTopByVelocityText(topK) },
  { tag: 'new', placeholder: 'topByVolume', run: (topK) => getTopByVolumeText(topK) },
  { tag: 'new', placeholder: 'recentlyAdded', run: (topK) => getRecentlyAddedText(topK) },
  { tag: 'new', placeholder: 'activeMemories', run: (topK) => getActiveMemoriesText(topK) },
  { tag: 'new', placeholder: 'persistentMemories', run: (topK) => getPersistentMemoriesText(topK) },
  { tag: 'new', placeholder: 'dormantMemories', run: (topK) => getDormantMemoriesText(topK) },
]

// The API returns its body as text, but it's JSON underneath (see the
// "verbatim JSON body" comment in student-brain.ts) — parse it so the report
// shows the actual posts/records retrieved, not an escaped JSON string.
const parseBody = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const results = []
for (const { tag, placeholder, run } of CHECKS) {
  const start = Date.now()
  try {
    const text = await run(TOP_K)
    results.push({
      tag,
      placeholder: `\${${placeholder}}`,
      status: 'ok',
      ms: Date.now() - start,
      chars: text.length,
      body: parseBody(text),
    })
  } catch (e) {
    results.push({
      tag,
      placeholder: `\${${placeholder}}`,
      status: 'fail',
      ms: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    })
  }
}

const failed = results.filter((r) => r.status === 'fail').length
const report = {
  ranAt: new Date().toISOString(),
  topK: TOP_K,
  total: results.length,
  passed: results.length - failed,
  failed,
  results,
}

const toText = (r) => {
  const lines = [
    `Student Brain variable test — ${r.ranAt}`,
    `topK=${r.topK}  total=${r.total}  passed=${r.passed}  failed=${r.failed}`,
    '',
  ]
  for (const row of r.results) {
    const label = `[${row.tag}] ${row.placeholder}`.padEnd(28)
    lines.push(
      row.status === 'ok'
        ? `${label} OK    ${row.ms}ms  ${row.chars} chars`
        : `${label} FAIL  ${row.ms}ms  ${row.error}`
    )
    if (row.status === 'ok') {
      const body = typeof row.body === 'string' ? row.body : JSON.stringify(row.body, null, 2)
      lines.push(body.split('\n').map((l) => `  ${l}`).join('\n'))
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
fs.writeFileSync(OUT_PATH, FORMAT === 'json' ? `${JSON.stringify(report, null, 2)}\n` : toText(report))

console.log(`${report.passed}/${report.total} passed — wrote ${FORMAT} report to ${path.relative(ROOT, OUT_PATH)}`)
process.exit(failed === 0 ? 0 : 1)
