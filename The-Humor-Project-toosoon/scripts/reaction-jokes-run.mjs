#!/usr/bin/env node
// Runs the Reaction Joke Maker's pipeline from the command line and writes
// the result as ONE PAST RUN in the page's own record shape, so it can be
// imported on /humor-flavor/<id>/reaction-jokes/history ("Bring in a run
// from a file") and then brought back to the working page like any run.
//
//   node scripts/reaction-jokes-run.mjs --persona 03-gigachad --moments moments.json \
//     [--count 15] [--evaluate] [--step2] [--effort high] [--out scripts/runs/<name>.json]
//     [--persona-file <md>] [--s2 <md>] [--skip-step1] [--analyze] [--refine]
//
// Specialist engine (one comic mechanism, its own generator and set
// evaluator under docs/prompts/engines/<engine>/{generator,evaluator}/):
//
//   node scripts/reaction-jokes-run.mjs --engine gigachad-power-reversal --moments moments.json \
//     [--count 8] [--evaluate] [--effort high] [--out scripts/runs/<name>.json]
//
// An engine's generator is a whole prompt ({{MOMENT}}, {{JOKE_COUNT}}), not a
// persona wrapped by reaction-jokes-s1.md, and it returns JSON candidates
// with the premise stated plainly: every field but "joke" is the premise
// (status_value_inversion: event_truth, status_axis, gigachad_flip; the
// first power_reversal version had relationship, reversal). The fields are
// stored per candidate in job.premises and shown to the evaluator as given.
// The evaluator judges the whole SET in one call ({{EVENT}}, {{CANDIDATES}})
// and returns capped verdicts (max 2 excellent, 2 strong, 2 possible), never
// a 0-100 score; the score stored per joke is derived from verdict and rank
// so the page can sort. Code backstops: a repeated premise is flagged
// duplicate_premise, and a joke the evaluator says breaks a real system's
// mechanics (world_mechanics_preserved: no) cannot stay excellent or strong,
// and a joke whose status_consequence (evaluator version c) is not
// concrete_event_native cannot be excellent: concrete_but_generic caps at
// strong, abstract_value_assertion at possible, none is rejected. Runs judged
// by an evaluator without status_consequence are left alone.
// --step2 is ignored for engines: a specialist sees the raw moment only.
//
// moments.json: [{ "text": "...", "step2": true }, ...] — step2 on a moment
// runs the Student Read and then step 2 (persona + read) for it as well as
// step 1. --evaluate scores every joke with the persona's newest evaluator.
// Prompts are read from the files (newest dated version per folder) and the
// step prompts from the files in docs/prompts/, the same text the page
// pushes to the flavor. Model: gpt-5.6-sol at high reasoning effort, like the
// page (--effort low|medium|high overrides). Both are recorded in the run
// file, at the top and on every job, read, and evaluation.
// Reproducing an old run: --persona-file names one persona version instead
// of the newest, --s2 names a step 2 template file instead of
// docs/prompts/reaction-jokes-s2.md, and --skip-step1 runs only step 2
// (persona + read), as the page's "re-run from the persona and the student
// read" does. All three are recorded in the run's note.
// Post-hoc analysis (flavor 1564's steps 3 and 4, from the files in
// docs/prompts/): --analyze runs reaction-jokes-s3-analyze.md on every joke
// (premise, multi-label comic moves from the newest
// docs/prompts/analyses/comic-moves/ catalog, premise vs execution, action
// by the rule in code), and --refine runs reaction-jokes-s4-refine.md on
// the jokes marked refine_execution. Stored per joke as job.analyses and
// job.refinements, the page's own shape, so the run imports as is.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { callOpenAI, loadEnv } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = loadEnv(ROOT)
const args = process.argv.slice(2)
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const flag = (name) => args.includes(`--${name}`)
const personaFolder = opt('persona')
const engineFolder = opt('engine')
const momentsFile = opt('moments')
const count = Number.parseInt(opt('count', '15'), 10)
const evaluate = flag('evaluate')
let withStep2 = flag('step2')
const personaFile = opt('persona-file')
const s2File = opt('s2')
const skipStep1 = flag('skip-step1')
const analyze = flag('analyze') || flag('refine')
const refine = flag('refine')
if (skipStep1 && !withStep2) { console.error('--skip-step1 needs --step2, or nothing runs'); process.exit(1) }
const MODEL = 'gpt-5.6-sol'
const EFFORT = opt('effort', 'high')
if (!['low', 'medium', 'high'].includes(EFFORT)) { console.error('--effort must be low, medium, or high'); process.exit(1) }
if ((!personaFolder && !engineFolder) || (personaFolder && engineFolder) || !momentsFile) {
  console.error('usage: --persona <folder under docs/prompts/personas> | --engine <folder under docs/prompts/engines>, plus --moments <json> [--count N] [--evaluate] [--step2] [--out file]')
  process.exit(1)
}
const CONCURRENCY = 6
// max_completion_tokens INCLUDES reasoning on GPT-5 models; at high effort
// an 8,000 budget came back empty, so each is a multiple of the answer's size.
const JOKES_BUDGET = 24000
const READ_BUDGET = 12000
const EVAL_BUDGET = 12000
const SET_EVAL_BUDGET = 24000

// ---- prompt files, newest version per folder (same rule as the page)
const loadPrompt = (file, versions = 1) => {
  const raw = fs.readFileSync(file, 'utf8')
  const lines = raw.split(/\r?\n/)
  const at = lines.findIndex((l) => /^# /.test(l))
  const name = at >= 0 ? lines[at].slice(2).trim().replace(/\s*\(.*\)\s*$/, '') : path.basename(file)
  return { file: path.relative(ROOT, file), name, text: (at >= 0 ? lines.slice(at + 1) : lines).join('\n').trim(), versions }
}
const newestIn = (dir) => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !/^(readme|_)/i.test(f)).sort()
  const file = files[files.length - 1]
  if (!file) throw new Error(`no prompt file in ${dir}`)
  return loadPrompt(path.join(dir, file), files.length)
}
let persona, personaText = '', evaluator = null, engine = null
if (engineFolder) {
  const gen = newestIn(path.join(ROOT, 'docs/prompts/engines', engineFolder, 'generator'))
  const mechanism = gen.text.match(/^Mechanism:\s*(\S+)\s*$/m)?.[1] ?? engineFolder
  persona = { ...gen, text: gen.text.replace(/^Mechanism:.*\n?/m, '').trim() }
  const evaluatorDir = path.join(ROOT, 'docs/prompts/engines', engineFolder, 'evaluator')
  evaluator = evaluate && fs.existsSync(evaluatorDir) ? newestIn(evaluatorDir) : null
  if (evaluate && !evaluator) console.warn(`no evaluator folder for engine ${engineFolder}; candidates will not be judged`)
  engine = { folder: engineFolder, mechanism, generatorFile: gen.file, evaluatorFile: evaluator?.file ?? null }
  if (withStep2) { console.warn('--step2 is ignored with --engine: a specialist sees the raw moment only'); withStep2 = false }
} else {
  persona = personaFile ? loadPrompt(path.resolve(ROOT, personaFile)) : newestIn(path.join(ROOT, 'docs/prompts/personas', personaFolder))
  personaText = `${persona.name}\n\n${persona.text}`
  const evaluatorDir = path.join(ROOT, 'docs/prompts/evaluators', personaFolder)
  evaluator = evaluate && fs.existsSync(evaluatorDir) ? newestIn(evaluatorDir) : null
  if (evaluate && !evaluator) console.warn(`no evaluator folder for ${personaFolder}; jokes will not be scored`)
}
const studentRead = newestIn(path.join(ROOT, 'docs/prompts/analyses/student-read'))
const s1 = fs.readFileSync(path.join(ROOT, 'docs/prompts/reaction-jokes-s1.md'), 'utf8')
const s2 = fs.readFileSync(s2File ? path.resolve(ROOT, s2File) : path.join(ROOT, 'docs/prompts/reaction-jokes-s2.md'), 'utf8')
const s3 = analyze ? fs.readFileSync(path.join(ROOT, 'docs/prompts/reaction-jokes-s3-analyze.md'), 'utf8') : null
const s4 = refine ? fs.readFileSync(path.join(ROOT, 'docs/prompts/reaction-jokes-s4-refine.md'), 'utf8') : null
const comicMoves = analyze ? newestIn(path.join(ROOT, 'docs/prompts/analyses/comic-moves')) : null
const ANALYSIS_BUDGET = 12000
const REFINE_BUDGET = 12000
const moments = JSON.parse(fs.readFileSync(momentsFile, 'utf8'))

// ---- helpers mirroring the page
const txt = (o) => (typeof o === 'string' ? o : o?.text ?? JSON.stringify(o))
const fill = (t, values) => t.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (w, n) => (n in values ? values[n] : w))
const parseJokes = (raw) => raw.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter((l) => l && !l.startsWith('```'))
const parseJsonArray = (s) => { const c = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''); const a = c.indexOf('['), b = c.lastIndexOf(']'); if (a < 0 || b <= a) return null; try { const v = JSON.parse(c.slice(a, b + 1)); return Array.isArray(v) ? v : null } catch { return null } }
const norm = (s) => String(s ?? '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
// The premise is every string field of a candidate except the joke; the
// last of them (gigachad_flip, or reversal in the first version) is the
// comic move, the key the duplicate check uses.
const premiseOf = (c) => Object.fromEntries(Object.entries(c).filter(([k, v]) => k !== 'joke' && typeof v === 'string').map(([k, v]) => [k, v.trim()]))
const moveOf = (p) => { const v = Object.values(p); return v[v.length - 1] ?? '' }
const parseJson = (s) => { const c = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''); const a = c.indexOf('{'), b = c.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(c.slice(a, b + 1)) } catch { return null } }
const readAsText = (d) => [
  ['Event kernel', d.event_kernel], ['What students are doing', d.shared_behavior], ['Primary emotion', d.primary_emotion], ['Secondary emotion', d.secondary_emotion], ['What feels at stake', d.student_stake], ['The student thought behind it', d.social_logic], ['Recommended level of abstraction', d.recommended_abstraction], ['Shared signals', d.shared_signals], ['Social anchors a scrolling student recognizes', d.good_social_anchors], ['Incidental details (do not lean on these)', d.incidental_details], ['Not required context (readers may not know these)', d.avoid_as_required_context],
].filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('; ') : v}`).join('\n')
const call = async (userPrompt, systemPrompt, maxTokens) => {
  const startedAt = Date.now()
  const out = txt(await callOpenAI({ apiKey: env.OPENAI_API_KEY, model: MODEL, systemPrompt, userPrompt, maxTokens, reasoningEffort: EFFORT, retries: 2 }))
  return { out, durationMs: Date.now() - startedAt, finishedAt: new Date().toISOString() }
}
async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) } })); return out }

// ---- the run
const t0 = Date.now()
const studentReads = {}
if (withStep2) {
  await pool(moments.map((m, i) => [m, i]).filter(([m]) => m.step2), CONCURRENCY, async ([m, i]) => {
    const sentPrompt = fill(studentRead.text, { EVENT: m.text })
    const meta = { promptFile: studentRead.file, model: MODEL, reasoningEffort: EFFORT }
    let r
    try { r = await call(sentPrompt, 'Return only JSON.', READ_BUDGET) } catch (err) {
      studentReads[i] = { moment: m.text, status: 'failed', error: String(err?.message ?? err), sentPrompt, ...meta }
      return
    }
    const data = parseJson(r.out)
    studentReads[i] = data
      ? { moment: m.text, status: 'done', data, raw: r.out, sentPrompt, durationMs: r.durationMs, finishedAt: r.finishedAt, ...meta }
      : { moment: m.text, status: 'failed', error: 'The analysis did not return readable JSON.', raw: r.out, sentPrompt, durationMs: r.durationMs, finishedAt: r.finishedAt, ...meta }
  })
  console.log(`student reads: ${Object.keys(studentReads).length}`)
}
// A specialist engine: its whole prompt, JSON candidates with the premise
// stated, and the two code backstops recorded per candidate.
const genEngine = async (i, m) => {
  const sentPrompt = fill(persona.text, { MOMENT: m.text, JOKE_COUNT: String(count) })
  const left = sentPrompt.match(/\{\{[A-Z_]+\}\}/g)
  if (left) throw new Error(`unfilled placeholders in the engine generator: ${left.join(', ')}`)
  const base = { moment: m.text, persona: persona.name, source: 'persona', mechanism: engine.mechanism, engine: engine.folder, generatorFile: engine.generatorFile, sentPrompt, model: MODEL, reasoningEffort: EFFORT }
  let r
  try { r = await call(sentPrompt, 'Return only JSON.', JOKES_BUDGET) } catch (err) {
    console.warn(`  engine for moment ${i + 1} failed: ${err?.message ?? err}`)
    return { ...base, status: 'failed', error: String(err?.message ?? err) }
  }
  const arr = parseJsonArray(r.out)
  // No-irony exit (latent_irony engine): {"found": false, "reason": ...} is a
  // finished job with zero candidates, not a failure. The set evaluator skips it.
  if (!arr) {
    const obj = parseJson(r.out)
    if (obj && obj.found === false) return { ...base, status: 'done', jokes: [], premises: [], backstop: [], noCandidates: String(obj.reason ?? 'no latent irony found'), raw: r.out, durationMs: r.durationMs, finishedAt: r.finishedAt }
  }
  const candidates = (arr ?? []).filter((c) => c && typeof c.joke === 'string' && c.joke.trim()).map((c) => ({ premise: premiseOf(c), joke: c.joke.trim() }))
  if (!candidates.length) return { ...base, status: 'failed', error: 'The generator did not return readable JSON candidates.', raw: r.out, durationMs: r.durationMs, finishedAt: r.finishedAt }
  const seen = new Map()
  const backstop = candidates.map((c, k) => {
    const flags = []
    const key = norm(moveOf(c.premise))
    if (key && seen.has(key)) flags.push('duplicate_premise'); else if (key) seen.set(key, k)
    return flags
  })
  return { ...base, status: 'done', jokes: candidates.map((c) => c.joke), premises: candidates.map((c) => c.premise), backstop, raw: r.out, durationMs: r.durationMs, finishedAt: r.finishedAt }
}
const genOne = async (source, i, m) => {
  if (engine) return genEngine(i, m)
  const template = source === 'persona' ? s1 : s2
  const values = { PERSONA: personaText, MOMENT: m.text, JOKE_COUNT: String(count) }
  if (source === 'persona-read') values.STUDENT_READ = studentReads[i]?.data ? readAsText(studentReads[i].data) : ''
  const sentPrompt = fill(template, values)
  const left = sentPrompt.match(/\{\{[A-Z_]+\}\}/g)
  if (left) throw new Error(`unfilled placeholders in ${source}: ${left.join(', ')}`)
  let r
  try { r = await call(sentPrompt, '', JOKES_BUDGET) } catch (err) {
    console.warn(`  ${source} for moment ${i + 1} failed: ${err?.message ?? err}`)
    return { moment: m.text, persona: persona.name, source, status: 'failed', error: String(err?.message ?? err), sentPrompt, model: MODEL, reasoningEffort: EFFORT }
  }
  return { moment: m.text, persona: persona.name, source, status: 'done', jokes: parseJokes(r.out), raw: r.out, sentPrompt, durationMs: r.durationMs, finishedAt: r.finishedAt, model: MODEL, reasoningEffort: EFFORT }
}
const tasks = moments.flatMap((m, i) => [...(skipStep1 ? [] : [['persona', i, m]]), ...(withStep2 && m.step2 && studentReads[i]?.data ? [['persona-read', i, m]] : [])])
if (withStep2) for (const [i, r] of Object.entries(studentReads)) if (r.status === 'failed') console.warn(`  student read for moment ${+i + 1} failed: ${r.error}`)
const generated = await pool(tasks, CONCURRENCY, ([source, i, m]) => genOne(source, i, m).then((job) => [source, i, job]))
const jobs = {}, readJobs = {}
for (const [source, i, job] of generated) (source === 'persona' ? jobs : readJobs)[i] = job

// ---- post-hoc analysis, one call per joke; then refinement of the marked ones
// The analyzer's section 6 as code, the same rule as the page's
// joke-analysis.tsx: reject a weak premise, keep only when nothing is left
// to fix, refine the rest. The model's own action is kept as `backstop`
// when it disagrees.
const ruleAction = (d) => {
  if (!['excellent', 'good', 'weak', 'none'].includes(d.premise_quality)) return null
  if (d.premise_quality === 'weak' || d.premise_quality === 'none') return 'reject'
  if (!['excellent', 'good', 'weak'].includes(d.execution_quality)) return null
  if (!['immediate', 'slight_inference', 'hard_to_parse'].includes(d.connection_legibility)) return null
  return d.execution_quality === 'excellent' && d.connection_legibility === 'immediate' ? 'keep' : 'refine_execution'
}
const analyzeOne = async (job, i, k) => {
  const sentPrompt = fill(s3, {
    PERSONA: personaText,
    MOMENT: job.moment,
    STUDENT_READ: studentReads[i]?.data ? readAsText(studentReads[i].data) : '(no student read for this moment)',
    JOKE: job.jokes[k],
    COMIC_MOVES: comicMoves.text,
  })
  const left = sentPrompt.match(/\{\{[A-Z_]+\}\}/g)
  if (left) throw new Error(`unfilled placeholders in the analyzer: ${left.join(', ')}`)
  const meta = { model: MODEL, reasoningEffort: EFFORT, sentPrompt }
  let r
  try { r = await call(sentPrompt, 'Return only JSON.', ANALYSIS_BUDGET) } catch (err) { return { status: 'failed', error: String(err?.message ?? err), ...meta } }
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
  const sentPrompt = fill(s4, {
    PERSONA: personaText,
    MOMENT: job.moment,
    JOKE: job.jokes[k],
    PREMISE: d.premise ?? '',
    MOVES: [d.primary_move, ...(d.supporting_moves ?? [])].filter(Boolean).join(', ') || 'unknown',
    PROBLEM: d.specific_problem ?? '',
    PRESERVE: d.preserve ?? 'the premise and the anchor',
    COMIC_MOVES: comicMoves.text,
  })
  const meta = { model: MODEL, reasoningEffort: EFFORT, sentPrompt }
  let r
  try { r = await call(sentPrompt, 'Return only JSON.', REFINE_BUDGET) } catch (err) { return { status: 'failed', error: String(err?.message ?? err), ...meta } }
  const obj = parseJson(r.out)
  if (!obj || !Array.isArray(obj.variants)) return { status: 'failed', error: 'The refiner did not return readable JSON variants.', raw: r.out, durationMs: r.durationMs, ...meta }
  const seen = new Set([job.jokes[k].trim()])
  const variants = []
  for (const v of obj.variants) {
    const joke = (typeof v === 'string' ? v : v?.joke ?? '').trim()
    if (!joke || seen.has(joke)) continue
    seen.add(joke)
    variants.push({ joke, fix: typeof v?.fix === 'string' ? v.fix : undefined })
    if (variants.length === 3) break
  }
  return { status: 'done', variants, raw: r.out, durationMs: r.durationMs, ...meta }
}
if (analyze && !engine) {
  const targets = []
  for (const record of [jobs, readJobs]) for (const [i, job] of Object.entries(record)) if (job.status === 'done') for (let k = 0; k < job.jokes.length; k += 1) targets.push([job, +i, k])
  const t1 = Date.now()
  const results = await pool(targets, CONCURRENCY, ([job, i, k]) => analyzeOne(job, i, k))
  targets.forEach(([job, , k], n) => { job.analyses ??= {}; job.analyses[k] = results[n]; job.comicMovesFile = comicMoves.file })
  const done = results.filter((a) => a.status === 'done')
  const byAction = {}
  for (const a of done) byAction[a.data.action] = (byAction[a.data.action] ?? 0) + 1
  console.log(`analyzed: ${done.length} of ${targets.length} jokes in ${Math.round((Date.now() - t1) / 1000)}s — ${Object.entries(byAction).map(([k, v]) => `${v} ${k}`).join(', ')}${results.length - done.length ? `, ${results.length - done.length} failed` : ''}`)
  if (refine) {
    const marked = targets.filter(([job, , k]) => job.analyses[k].status === 'done' && job.analyses[k].data.action === 'refine_execution')
    const t2 = Date.now()
    const refined = await pool(marked, CONCURRENCY, ([job, , k]) => refineOne(job, k, job.analyses[k]))
    marked.forEach(([job, , k], n) => { job.refinements ??= {}; job.refinements[k] = refined[n] })
    console.log(`refined: ${refined.filter((r) => r.status === 'done').length} of ${marked.length} marked jokes, ${refined.reduce((n, r) => n + (r.variants?.length ?? 0), 0)} variants, in ${Math.round((Date.now() - t2) / 1000)}s`)
  }
}
console.log(`jokes: ${Object.values(jobs).reduce((n, j) => n + (j.jokes?.length ?? 0), 0)} from the persona, ${Object.values(readJobs).reduce((n, j) => n + (j.jokes?.length ?? 0), 0)} with the read, in ${Math.round((Date.now() - t0) / 1000)}s`)

if (evaluator && engine) {
  // One call per moment: the evaluator ranks the whole set. Verdict caps and
  // the backstops are enforced here, in code, whatever the model returned.
  const TIERS = ['excellent', 'strong', 'possible', 'reject']
  const BASE = { excellent: 96, strong: 86, possible: 76, reject: 50 }
  const todo = Object.values(jobs).filter((job) => job.status === 'done' && job.jokes?.length)
  await pool(todo, CONCURRENCY, async (job) => {
    job.evals = {}
    job.evaluatorFile = evaluator.file
    const candidatesText = job.jokes.map((joke, k) => [`${k + 1}.`, ...Object.entries(job.premises[k] ?? {}).map(([f, v]) => `${f}: ${v}`), `joke: ${joke}`].join('\n')).join('\n\n')
    const sentPrompt = fill(evaluator.text, { EVENT: job.moment, CANDIDATES: candidatesText })
    const meta = { model: MODEL, reasoningEffort: EFFORT }
    let r
    try { r = await call(sentPrompt, 'Return only JSON.', SET_EVAL_BUDGET) } catch (err) {
      job.setEval = { status: 'failed', error: String(err?.message ?? err), sentPrompt, ...meta }
      job.jokes.forEach((_, k) => { job.evals[k] = { status: 'failed', error: 'The set evaluation failed.', ...meta } })
      return
    }
    const ranked = parseJson(r.out)?.ranked
    if (!Array.isArray(ranked)) {
      job.setEval = { status: 'failed', error: 'The evaluator did not return readable JSON.', raw: r.out, sentPrompt, durationMs: r.durationMs, ...meta }
      job.jokes.forEach((_, k) => { job.evals[k] = { status: 'failed', error: 'The set evaluation did not return readable JSON.', ...meta } })
      return
    }
    // Map each ranked entry back to a candidate: by its index, else by text.
    const used = new Set()
    const resolved = []
    for (const e of ranked) {
      let k = Number.parseInt(e?.index, 10) - 1
      if (!(k >= 0 && k < job.jokes.length && !used.has(k) && norm(job.jokes[k]) === norm(e.joke))) {
        k = job.jokes.findIndex((j, i) => !used.has(i) && norm(j) === norm(e?.joke))
        if (k < 0) k = Number.parseInt(e?.index, 10) - 1
      }
      if (!(k >= 0 && k < job.jokes.length) || used.has(k)) continue
      used.add(k)
      resolved.push([k, e])
    }
    const counts = {}
    const survivors = []
    resolved.forEach(([k, e], pos) => {
      const flags = [...new Set([...(Array.isArray(e.failure_flags) ? e.failure_flags : []).filter((f) => f && f !== 'none'), ...(job.backstop?.[k] ?? [])])]
      let v = TIERS.includes(e.verdict) ? e.verdict : 'reject'
      if ((v === 'excellent' || v === 'strong') && String(e.world_mechanics_preserved ?? '').toLowerCase() === 'no') { v = 'possible'; if (!flags.includes('false_world_mechanics')) flags.push('false_world_mechanics'); flags.push('capped_by_world_mechanics') }
      // latent_irony evaluator: an imported or absent irony, or no persona
      // ownership, is a reject whatever verdict the model wrote.
      const ic = String(e.irony_connection ?? '').toLowerCase()
      if ((ic === 'imported' || ic === 'none') && v !== 'reject') { v = 'reject'; flags.push('capped_by_irony_connection'); const fl = ic === 'imported' ? 'imported_reference' : 'no_latent_irony'; if (!flags.includes(fl)) flags.push(fl) }
      if (String(e.gigachad_ownership ?? '').toLowerCase() === 'none' && v !== 'reject') { v = 'reject'; flags.push('capped_by_ownership'); if (!flags.includes('clever_observation_not_gigachad')) flags.push('clever_observation_not_gigachad') }
      // adversity_as_advantage evaluator: a generic shell or cruelty is a reject.
      if (String(e.benefit_specificity ?? '').toLowerCase() === 'generic_shell' && v !== 'reject') { v = 'reject'; flags.push('capped_by_benefit_specificity'); if (!flags.includes('generic_motivational_slogan')) flags.push('generic_motivational_slogan') }
      if (String(e.sincerity ?? '').toLowerCase() === 'cruel' && v !== 'reject') { v = 'reject'; flags.push('capped_by_sincerity'); if (!flags.includes('cruelty')) flags.push('cruelty') }
      const sc = String(e.status_consequence ?? '').toLowerCase()
      if (sc && sc !== 'concrete_event_native') {
        const cap = sc === 'concrete_but_generic' ? 'strong' : sc === 'abstract_value_assertion' ? 'possible' : sc === 'none' ? 'reject' : 'strong'
        if (TIERS.indexOf(v) < TIERS.indexOf(cap)) { v = cap; flags.push('capped_by_status_consequence') }
        if (sc === 'abstract_value_assertion' && !flags.includes('abstract_value_assertion')) flags.push('abstract_value_assertion')
      }
      while (v !== 'reject' && (counts[v] ?? 0) >= 2) { v = TIERS[TIERS.indexOf(v) + 1]; if (!flags.includes('demoted_by_tier_cap')) flags.push('demoted_by_tier_cap') }
      counts[v] = (counts[v] ?? 0) + 1
      if ((v === 'excellent' || v === 'strong') && survivors.length < 2) survivors.push(k)
      job.evals[k] = {
        status: 'done',
        data: {
          joke: job.jokes[k],
          // The declared premise, then every judgment field the evaluator
          // returned, whichever version of the evaluator wrote it.
          analysis: {
            rank: String(pos + 1),
            evaluator_verdict: String(e.verdict ?? ''),
            ...Object.fromEntries(Object.entries(job.premises[k] ?? {}).map(([f, v]) => [`declared_${f}`, v])),
            ...Object.fromEntries(Object.entries(e).filter(([f, v]) => !['index', 'joke', 'verdict', 'failure_flags', 'reason'].includes(f) && (typeof v === 'string' || typeof v === 'number')).map(([f, v]) => [f, String(v)])),
            score_note: 'The verdict is the judgment. The score is derived from verdict and rank so the page can sort.',
          },
          score: BASE[v] - (counts[v] - 1),
          rating: v,
          reason: String(e.reason ?? ''),
          failure_flags: flags,
        },
        durationMs: r.durationMs,
        ...meta,
      }
    })
    job.jokes.forEach((_, k) => { if (!used.has(k)) job.evals[k] = { status: 'failed', error: 'The evaluator did not rank this candidate.', ...meta } })
    job.survivors = survivors
    job.setEval = { status: 'done', raw: r.out, sentPrompt, durationMs: r.durationMs, counts, ...meta }
  })
  const tally = todo.reduce((t, j) => { for (const [k, n] of Object.entries(j.setEval?.counts ?? {})) t[k] = (t[k] ?? 0) + n; return t }, {})
  console.log(`judged ${todo.length} sets with ${evaluator.file}: ${['excellent', 'strong', 'possible', 'reject'].map((k) => `${k} ${tally[k] ?? 0}`).join(', ')}; survivors ${todo.reduce((n, j) => n + (j.survivors?.length ?? 0), 0)}; total ${Math.round((Date.now() - t0) / 1000)}s`)
} else if (evaluator) {
  const evalTasks = [...Object.values(jobs), ...Object.values(readJobs)].flatMap((job) => (job.jokes ?? []).map((joke, k) => [job, k, joke]))
  await pool(evalTasks, CONCURRENCY + 2, async ([job, k, joke]) => {
    job.evals ??= {}
    job.evaluatorFile = evaluator.file
    let r
    try { r = await call(fill(evaluator.text, { EVENT: job.moment, JOKE: joke }), 'Return only JSON.', EVAL_BUDGET) } catch (err) {
      job.evals[k] = { status: 'failed', error: String(err?.message ?? err), model: MODEL, reasoningEffort: EFFORT }
      return
    }
    const data = parseJson(r.out)
    job.evals[k] = data ? { status: 'done', data, raw: r.out, durationMs: r.durationMs, model: MODEL, reasoningEffort: EFFORT } : { status: 'failed', error: 'The evaluator did not return readable JSON.', raw: r.out, durationMs: r.durationMs, model: MODEL, reasoningEffort: EFFORT }
  })
  console.log(`scored ${evalTasks.length} jokes with ${evaluator.file}; total ${Math.round((Date.now() - t0) / 1000)}s`)
}

const run = {
  id: `${Date.now().toString(36)}-cli`,
  personaName: persona.name,
  moments: moments.map((m) => m.text),
  jobs,
  readJobs,
  studentReads,
  archivedAt: new Date().toISOString(),
  engine: engine ?? undefined,
  note: `run from the command line (scripts/reaction-jokes-run.mjs) with ${engine ? `the ${engine.mechanism} engine, ` : ''}${persona.file}${evaluator ? ` and ${evaluator.file}` : ''}${s2File ? `, step 2 template ${s2File}` : ''}${skipStep1 ? ', step 2 only' : ''}${analyze ? `, analyzed with docs/prompts/reaction-jokes-s3-analyze.md and ${comicMoves.file}` : ''}${refine ? ' and refined with docs/prompts/reaction-jokes-s4-refine.md' : ''}, on ${MODEL} at ${EFFORT} effort`,
  jokeCount: count,
  model: MODEL,
  reasoningEffort: EFFORT,
}
const out = opt('out', path.join('scripts/runs', `${engineFolder ?? personaFolder}-${new Date().toISOString().slice(0, 10)}.json`))
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(run, null, 2))
console.log(`wrote ${out} (${Math.round(fs.statSync(out).size / 1024)} KB). Import it on the past-runs page.`)
