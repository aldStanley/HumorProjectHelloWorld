#!/usr/bin/env node
// Runs the persona-pays POV prompts (flavor 1558) once, live, against an
// off-domain fixture and checks the contract the surface renders. Prose in a
// prompt is not a guarantee; this is the guarantee.
//
//   node scripts/check-persona-pays.mjs [flavorId]      # default 1558
//
// The fixture is a pool on the last hot day of summer with two personas: one
// with a pretense (must pay), one plain functional role with pretends: null
// (may be a straight man). Neither is campus, so any campus noun in the
// output is provable leakage from the prompt's own text.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { callOpenAI, loadEnv, parseJsonLoose } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLAVOR = Number(process.argv[2] ?? 1558)

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
const { data: model } = await sb
  .from('llm_models')
  .select('provider_model_id')
  .eq('id', s1.llm_model_id)
  .single()

const EVENT =
  'The town pool announced it closes for the season on Monday. A heat advisory is out for the same weekend, the snack bar sold out of ice cream by noon on Saturday, and the sign-up sheet for the last adult swim already has a waitlist.'

const PERSONAS = `* the wannabe lifeguard captain
  - wants: to be the one everyone looks at when the whistle blows
  - pretends: the pool would fall apart without his crowd-control system
  - does compulsively (and pays for): blows the whistle at kids who are already walking, re-laminates the rules sign, narrates capacity counts to nobody
  - would never admit: the manager gave him the chair nearest the parking lot on purpose
* the snack bar clerk
  - wants: to get through the shift
  - pretends: null
  - does compulsively (and pays for): points at the sold-out sign, restocks napkins
  - would never admit: nothing`

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
const s1Filled = fill(s1.llm_user_prompt, {
  EVENT,
  EVENT_CONTEXT: 'None provided.',
  PERSONAS,
})
if (/\{\{[A-Z_]+\}\}/.test(s1Filled)) {
  console.error('step 1 still has an unfilled placeholder')
  process.exit(1)
}
console.log(`step 1: calling ${model.provider_model_id} for flavor ${FLAVOR}…`)
const t1 = Date.now()
const raw1 = await callOpenAI({
  apiKey: env.OPENAI_API_KEY,
  model: model.provider_model_id,
  systemPrompt: s1.llm_system_prompt || 'Return only JSON.',
  userPrompt: s1Filled,
  maxTokens: 60000,
  reasoningEffort: 'medium',
})
console.log(`step 1 returned in ${Math.round((Date.now() - t1) / 1000)}s`)
const out1 = parseJsonLoose(raw1)
if (!out1) {
  console.error('step 1 did not return parseable JSON. Raw output:\n', raw1.slice(0, 4000))
  process.exit(1)
}

const S1_SCORES = [
  'trigger_strength',
  'persona_specificity',
  'event_specificity',
  'comic_transformation',
  'joke_runway',
  'expense_fit',
]
const evals = out1.recurring_persona_evaluations ?? []
expect(evals.length === 2, `step 1 evaluated both library personas (got ${evals.length})`)

const byName = (list, needle) =>
  (list ?? []).find((p) => (p.persona ?? '').toLowerCase().includes(needle))
const captain = byName(evals, 'captain')
const clerk = byName(evals, 'clerk')

// The library is not echoed: a library persona's persona_pathology is null in
// every array and the page attaches the supplied lines by name. The PRETENDS
// RULE is still applied from the supplied entry.
if (captain) {
  expect(
    captain.persona_pathology == null,
    `captain: persona_pathology is null for a library persona (got ${JSON.stringify(captain.persona_pathology)?.slice(0, 60)})`
  )
  expect(captain.persona === 'the wannabe lifeguard captain', `captain: library name copied verbatim (got "${captain.persona}")`)
  expect(captain.comic_role === 'target', `captain: comic_role is target (got ${captain.comic_role})`)
  expect(
    /captain|lifeguard/i.test(captain.who_pays?.entity ?? ''),
    `captain: who_pays.entity names the persona (got "${captain.who_pays?.entity}")`
  )
} else fail('captain missing from recurring_persona_evaluations')

if (clerk) {
  expect(clerk.persona_pathology == null, 'clerk: persona_pathology is null for a library persona')
  expect(clerk.comic_role !== 'target' || /clerk/i.test(clerk.who_pays?.entity ?? ''), `clerk: with pretends null the role is free (got ${clerk.comic_role})`)
} else fail('clerk missing from recurring_persona_evaluations')

// The roster is a pick list joined back to the evaluation record by the page.
const PICK_KEYS = ['persona', 'source', 'persona_pathology', 'why_this_persona_is_promising']
const picks = out1.selected_personas ?? []
const evalNames = new Set(
  [...evals, ...(out1.event_native_personas ?? []), ...(out1.narrow_lens_personas ?? [])].map((p) => p.persona)
)
expect(
  picks.length > 0 && picks.every((p) => Object.keys(p).every((k) => PICK_KEYS.includes(k))),
  `selected_personas carries only ${PICK_KEYS.join(', ')} (${picks.length} picks)`
)
expect(
  picks.every((p) => evalNames.has(p.persona)),
  'every pick names an evaluation record verbatim'
)
expect(
  picks.filter((p) => p.source === 'recurring_trope').every((p) => p.persona_pathology == null) &&
    picks.filter((p) => p.source !== 'recurring_trope').every((p) => p.persona_pathology && typeof p.persona_pathology === 'object'),
  'picks: pathology null for library personas, an object for discovered ones'
)

const allPersonas = [
  ...evals,
  ...(out1.event_native_personas ?? []),
  ...(out1.narrow_lens_personas ?? []),
  ...(out1.selected_personas ?? []),
]
let sumProblems = 0
let pretendsRuleProblems = 0
let contrastOnly = 0
const LIBRARY_PRETENDS = { 'the wannabe lifeguard captain': 'the pool would fall apart', 'the snack bar clerk': null }
const scoredPersonas = allPersonas.filter((p) => p.scores)
scoredPersonas.forEach((p) => {
  const scores = p.scores ?? {}
  const sum = S1_SCORES.reduce((n, key) => n + (Number(scores[key]) || 0), 0)
  if (typeof scores.expense_fit !== 'number' || scores.total_fit_score !== sum) sumProblems += 1
  const pretends =
    p.persona in LIBRARY_PRETENDS ? LIBRARY_PRETENDS[p.persona] : p.persona_pathology?.pretends
  if (typeof pretends === 'string' && pretends.trim()) {
    const named = (p.who_pays?.entity ?? '').toLowerCase()
    const persona = (p.persona ?? '').toLowerCase()
    const firstWord = persona.replace(/^the\s+/, '').split(/\s+/)[0] ?? ''
    if (p.comic_role !== 'target' || !(firstWord && named.includes(firstWord))) {
      pretendsRuleProblems += 1
      console.error(
        `      ${p.persona}: pretends set but comic_role=${p.comic_role}, who_pays="${p.who_pays?.entity}"`
      )
    }
  }
  const c = (p.comic_contradiction ?? '').toLowerCase()
  if (/everyone else sees/.test(c) && !/while|want|block|cost/.test(c)) contrastOnly += 1
})
expect(sumProblems === 0, `every total_fit_score is the sum of six scores incl. expense_fit (${sumProblems} wrong of ${scoredPersonas.length})`)
expect(pretendsRuleProblems === 0, `PRETENDS RULE holds on every persona with a pretense (${pretendsRuleProblems} violations)`)
expect(contrastOnly === 0, `no comic_contradiction is a bare "everyone else sees" contrast (${contrastOnly} found)`)

const leak = JSON.stringify(out1).match(/sommelier|gas station|screw-top|Columbia|Butler|Sidechat/gi)
expect(!leak, `step 1 output carries no illustration or campus noun${leak ? ` (found ${[...new Set(leak)].join(', ')})` : ''}`)

// ---- step 2 on the persona with a pretense
const pick = byName(out1.selected_personas, 'captain')
if (!captain) {
  console.error('no captain entry to hand to step 2')
  process.exit(1)
}
// What the page hands step 2: the evaluation record, the pick's fields on top,
// and the library's four lines attached.
const selected = {
  ...captain,
  ...(pick ?? {}),
  persona_pathology: {
    wants: 'to be the one everyone looks at when the whistle blows',
    pretends: 'the pool would fall apart without his crowd-control system',
    does_compulsively: [
      'blows the whistle at kids who are already walking',
      're-laminates the rules sign',
      'narrates capacity counts to nobody',
    ],
    would_never_admit: 'the manager gave him the chair nearest the parking lot on purpose',
  },
}
const { persona: personaName, ...context } = selected
const s2Filled = fill(s2.llm_user_prompt, {
  EVENT,
  PERSONA: personaName,
  PERSONA_CONTEXT: JSON.stringify(context, null, 2),
})
if (/\{\{[A-Z_]+\}\}/.test(s2Filled)) {
  console.error('step 2 still has an unfilled placeholder')
  process.exit(1)
}
const { data: model2 } = await sb
  .from('llm_models')
  .select('provider_model_id')
  .eq('id', s2.llm_model_id)
  .single()
console.log(`step 2: calling ${model2.provider_model_id} for "${personaName}"…`)
const t2 = Date.now()
const raw2 = await callOpenAI({
  apiKey: env.OPENAI_API_KEY,
  model: model2.provider_model_id,
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

const S2_SCORES = [
  'persona_specificity',
  'event_specificity',
  'comic_tension',
  'naturalness',
  'target_clarity',
  'at_persona_expense',
]
expect(out2.comic_relationship?.comic_role === 'target', `step 2 comic_role is target (got ${out2.comic_relationship?.comic_role})`)
const candidates = out2.joke_candidates ?? []
expect(candidates.length === 5, `five candidates (got ${candidates.length})`)

let minProblems = 0
let behaviorProblems = 0
let whoPaysProblems = 0
let feelingWords = 0
const FEELING = /\b(anxious|anxiety|smug|sad|insecure|jealous|nervous|desperate)\b/i
candidates.forEach((c, i) => {
  const scores = c.scores ?? {}
  const present = S2_SCORES.map((k) => scores[k]).filter((v) => typeof v === 'number')
  const min = present.length ? Math.min(...present) : NaN
  if (present.length !== 6 || scores.overall !== min) {
    minProblems += 1
    console.error(`      candidate ${i + 1}: overall ${scores.overall} but the six min to ${min} (${present.length} present)`)
  }
  if (!c.behavior || typeof c.behavior !== 'string') behaviorProblems += 1
  if (!c.who_pays || !/captain|lifeguard|\bme\b|\bhim\b|\bhis\b/i.test(c.who_pays)) {
    whoPaysProblems += 1
    console.error(`      candidate ${i + 1}: who_pays="${c.who_pays}"`)
  }
  if (FEELING.test(c.caption ?? '')) feelingWords += 1
  console.log(`      ${i + 1}. [${scores.overall ?? '?'}] ${c.caption}`)
  console.log(`         main-verb/expense ${scores.at_persona_expense ?? '?'} · weakest: ${c.weakest_check ?? '—'}`)
})
expect(minProblems === 0, `every overall is the minimum of six scores (${minProblems} wrong)`)
expect(behaviorProblems === 0, `every candidate names a behavior (${behaviorProblems} missing)`)
expect(whoPaysProblems === 0, `every candidate's who_pays names the persona (${whoPaysProblems} do not)`)
expect(feelingWords === 0, `no caption states a feeling word (${feelingWords} do)`)

const bestCaption = (out2.best?.best_caption ?? '').trim()
const bestEntry = candidates.find((c) => (c.caption ?? '').trim() === bestCaption)
const maxOverall = Math.max(...candidates.map((c) => Number(c.scores?.overall) || 0))
expect(Boolean(bestEntry), 'best_caption is one of the five, verbatim')
expect(
  bestEntry && Number(bestEntry.scores?.overall) === maxOverall,
  `best_caption has the highest overall (${bestEntry?.scores?.overall} vs max ${maxOverall})`
)
expect(out2.best?.best_overall === maxOverall, `best_overall equals that maximum (got ${out2.best?.best_overall})`)

const leak2 = JSON.stringify(out2).match(/sommelier|gas station|screw-top|Columbia|Butler|Sidechat|Rousseau/gi)
expect(!leak2, `step 2 output carries no illustration or campus noun${leak2 ? ` (found ${[...new Set(leak2)].join(', ')})` : ''}`)

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
