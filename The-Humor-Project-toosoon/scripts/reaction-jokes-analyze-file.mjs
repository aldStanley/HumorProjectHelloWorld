#!/usr/bin/env node
// Post-hoc analysis of an EXISTING run file (the page's own shape, e.g. one
// downloaded from the past-runs page with its hearts, or an export of the
// browser record): runs the analyzer (docs/prompts/reaction-jokes-s3-analyze.md,
// with the newest docs/prompts/analyses/comic-moves/ catalog) on every joke,
// and with --refine the refiner (reaction-jokes-s4-refine.md) on the jokes
// marked refine_execution. Writes job.analyses / job.refinements into a copy
// of the file. The jokes are never changed. Same rule-derived action as
// the page (joke-analysis.tsx ruleAction) and reaction-jokes-run.mjs.
//
//   node scripts/reaction-jokes-analyze-file.mjs <run.json> --persona 03-gigachad [--refine] [--effort high] [--out file]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { callOpenAI, loadEnv } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = loadEnv(ROOT)
const args = process.argv.slice(2)
const opt = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1] }
const flag = (name) => args.includes(`--${name}`)
const file = args.find((a) => !a.startsWith('--') && a.endsWith('.json'))
const personaFolder = opt('persona')
const refine = flag('refine')
const MODEL = 'gpt-5.6-sol'
const EFFORT = opt('effort', 'high')
const CONCURRENCY = 6
if (!file || !personaFolder) { console.error('usage: reaction-jokes-analyze-file.mjs <run.json> --persona <folder> [--refine] [--effort high] [--out file]'); process.exit(1) }

const loadPrompt = (f) => { const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/); const at = lines.findIndex((l) => /^# /.test(l)); return { file: path.relative(ROOT, f), name: at >= 0 ? lines[at].slice(2).trim().replace(/\s*\(.*\)\s*$/, '') : path.basename(f), text: (at >= 0 ? lines.slice(at + 1) : lines).join('\n').trim() } }
const newestIn = (dir) => { const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !/^(readme|_)/i.test(f)).sort(); return loadPrompt(path.join(dir, files[files.length - 1])) }
const persona = newestIn(path.join(ROOT, 'docs/prompts/personas', personaFolder))
const personaText = `${persona.name}\n\n${persona.text}`
const comicMoves = newestIn(path.join(ROOT, 'docs/prompts/analyses/comic-moves'))
const s3 = fs.readFileSync(path.join(ROOT, 'docs/prompts/reaction-jokes-s3-analyze.md'), 'utf8')
const s4 = refine ? fs.readFileSync(path.join(ROOT, 'docs/prompts/reaction-jokes-s4-refine.md'), 'utf8') : null
const run = JSON.parse(fs.readFileSync(file, 'utf8'))

const fill = (t, values) => t.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (w, n) => (n in values ? values[n] : w))
const parseJson = (s) => { const c = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''); const a = c.indexOf('{'), b = c.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(c.slice(a, b + 1)) } catch { return null } }
const readAsText = (d) => [['Event kernel', d.event_kernel], ['What students are doing', d.shared_behavior], ['Primary emotion', d.primary_emotion], ['Secondary emotion', d.secondary_emotion], ['What feels at stake', d.student_stake], ['The student thought behind it', d.social_logic], ['Recommended level of abstraction', d.recommended_abstraction], ['Shared signals', d.shared_signals], ['Social anchors a scrolling student recognizes', d.good_social_anchors], ['Incidental details (do not lean on these)', d.incidental_details], ['Not required context (readers may not know these)', d.avoid_as_required_context]].filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : v}`).join('\n')
const call = async (userPrompt, maxTokens) => { const startedAt = Date.now(); const out = await callOpenAI({ apiKey: env.OPENAI_API_KEY, model: MODEL, systemPrompt: 'Return only JSON.', userPrompt, maxTokens, reasoningEffort: EFFORT, retries: 2 }); return { out: typeof out === 'string' ? out : out?.text ?? JSON.stringify(out), durationMs: Date.now() - startedAt } }
async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) } })); return out }
const ruleAction = (d) => {
  if (!['excellent', 'good', 'weak', 'none'].includes(d.premise_quality)) return null
  if (d.premise_quality === 'weak' || d.premise_quality === 'none') return 'reject'
  if (!['excellent', 'good', 'weak'].includes(d.execution_quality)) return null
  if (!['immediate', 'slight_inference', 'hard_to_parse'].includes(d.connection_legibility)) return null
  return d.execution_quality === 'excellent' && d.connection_legibility === 'immediate' ? 'keep' : 'refine_execution'
}
const analyzeOne = async (job, i, k) => {
  const read = run.studentReads?.[i]?.data
  const sentPrompt = fill(s3, { PERSONA: personaText, MOMENT: job.moment, STUDENT_READ: read ? readAsText(read) : '(no student read for this moment)', JOKE: job.jokes[k], COMIC_MOVES: comicMoves.text })
  const left = sentPrompt.match(/\{\{[A-Z_]+\}\}/g)
  if (left) throw new Error(`unfilled placeholders in the analyzer: ${left.join(', ')}`)
  const meta = { model: MODEL, reasoningEffort: EFFORT, sentPrompt }
  let r
  try { r = await call(sentPrompt, 12000) } catch (err) { return { status: 'failed', error: String(err?.message ?? err), ...meta } }
  const data = parseJson(r.out)
  if (!data) return { status: 'failed', error: 'The analyzer did not return readable JSON.', raw: r.out, durationMs: r.durationMs, ...meta }
  data.supporting_moves = Array.isArray(data.supporting_moves) ? data.supporting_moves.map(String) : []
  for (const f of ['unexplained_move', 'specific_problem', 'preserve']) data[f] = data[f] ? String(data[f]) : null
  const rule = ruleAction(data)
  let backstop = null
  if (rule && data.action !== rule) { backstop = data.action ? `the analyzer said ${data.action}; the rule gives ${rule}` : `the analyzer gave no action; the rule gives ${rule}`; data.action = rule }
  return { status: 'done', data, backstop, raw: r.out, durationMs: r.durationMs, ...meta }
}
const refineOne = async (job, k, a) => {
  const d = a.data
  const sentPrompt = fill(s4, { PERSONA: personaText, MOMENT: job.moment, JOKE: job.jokes[k], PREMISE: d.premise ?? '', MOVES: [d.primary_move, ...(d.supporting_moves ?? [])].filter(Boolean).join(', ') || 'unknown', PROBLEM: d.specific_problem ?? '', PRESERVE: d.preserve ?? 'the premise and the anchor', COMIC_MOVES: comicMoves.text })
  const meta = { model: MODEL, reasoningEffort: EFFORT, sentPrompt }
  let r
  try { r = await call(sentPrompt, 12000) } catch (err) { return { status: 'failed', error: String(err?.message ?? err), ...meta } }
  const obj = parseJson(r.out)
  if (!obj || !Array.isArray(obj.variants)) return { status: 'failed', error: 'The refiner did not return readable JSON variants.', raw: r.out, durationMs: r.durationMs, ...meta }
  const seen = new Set([job.jokes[k].trim()]); const variants = []
  for (const v of obj.variants) { const joke = (typeof v === 'string' ? v : v?.joke ?? '').trim(); if (!joke || seen.has(joke)) continue; seen.add(joke); variants.push({ joke, fix: typeof v?.fix === 'string' ? v.fix : undefined }); if (variants.length === 3) break }
  return { status: 'done', variants, raw: r.out, durationMs: r.durationMs, ...meta }
}

const targets = []
for (const record of [run.jobs ?? {}, run.readJobs ?? {}]) for (const [i, job] of Object.entries(record)) if (job.status === 'done') for (let k = 0; k < (job.jokes ?? []).length; k += 1) targets.push([job, +i, k])
console.log(`analyzing ${targets.length} jokes from ${file} with ${persona.file} and ${comicMoves.file} at ${EFFORT} effort…`)
const t1 = Date.now()
const results = await pool(targets, CONCURRENCY, ([job, i, k]) => analyzeOne(job, i, k))
targets.forEach(([job, , k], n) => { job.analyses ??= {}; job.analyses[k] = results[n]; job.comicMovesFile = comicMoves.file })
const done = results.filter((a) => a.status === 'done')
const byAction = {}
for (const a of done) byAction[a.data.action] = (byAction[a.data.action] ?? 0) + 1
console.log(`analyzed: ${done.length} of ${targets.length} in ${Math.round((Date.now() - t1) / 1000)}s — ${Object.entries(byAction).map(([k, v]) => `${v} ${k}`).join(', ')}${results.length - done.length ? `, ${results.length - done.length} failed` : ''}`)
if (refine) {
  const marked = targets.filter(([job, , k]) => job.analyses[k].status === 'done' && job.analyses[k].data.action === 'refine_execution')
  const t2 = Date.now()
  const refined = await pool(marked, CONCURRENCY, ([job, , k]) => refineOne(job, k, job.analyses[k]))
  marked.forEach(([job, , k], n) => { job.refinements ??= {}; job.refinements[k] = refined[n] })
  console.log(`refined: ${refined.filter((r) => r.status === 'done').length} of ${marked.length}, ${refined.reduce((n, r) => n + (r.variants?.length ?? 0), 0)} variants, in ${Math.round((Date.now() - t2) / 1000)}s`)
}
run.note = `${run.note ?? ''}${run.note ? ' — ' : ''}analyzed ${new Date().toISOString().slice(0, 10)} with docs/prompts/reaction-jokes-s3-analyze.md and ${comicMoves.file}${refine ? ', refined with docs/prompts/reaction-jokes-s4-refine.md' : ''}, on ${MODEL} at ${EFFORT} effort`
const out = opt('out', file.replace(/\.json$/, '-analyzed.json'))
fs.writeFileSync(out, JSON.stringify(run, null, 2))
console.log(`wrote ${out}. Import it on the past-runs page.`)
