#!/usr/bin/env node
// Joins Lydia's hearts to run files and prints the experiment's metrics:
// hearted / generated and hearted / survivors, per run, per arm, and per
// mechanism. Hearts live in the browser record; they reach this script as
// the run bundle copied from the page ("Copy this run as one document",
// whose joke lines start with "♥ HEARTED — "), a .json export of hearted
// jokes ([{caption}] or {hearted:[{caption}]}), or a .txt with one hearted
// caption per line. Jokes match on normalized text, so the same line hearted
// on any page counts wherever it appears.
//
//   node scripts/reaction-jokes-hearts.mjs --runs scripts/runs/a.json scripts/runs/b.json \
//     --hearts bundle.md [more files...]
//
// "Survivors" for a specialist-engine run are the set evaluator's excellent
// and strong verdicts (max 2 per moment, recorded by the runner). For a
// persona run they are the analogous filter: the old evaluator's excellent
// and strong ratings, best 2 per moment by score.
import fs from 'node:fs'

const args = process.argv.slice(2)
const after = (name) => { const i = args.indexOf(`--${name}`); if (i < 0) return []; const out = []; for (let k = i + 1; k < args.length && !args[k].startsWith('--'); k += 1) out.push(args[k]); return out }
const runFiles = after('runs'), heartFiles = after('hearts')
if (!runFiles.length || !heartFiles.length) { console.error('usage: --runs <run.json>... --hearts <bundle.md | hearts.json | hearts.txt>...'); process.exit(1) }

const norm = (s) => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
const hearts = new Set()
for (const f of heartFiles) {
  const text = fs.readFileSync(f, 'utf8')
  if (f.endsWith('.json')) {
    const j = JSON.parse(text)
    for (const h of Array.isArray(j) ? j : j.hearted ?? []) hearts.add(norm(h.caption ?? h))
  } else if (f.endsWith('.md')) {
    for (const m of text.matchAll(/♥ HEARTED — (.+)$/gm)) hearts.add(norm(m[1]))
  } else for (const line of text.split(/\r?\n/)) if (line.trim()) hearts.add(norm(line))
}
console.log(`${hearts.size} distinct hearted captions from ${heartFiles.length} file(s)\n`)

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '–')
const rows = []
for (const f of runFiles) {
  const run = JSON.parse(fs.readFileSync(f, 'utf8'))
  const arms = run.engine
    ? [[`${run.engine.mechanism} engine`, Object.values(run.jobs)]]
    : [['persona alone', Object.values(run.jobs)], ...(Object.keys(run.readJobs ?? {}).length ? [['persona + student read', Object.values(run.readJobs ?? {})]] : [])]
  for (const [arm, jobs] of arms) {
    let generated = 0, hearted = 0, survivors = 0, heartedSurvivors = 0
    const heartedLines = []
    for (const job of jobs) {
      const jokes = job.jokes ?? []
      const surv = new Set(run.engine
        ? job.survivors ?? []
        : jokes.map((_, k) => k).filter((k) => ['excellent', 'strong'].includes(job.evals?.[k]?.data?.rating)).sort((a, b) => (job.evals[b].data.score ?? 0) - (job.evals[a].data.score ?? 0)).slice(0, 2))
      jokes.forEach((joke, k) => {
        generated += 1
        const h = hearts.has(norm(joke))
        if (h) { hearted += 1; heartedLines.push(`${surv.has(k) ? 'survivor' : 'cut     '}  ${joke}`) }
        if (surv.has(k)) { survivors += 1; if (h) heartedSurvivors += 1 }
      })
    }
    rows.push({ file: f, arm, generated, hearted, survivors, heartedSurvivors, heartedLines })
  }
}
console.log('run file                                        arm                       generated hearted  hearted/gen  survivors hearted/surv')
for (const r of rows) console.log(`${r.file.padEnd(48)} ${r.arm.padEnd(25)} ${String(r.generated).padStart(9)} ${String(r.hearted).padStart(7)}  ${pct(r.hearted, r.generated).padStart(11)}  ${String(r.survivors).padStart(9)} ${pct(r.heartedSurvivors, r.survivors).padStart(12)}`)
for (const r of rows) if (r.heartedLines.length) { console.log(`\n${r.arm} (${r.file}): hearted jokes`); for (const l of r.heartedLines) console.log(`  ${l}`) }
