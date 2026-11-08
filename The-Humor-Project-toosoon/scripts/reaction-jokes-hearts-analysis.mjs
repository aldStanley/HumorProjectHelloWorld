#!/usr/bin/env node
// Learn premise types from hearts (the last stage of the voice-first
// architecture, Lydia 2026-09-09): read one or more run files that carry
// analyses (job.analyses, from the page or reaction-jokes-run.mjs --analyze)
// and hearts (a `hearted` array: the past-runs page's "Download this run as
// JSON with its hearts", or a hand-added list), and report
//
//   1. which known comic moves appear most often, and among hearts,
//   2. which combinations of moves appear most often,
//   3. the heart rate per move (hearted / analyzed, jokes that use the move),
//   4. repeated unexplained moves among hearted jokes,
//   5. hearted jokes the analyzer could not explain (unknown primary move,
//      or an unexplained_move on a heart), and hearted jokes with no analysis.
//
// With --propose it also sends the hearted jokes' analyses to the newest
// docs/prompts/analyses/premise-discovery/ prompt, which proposes candidate
// premise types (three or more hearted examples each). Nothing is added to
// the catalog: the report is for Lydia to decide.
//
//   node scripts/reaction-jokes-hearts-analysis.mjs <run.json> [<run.json>...] [--propose] [--out report.md]
//
// A variant hearted from the refiner counts for the ORIGINAL joke's analysis
// (the premise is the same; the human chose a wording), and the report says
// which version was hearted.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { callOpenAI, loadEnv } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const files = args.filter((a) => !a.startsWith('--') && (args[args.indexOf(a) - 1] !== '--out'))
const propose = args.includes('--propose')
const outIndex = args.indexOf('--out')
const outFile = outIndex === -1 ? null : args[outIndex + 1]
if (!files.length) {
  console.error('usage: reaction-jokes-hearts-analysis.mjs <run.json> [...] [--propose] [--out report.md]')
  process.exit(1)
}

// The page's heart id (hearted-jokes.tsx heartId), so hearts match jokes.
const heartId = (persona, moment, caption) => {
  let h = 5381
  const s = `${persona}\n${moment}\n${caption}`
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `h${(h >>> 0).toString(36)}`
}

// ---- gather every analyzed joke, with its heart status
const rows = [] // { file, persona, moment, joke, analysis, hearted: null | 'original' | 'variant' | 'workshop' | 'both', heartedCaption }
const unanalyzedHearts = []
// Rewrites hearted from the workshop chat: what the editor asked for, and what she kept.
const workshopHearts = []
for (const file of files) {
  const run = JSON.parse(fs.readFileSync(file, 'utf8'))
  const hearted = Array.isArray(run.hearted) ? run.hearted : []
  const byId = new Map(hearted.map((h) => [h.id, h]))
  const seen = new Set()
  for (const record of [run.jobs ?? {}, run.readJobs ?? {}]) {
    for (const job of Object.values(record)) {
      if (job.status !== 'done') continue
      ;(job.jokes ?? []).forEach((joke, k) => {
        const a = job.analyses?.[k]
        const id = heartId(job.persona, job.moment, joke)
        seen.add(id)
        let heartedHow = byId.has(id) ? 'original' : null
        let heartedCaption = heartedHow ? joke : null
        for (const v of job.refinements?.[k]?.variants ?? []) {
          const vid = heartId(job.persona, job.moment, v.joke)
          seen.add(vid)
          if (byId.has(vid)) { heartedHow = heartedHow ? 'both' : 'variant'; heartedCaption = heartedCaption ?? v.joke }
        }
        // Workshop rewrites hearted from the chat carry refinedFrom = this joke.
        for (const h of hearted) {
          if ((h.origin === 'workshop' || h.origin === 'edit') && h.refinedFrom === joke && h.moment === job.moment) {
            seen.add(h.id)
            heartedHow = heartedHow ? 'both' : 'workshop'
            heartedCaption = heartedCaption ?? h.caption
            workshopHearts.push({ file, original: joke, caption: h.caption, note: h.origin === 'edit' ? 'edited by hand' : h.note, askedFor: h.askedFor, analysis: job.analyses?.[k]?.data ?? null })
          }
        }
        if (a?.status === 'done' && a.data) rows.push({ file, persona: job.persona, moment: job.moment, joke, analysis: a.data, hearted: heartedHow, heartedCaption })
        else if (heartedHow) unanalyzedHearts.push({ file, persona: job.persona, joke })
      })
    }
  }
  for (const h of hearted) if (!seen.has(h.id) && h.persona === run.personaName) unanalyzedHearts.push({ file, persona: h.persona, joke: h.caption, note: 'not in this run\'s jokes' })
}

const movesOf = (d) => [...new Set([d.primary_move, ...(d.supporting_moves ?? [])].filter((m) => m && m !== 'unknown'))]
const count = (list) => { const m = new Map(); for (const k of list) m.set(k, (m.get(k) ?? 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]) }
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '–')

const hearts = rows.filter((r) => r.hearted)
const L = []
L.push(`# Hearts analysis: ${rows.length} analyzed jokes, ${hearts.length} hearted, from ${files.length} run file${files.length === 1 ? '' : 's'}`)
L.push('')
L.push(`Files: ${files.join(', ')}`)
L.push('')
L.push(`Overall heart rate: ${hearts.length} of ${rows.length} (${pct(hearts.length, rows.length)}).`)
L.push('')

L.push('## 1. Which known comic moves appear most often')
L.push('')
L.push('| move | as primary | as any move | hearted jokes using it | heart rate |')
L.push('|---|---|---|---|---|')
const allMoves = [...new Set(rows.flatMap((r) => movesOf(r.analysis)))]
const moveStats = allMoves.map((m) => {
  const using = rows.filter((r) => movesOf(r.analysis).includes(m))
  const primary = rows.filter((r) => r.analysis.primary_move === m).length
  const h = using.filter((r) => r.hearted).length
  return { m, primary, any: using.length, h, rate: using.length ? h / using.length : 0 }
}).sort((a, b) => b.any - a.any)
for (const s of moveStats) L.push(`| ${s.m} | ${s.primary} | ${s.any} | ${s.h} | ${pct(s.h, s.any)} |`)
const unknownPrimary = rows.filter((r) => !r.analysis.primary_move || r.analysis.primary_move === 'unknown')
L.push(`| (unknown primary) | ${unknownPrimary.length} | | ${unknownPrimary.filter((r) => r.hearted).length} | ${pct(unknownPrimary.filter((r) => r.hearted).length, unknownPrimary.length)} |`)
L.push('')

L.push('## 2. Which combinations of moves appear most often')
L.push('')
L.push('| combination (primary + supporting) | jokes | hearted | heart rate |')
L.push('|---|---|---|---|')
const comboKey = (d) => [d.primary_move ?? 'unknown', ...(d.supporting_moves ?? []).slice().sort()].join(' + ')
for (const [combo, n] of count(rows.map((r) => comboKey(r.analysis))).slice(0, 15)) {
  const h = rows.filter((r) => comboKey(r.analysis) === combo && r.hearted).length
  L.push(`| ${combo} | ${n} | ${h} | ${pct(h, n)} |`)
}
L.push('')

L.push('## 3. Which moves have the highest heart rate (three or more jokes)')
L.push('')
for (const s of [...moveStats].filter((s) => s.any >= 3).sort((a, b) => b.rate - a.rate)) L.push(`- ${s.m}: ${s.h} of ${s.any} (${pct(s.h, s.any)})`)
L.push('')

L.push('## 4. Repeated unexplained moves among hearted jokes')
L.push('')
const unexplainedHearts = hearts.filter((r) => r.analysis.unexplained_move)
if (!unexplainedHearts.length) L.push('None: every hearted joke\'s moves were in the catalog.')
for (const r of unexplainedHearts) L.push(`- "${r.joke}"\n  - not in the catalog: ${r.analysis.unexplained_move}\n  - labeled: ${movesOf(r.analysis).join(', ') || 'nothing'}`)
L.push('')

L.push('## 5. Hearted jokes the analyzer could not explain')
L.push('')
const cannot = hearts.filter((r) => !r.analysis.primary_move || r.analysis.primary_move === 'unknown')
if (!cannot.length) L.push('None with an unknown primary move.')
for (const r of cannot) L.push(`- "${r.joke}" — premise: ${r.analysis.premise ?? '–'}${r.analysis.unexplained_move ? `; described as: ${r.analysis.unexplained_move}` : ''}`)
if (unanalyzedHearts.length) {
  L.push('')
  L.push(`Hearted but never analyzed (${unanalyzedHearts.length}):`)
  for (const r of unanalyzedHearts) L.push(`- ${r.persona}: "${r.joke}"${r.note ? ` (${r.note})` : ''}`)
}
L.push('')

L.push('## 6. Did the analyzer\'s action agree with the hearts?')
L.push('')
L.push('| action | jokes | hearted | heart rate |')
L.push('|---|---|---|---|')
for (const action of ['keep', 'refine_execution', 'reject']) {
  const n = rows.filter((r) => r.analysis.action === action)
  const h = n.filter((r) => r.hearted).length
  L.push(`| ${action} | ${n.length} | ${h} | ${pct(h, n.length)} |`)
}
const variantHearts = rows.filter((r) => r.hearted === 'variant' || r.hearted === 'workshop' || r.hearted === 'both')
L.push('')
L.push(`Refined jokes where a variant was hearted: ${variantHearts.length}${variantHearts.length ? ` (${variantHearts.filter((r) => r.hearted === 'variant').length} variant only, ${variantHearts.filter((r) => r.hearted === 'both').length} both original and variant)` : ''}.`)
for (const r of variantHearts) L.push(`- original: "${r.joke}" → hearted: "${r.heartedCaption}"`)
L.push('')

L.push('## 7. Workshop feedback: what the editor asked for, and what she hearted')
L.push('')
if (!workshopHearts.length) L.push('No rewrites hearted from the workshop chat in these files.')
for (const w of workshopHearts) {
  L.push(`- original: "${w.original}"${w.analysis ? ` (${[w.analysis.primary_move, ...(w.analysis.supporting_moves ?? [])].filter(Boolean).join(', ')}; analyzer said ${w.analysis.action ?? '?'})` : ''}`)
  if (w.askedFor) L.push(`  - asked for: ${w.askedFor.replace(/\s+/g, ' ').slice(0, 200)}`)
  L.push(`  - hearted: "${w.caption}"${w.note ? ` — ${w.note}` : ''}`)
}
L.push('')
// The asks, grouped by their first words, so a recurring direction shows.
const asks = count(workshopHearts.map((w) => (w.askedFor ?? '').toLowerCase().replace(/[^a-z ]/g, '').split(' ').slice(0, 4).join(' ')).filter(Boolean))
if (asks.length) { L.push('Recurring asks (first four words):'); for (const [a, n] of asks.slice(0, 10)) L.push(`- "${a}…": ${n}`); L.push('') }

L.push('## The hearted jokes, with their analyses')
L.push('')
for (const r of hearts) L.push(`- "${r.joke}"${r.hearted === 'variant' ? ` (hearted as the variant "${r.heartedCaption}")` : ''}\n  - premise: ${r.analysis.premise ?? '–'}\n  - moves: ${movesOf(r.analysis).join(', ') || 'unknown'}${r.analysis.unexplained_move ? `; not in the catalog: ${r.analysis.unexplained_move}` : ''}\n  - ${r.analysis.action ?? '?'}: premise ${r.analysis.premise_quality ?? '?'}, execution ${r.analysis.execution_quality ?? '?'}, legibility ${r.analysis.connection_legibility ?? '?'}`)
L.push('')

if (propose) {
  if (hearts.length < 3) L.push('## Proposed premise types\n\nFewer than three hearted analyzed jokes; nothing to propose from.')
  else {
    const env = loadEnv(ROOT)
    const dir = path.join(ROOT, 'docs/prompts/analyses/premise-discovery')
    const pfile = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !/^(readme|_)/i.test(f)).sort().pop()
    const cdir = path.join(ROOT, 'docs/prompts/analyses/comic-moves')
    const cfile = fs.readdirSync(cdir).filter((f) => f.endsWith('.md') && !/^(readme|_)/i.test(f)).sort().pop()
    const body = (t) => { const lines = t.split(/\r?\n/); const at = lines.findIndex((l) => /^# /.test(l)); return (at >= 0 ? lines.slice(at + 1) : lines).join('\n').trim() }
    const prompt = body(fs.readFileSync(path.join(dir, pfile), 'utf8'))
      .replace('{{COMIC_MOVES}}', body(fs.readFileSync(path.join(cdir, cfile), 'utf8')))
      .replace('{{HEARTED_ANALYSES}}', hearts.map((r) => JSON.stringify({ joke: r.joke, hearted_as: r.heartedCaption, premise: r.analysis.premise, primary_move: r.analysis.primary_move, supporting_moves: r.analysis.supporting_moves, unexplained_move: r.analysis.unexplained_move })).join('\n'))
    console.log(`proposing premise types from ${hearts.length} hearted jokes with ${pfile}…`)
    const out = await callOpenAI({ apiKey: env.OPENAI_API_KEY, model: 'gpt-5.6-sol', systemPrompt: 'Return only JSON.', userPrompt: prompt, maxTokens: 16000, reasoningEffort: 'high', retries: 2 })
    const text = typeof out === 'string' ? out : out?.text ?? JSON.stringify(out)
    let parsed = null
    try { const c = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''); parsed = JSON.parse(c.slice(c.indexOf('{'), c.lastIndexOf('}') + 1)) } catch {}
    L.push(`## Proposed premise types (from ${pfile}; nothing is added to the catalog automatically)`)
    L.push('')
    if (!parsed) { L.push('The proposal did not come back as readable JSON:'); L.push(''); L.push('```'); L.push(text); L.push('```') }
    else {
      const cands = (parsed.candidates ?? []).filter((c) => Array.isArray(c.examples) && c.examples.length >= 3)
      const dropped = (parsed.candidates ?? []).length - cands.length
      if (!cands.length) L.push('No candidate with three or more hearted examples.')
      for (const c of cands) {
        L.push(`### ${c.name}`)
        L.push('')
        L.push(c.mechanism ?? '')
        L.push('')
        for (const e of c.examples) L.push(`- ${hearts.some((r) => r.joke === e || r.heartedCaption === e) ? '' : '(NOT a hearted joke verbatim) '}"${e}"`)
        L.push('')
        L.push(`Why the existing types fall short: ${c.why_existing_types_fall_short ?? '–'}`)
        L.push('')
      }
      if (dropped) L.push(`${dropped} candidate${dropped === 1 ? '' : 's'} dropped for having fewer than three examples.`)
      if (parsed.unexplained_hearts?.length) { L.push(''); L.push('Hearted jokes the proposal could not explain:'); for (const e of parsed.unexplained_hearts) L.push(`- "${e}"`) }
    }
    L.push('')
  }
}

const report = L.join('\n')
if (outFile) { fs.writeFileSync(outFile, report); console.log(`wrote ${outFile}`) } else console.log(report)
