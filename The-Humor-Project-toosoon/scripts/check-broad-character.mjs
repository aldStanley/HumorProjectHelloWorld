#!/usr/bin/env node
// Runs the broad-character reaction-meme prompts (flavor 1560) once, live,
// against an off-domain fixture and checks the contract the page reads.
//
//   node scripts/check-broad-character.mjs [flavorId]      # default 1560
//
// The fixture is the town pool with a clear responsible actor, and the
// supplied character is the town itself, defined the way the page's default
// library defines its broad character. Nothing is a campus or an airline
// (the prompts' illustrations), so either noun in the output is leakage.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { callOpenAI, loadEnv, parseJsonLoose } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLAVOR = Number(process.argv[2] ?? 1560)

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

const PERSONAS = `* the Town
  - wants: to keep control of the pool while appearing reasonable, normal, and family-friendly
  - pretends: nothing has changed; every closure is ordinary parks administration
  - does compulsively: renames the obvious problem, calmly doubles down, posts polished explanations, treats complaints as a messaging problem
  - would never admit: the families' blunt description is more accurate than the board's
  - comic emotion: serene municipal confidence while padlocking a public pool
  - best joke behavior: denial, euphemism, doubling down, proudly presenting the problem as the solution
  - emotional palette: smug denial → "actually…" correction; cheerful rebranding → proudly unveiling; casual doubling down → pressing the same button again; caught-but-unbothered → zero embarrassment`

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
const words = (t) => (t ?? '').trim().split(/\s+/).filter(Boolean).length

// ---- step 1
const s1Filled = fill(s1.llm_user_prompt, { EVENT, EVENT_CONTEXT: 'None provided.', PERSONAS })
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
  maxTokens: 30000,
  reasoningEffort: 'medium',
})
console.log(`step 1 returned in ${Math.round((Date.now() - t1) / 1000)}s, ${raw1.length} chars`)
const out1 = parseJsonLoose(raw1)
if (!out1) {
  console.error('step 1 did not return parseable JSON. Raw output:\n', raw1.slice(0, 4000))
  process.exit(1)
}

const S1 = ['mockability', 'event_specificity', 'one_idea_one_attitude', 'gif_ability', 'target_clarity']
const candidates = out1.candidates ?? []
const picks = out1.selected_personas ?? []
expect(!Array.isArray(out1.ideas) && !Array.isArray(out1.personas), 'no `ideas`/`personas` tables (would be read as premise-first)')
expect(candidates.length >= 1 && candidates.length <= 4, `a small candidate set (${candidates.length})`)
expect(picks.length >= 1 && picks.length <= 3, `one to three picks (${picks.length})`)
expect(
  picks.every((p) => Object.keys(p).every((k) => ['persona', 'source', 'why_this_persona_is_promising'].includes(k))),
  'selected_personas is a pick list of three fields'
)
const names = new Set(candidates.map((c) => c.persona))
expect(picks.every((p) => names.has(p.persona)), 'every pick names a candidates record verbatim')
const town = candidates.find((c) => /town/i.test(c.persona ?? ''))
expect(Boolean(town), 'the supplied character was used')
if (town) {
  expect(town.source === 'recurring_trope', `supplied character is source recurring_trope (got ${town.source})`)
  expect(
    (town.persona_pathology?.pretends ?? '').includes('nothing has changed'),
    'supplied pathology copied, not rewritten'
  )
}
let sumProblems = 0
let paletteProblems = 0
let lengthProblems = 0
candidates.forEach((c) => {
  const sc = c.scores ?? {}
  const sum = S1.reduce((n, k) => n + (Number(sc[k]) || 0), 0)
  if (S1.some((k) => typeof sc[k] !== 'number') || sc.total_score !== sum) sumProblems += 1
  const pal = c.emotional_palette ?? []
  if (pal.length < 4 || pal.length > 5 || pal.some((e) => !e.reaction || !e.gif_emotion)) paletteProblems += 1
  if (!c.comic_emotion || !c.reusable_engine || !(c.manifestations ?? []).length) lengthProblems += 1
})
expect(sumProblems === 0, `every total_score is the sum of five scores /15 (${sumProblems} wrong)`)
expect(paletteProblems === 0, `every palette has 4-5 reactions each with a gif_emotion (${paletteProblems} bad)`)
expect(lengthProblems === 0, `every candidate has comic_emotion, reusable_engine, manifestations (${lengthProblems} missing)`)
const leak = JSON.stringify(out1).match(/Columbia|Butler|Sidechat|campus|airline|flight/gi)
expect(!leak, `step 1 output carries no campus or illustration noun${leak ? ` (found ${[...new Set(leak)].join(', ')})` : ''}`)
picks.forEach((p) => {
  const c = candidates.find((x) => x.persona === p.persona) ?? {}
  console.log(`      · ${p.persona} ${c.scores?.total_score ?? '?'}/15 — ${c.comic_emotion ?? '?'}`)
  ;(c.emotional_palette ?? []).forEach((e) => console.log(`          ${e.reaction} → ${e.gif_emotion}`))
})

// ---- step 2 on the first pick
const chosen = picks[0]?.persona
const record = candidates.find((c) => c.persona === chosen)
if (!record) {
  console.error('no candidate record to hand to step 2')
  process.exit(1)
}
const { persona: personaName, ...context } = { ...record, ...picks[0], likely_joke_target: record.joke_target }
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
  maxTokens: 30000,
  reasoningEffort: 'high',
})
console.log(`step 2 returned in ${Math.round((Date.now() - t2) / 1000)}s`)
const out2 = parseJsonLoose(raw2)
if (!out2) {
  console.error('step 2 did not return parseable JSON. Raw output:\n', raw2.slice(0, 4000))
  process.exit(1)
}
// The punchy step 2: kernel first, six scores, GIF chosen after the joke.
const S2 = ['punch', 'compression', 'event_specificity', 'target_clarity', 'naturalness', 'gif_ability']
const cands = out2.joke_candidates ?? []
const kernels = out2.humor_engine?.comic_kernels ?? out2.kernels ?? []
expect(cands.length === 5, `five captions (got ${cands.length})`)
expect(kernels.length >= 8 && kernels.length <= 12, `8-12 kernels considered (${kernels.length})`)
expect(kernels.every((k) => words(k) <= 8), 'every kernel is at most 8 words')
const nameCore = personaName.replace(/^the\s+/i, '').split(/\s+/)[0]
let named = 0
let minProblems = 0
let long = 0
const ideas = new Set()
cands.forEach((c, i) => {
  if (new RegExp(nameCore, 'i').test(c.caption ?? '')) named += 1
  const sc = c.scores ?? {}
  const present = S2.map((k) => sc[k]).filter((v) => typeof v === 'number')
  const min = present.length ? Math.min(...present) : NaN
  if (present.length !== 6 || sc.overall !== min) minProblems += 1
  if (words(c.caption) > 18) long += 1
  ideas.add((c.kernel ?? c.angle_name ?? '').toLowerCase().trim())
  console.log(`      ${i + 1}. [${sc.overall ?? '?'} · punch ${sc.punch ?? '?'} · gif ${sc.gif_ability ?? '?'} · ${words(c.caption)}w] ${c.caption}`)
  console.log(`         kernel: ${c.kernel ?? c.angle_name ?? '?'} · GIF: ${c.image_situation ?? '?'}`)
})
console.log(`      captions naming the character: ${named} of 5 (the prompt says usually, not always)`)
expect(minProblems === 0, `every overall is the minimum of six scores (${minProblems} wrong)`)
expect(long === 0, `every caption is at most 18 words (${long} longer)`)
expect(ideas.size === 5, `five distinct kernels (${ideas.size})`)
expect(cands.every((c) => kernels.includes(c.kernel ?? c.angle_name)), 'every caption names a kernel from the list')
const best = (out2.best?.best_caption ?? '').trim()
const bestEntry = cands.find((c) => (c.caption ?? '').trim() === best)
const maxOverall = Math.max(...cands.map((c) => Number(c.scores?.overall) || 0))
expect(bestEntry && Number(bestEntry.scores?.overall) === maxOverall, 'best_caption is verbatim and has the highest overall')
const leak2 = JSON.stringify(out2).match(/Columbia|Butler|Sidechat|campus|airline|flight|schedule-enhanced|47 synonyms/gi)
expect(!leak2, `step 2 output carries no campus or illustration wording${leak2 ? ` (found ${[...new Set(leak2)].join(', ')})` : ''}`)

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
