#!/usr/bin/env node
// Runs the event-native cast prompt (flavor 1559 step 1) once, live, against
// an off-domain fixture and checks the contract the page reads, then hands
// the top candidate to step 2 the way the page would and checks that too.
//
//   node scripts/check-event-native-cast.mjs [flavorId]      # default 1559
//
// The fixture has a clear power-holder (the parks board that shortened the
// season), an implementer, affected people, and a spinner, and none of it is
// a campus, so a campus noun in the output is provable leakage.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { callOpenAI, loadEnv, parseJsonLoose } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLAVOR = Number(process.argv[2] ?? 1559)

const env = loadEnv(ROOT)
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: steps, error } = await sb
  .from('humor_flavor_steps')
  .select('order_by, llm_system_prompt, llm_user_prompt, llm_model_id')
  .eq('humor_flavor_id', FLAVOR)
  .in('order_by', [1, 2])
  .order('order_by')
if (error || !steps || steps.length !== 2) {
  console.error('could not read steps 1 and 2:', error?.message ?? 'missing')
  process.exit(1)
}
const [s1, s2] = steps
const modelFor = async (id) =>
  (await sb.from('llm_models').select('provider_model_id').eq('id', id).single()).data.provider_model_id

const EVENT =
  'The town parks board voted to close the community pool two weeks early "to prioritize staff wellness," the same week it approved overtime for the same staff to run a private swim-club rental on the closed dates. Lifeguards now spend afternoons turning away families at a locked gate while a banner over the gate still says "Open Through Labor Day." The board chair posted that the pool "remains a community resource."'

const fill = (template, values) =>
  template.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole
  )

let failures = 0
const fail = (msg) => {
  failures += 1
  console.error(`FAIL  ${msg}`)
}
const pass = (msg) => console.log(`ok    ${msg}`)
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg))

// ---- step 1
const s1Filled = fill(s1.llm_user_prompt, { EVENT, EVENT_CONTEXT: 'None provided.' })
const unfilled = [...s1Filled.matchAll(/\{\{\s*([A-Z_]+)\s*\}\}/g)].map((m) => m[1])
if (unfilled.length) {
  console.error('step 1 still has unfilled placeholders:', unfilled.join(', '))
  process.exit(1)
}
const m1 = await modelFor(s1.llm_model_id)
console.log(`step 1: calling ${m1} for flavor ${FLAVOR}…`)
const t1 = Date.now()
const raw1 = await callOpenAI({
  apiKey: env.OPENAI_API_KEY,
  model: m1,
  systemPrompt: s1.llm_system_prompt || 'Return only JSON.',
  userPrompt: s1Filled,
  maxTokens: 60000,
  reasoningEffort: 'medium',
})
console.log(`step 1 returned in ${Math.round((Date.now() - t1) / 1000)}s, ${raw1.length} chars`)
const out1 = parseJsonLoose(raw1)
if (!out1) {
  console.error('step 1 did not return parseable JSON. Raw output:\n', raw1.slice(0, 4000))
  process.exit(1)
}

const SCORES = [
  'causal_relevance',
  'event_specificity',
  'comic_contradiction',
  'behavioral_runway',
  'target_clarity',
  'satirical_leverage',
]
const candidates = out1.candidates ?? []
const picks = out1.selected_personas ?? []
// The page must not mistake this for the premise-first shape.
expect(!Array.isArray(out1.ideas) && !Array.isArray(out1.personas), 'no `ideas`/`personas` tables (would be read as premise-first)')
expect(candidates.length >= 5, `candidates scored (${candidates.length})`)
expect(picks.length >= 3 && picks.length <= 10, `selected cast size sensible (${picks.length})`)
expect(
  picks.every((p) => Object.keys(p).every((k) => ['persona', 'source', 'why_this_persona_is_promising'].includes(k))),
  'selected_personas is a pick list of three fields'
)
const names = new Set(candidates.map((c) => c.persona))
expect(picks.every((p) => names.has(p.persona)), 'every pick names a candidates record verbatim')

let sumProblems = 0
let pathologyProblems = 0
let dirProblems = 0
const DIRS = new Set(['up', 'lateral', 'self', 'down'])
candidates.forEach((c) => {
  const sc = c.scores ?? {}
  const sum = SCORES.reduce((n, k) => n + (Number(sc[k]) || 0), 0)
  if (SCORES.some((k) => typeof sc[k] !== 'number') || sc.total_score !== sum) sumProblems += 1
  const p = c.persona_pathology
  if (!p || typeof p.wants !== 'string' || !Array.isArray(p.does_compulsively) || !p.does_compulsively.length || typeof p.would_never_admit !== 'string' || !('pretends' in p))
    pathologyProblems += 1
  if (!DIRS.has(c.punch_direction)) dirProblems += 1
})
expect(sumProblems === 0, `every total_score is the sum of six scores /18 (${sumProblems} wrong of ${candidates.length})`)
expect(pathologyProblems === 0, `every candidate carries a four-line pathology (${pathologyProblems} incomplete)`)
expect(dirProblems === 0, `every punch_direction is up|lateral|self|down (${dirProblems} bad)`)

const ph = out1.power_holder_check ?? {}
expect(typeof ph.power_holder === 'string' && ph.power_holder.trim(), `power-holder found (got "${ph.power_holder}")`)
expect(
  typeof ph.represented_by === 'string' && picks.some((p) => p.persona === ph.represented_by),
  `power-holder represented in the selected cast (got "${ph.represented_by}")`
)
const upOrSelf = picks
  .map((p) => candidates.find((c) => c.persona === p.persona))
  .filter((c) => c && (c.punch_direction === 'up' || c.punch_direction === 'self')).length
expect(upOrSelf >= 1, `at least one selected candidate punches up or self (${upOrSelf})`)
const downs = candidates.filter((c) => c.punch_direction === 'down').length
console.log(`      punch directions among candidates: ${['up', 'lateral', 'self', 'down'].map((d) => `${d} ${candidates.filter((c) => c.punch_direction === d).length}`).join(' · ')}`)
if (downs > candidates.length / 2) fail(`most candidates punch down (${downs} of ${candidates.length})`)

const leak = JSON.stringify(out1).match(/Columbia|Butler|Sidechat|Rousseau|campus/gi)
expect(!leak, `step 1 output carries no campus noun${leak ? ` (found ${[...new Set(leak)].join(', ')})` : ''}`)

picks.forEach((p) => {
  const c = candidates.find((x) => x.persona === p.persona) ?? {}
  console.log(`      · ${p.persona} [${c.category ?? '?'}] ${c.punch_direction ?? '?'} ${c.scores?.total_score ?? '?'}/18 — target: ${c.joke_target ?? '?'}`)
})

// ---- step 2 on the pick that represents the power-holder (or the first pick)
const chosenName = picks.some((p) => p.persona === ph.represented_by) ? ph.represented_by : picks[0]?.persona
const record = candidates.find((c) => c.persona === chosenName)
if (!record) {
  console.error('no candidate record to hand to step 2')
  process.exit(1)
}
// What the page hands step 2: the candidates record with the pick's fields on
// top and `likely_joke_target` filled from `joke_target`.
const pick = picks.find((p) => p.persona === chosenName) ?? {}
const { persona: personaName, ...context } = { ...record, ...pick, likely_joke_target: record.joke_target }
const s2Filled = fill(s2.llm_user_prompt, {
  EVENT,
  PERSONA: personaName,
  PERSONA_CONTEXT: JSON.stringify(context, null, 2),
})
const m2 = await modelFor(s2.llm_model_id)
console.log(`step 2: calling ${m2} for "${personaName}"…`)
const t2 = Date.now()
const raw2 = await callOpenAI({
  apiKey: env.OPENAI_API_KEY,
  model: m2,
  systemPrompt: s2.llm_system_prompt || 'Return only JSON.',
  userPrompt: s2Filled,
  maxTokens: 40000,
  reasoningEffort: 'high',
})
console.log(`step 2 returned in ${Math.round((Date.now() - t2) / 1000)}s`)
const out2 = parseJsonLoose(raw2)
if (!out2) {
  console.error('step 2 did not return parseable JSON. Raw output:\n', raw2.slice(0, 4000))
  process.exit(1)
}
const S2 = ['persona_specificity', 'event_specificity', 'comic_tension', 'naturalness', 'target_clarity', 'at_persona_expense']
const cands = out2.joke_candidates ?? []
expect(cands.length === 5, `five candidates (got ${cands.length})`)
const hasPretense = typeof record.persona_pathology?.pretends === 'string' && record.persona_pathology.pretends.trim()
if (hasPretense) expect(out2.comic_relationship?.comic_role === 'target', `step 2 comic_role is target for a persona with a pretense (got ${out2.comic_relationship?.comic_role})`)
let minProblems = 0
let behaviorProblems = 0
cands.forEach((c, i) => {
  const sc = c.scores ?? {}
  const present = S2.map((k) => sc[k]).filter((v) => typeof v === 'number')
  const min = present.length ? Math.min(...present) : NaN
  if (present.length !== 6 || sc.overall !== min) minProblems += 1
  if (!c.behavior) behaviorProblems += 1
  console.log(`      ${i + 1}. [${sc.overall ?? '?'}] ${c.caption}`)
})
expect(minProblems === 0, `every overall is the minimum of six scores (${minProblems} wrong)`)
expect(behaviorProblems === 0, `every candidate names a behavior (${behaviorProblems} missing)`)
const best = (out2.best?.best_caption ?? '').trim()
const bestEntry = cands.find((c) => (c.caption ?? '').trim() === best)
const maxOverall = Math.max(...cands.map((c) => Number(c.scores?.overall) || 0))
expect(bestEntry && Number(bestEntry.scores?.overall) === maxOverall, `best_caption has the highest overall`)
const leak2 = JSON.stringify(out2).match(/Columbia|Butler|Sidechat|Rousseau|sommelier|campus/gi)
expect(!leak2, `step 2 output carries no campus or illustration noun${leak2 ? ` (found ${[...new Set(leak2)].join(', ')})` : ''}`)

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
