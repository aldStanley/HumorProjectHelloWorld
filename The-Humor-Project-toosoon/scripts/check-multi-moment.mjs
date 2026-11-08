#!/usr/bin/env node
// Runs the one-POV-every-moment step 1 (flavor 1561) once, live, on TWO
// off-domain events with one supplied character, and checks the contract the
// page reads: exactly that character, a `per_event` entry per numbered event
// in order with an integer fit 0-3 and a why, best_reactions verbatim from
// the palette. Then runs step 2 for event 2
// only, with the merged context the page builds, and checks the captions
// are about event 2 and not event 1.
//
//   node scripts/check-multi-moment.mjs [flavorId]   # default 1561
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { callOpenAI, loadEnv, parseJsonLoose } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLAVOR = Number(process.argv[2] ?? 1561)
const env = loadEnv(ROOT)
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: steps } = await sb
  .from('humor_flavor_steps')
  .select('order_by, llm_system_prompt, llm_user_prompt, llm_model_id')
  .eq('humor_flavor_id', FLAVOR)
  .in('order_by', [1, 2])
  .order('order_by')
const [s1, s2] = steps ?? []
if (!s1 || !s2) {
  console.error('missing steps')
  process.exit(1)
}
const modelFor = async (id) =>
  (await sb.from('llm_models').select('provider_model_id').eq('id', id).single()).data.provider_model_id

const MOMENTS = [
  'The town parks board voted to close the community pool two weeks early "to prioritize staff wellness," the same week it approved overtime for the same staff to run a private swim-club rental on the closed dates. A banner over the locked gate still says "Open Through Labor Day."',
  'The same town replaced the free Saturday farmers market parking with $20 "event parking," then posted that the market "remains free to attend." Vendors report half the usual shoppers; the town says attendance is "evolving."',
  // A moment the Town had no hand in, so the fit should be low and the
  // deficit should say what is missing (the character is not the actor).
  'A bakery on Main Street won the state fair\'s blue ribbon for its sour-cherry pie; the line on Saturday morning went around the block and the owner sold out by 10 a.m.',
]
// What the page sends: a numbered list.
const EVENT = MOMENTS.map((m, i) => `${i + 1}. ${m}`).join('\n\n')
const PERSONAS = `* the Town
  - wants: to keep control of public space while appearing reasonable, normal, and family-friendly
  - pretends: nothing has changed; every closure or fee is ordinary administration
  - does compulsively: renames the obvious problem, calmly doubles down, posts polished explanations, treats complaints as a messaging problem
  - would never admit: the residents' blunt description is more accurate than the board's
  - comic emotion: serene municipal confidence while padlocking the public
  - best joke behavior: denial, euphemism, doubling down, proudly presenting the problem as the solution
  - emotional palette: smug denial → "actually…" correction; cheerful rebranding → proudly unveiling; casual doubling down → pressing the same button again; caught-but-unbothered → zero embarrassment`

const fill = (t, v) => t.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (w, n) => (n in v ? v[n] : w))
let failures = 0
const expect = (c, m) => (c ? console.log(`ok    ${m}`) : (failures += 1, console.error(`FAIL  ${m}`)))

const s1Filled = fill(s1.llm_user_prompt, { EVENT, EVENT_CONTEXT: 'None provided.', PERSONAS })
const m1 = await modelFor(s1.llm_model_id)
console.log(`step 1: ${m1} on ${MOMENTS.length} moments…`)
let t = Date.now()
const raw1 = await callOpenAI({ apiKey: env.OPENAI_API_KEY, model: m1, systemPrompt: s1.llm_system_prompt || 'Return only JSON.', userPrompt: s1Filled, maxTokens: 30000, reasoningEffort: 'medium' })
console.log(`returned in ${Math.round((Date.now() - t) / 1000)}s`)
const out1 = parseJsonLoose(raw1)
if (!out1) {
  console.error('step 1 not JSON:\n', raw1.slice(0, 2000))
  process.exit(1)
}
const candidates = out1.candidates ?? []
const picks = out1.selected_personas ?? []
expect(candidates.length === 1 && picks.length === 1, `exactly one candidate and one pick (${candidates.length}, ${picks.length})`)
const town = candidates.find((c) => /town/i.test(c.persona ?? ''))
expect(Boolean(town), 'the supplied character was used')
candidates.forEach((c) => {
  const pe = c.per_event ?? []
  const nums = pe.map((e) => Number(e.event))
  expect((pe[2]?.fits ?? 3) <= 1, `${c.persona}: the bakery moment scores 0 or 1 (got ${pe[2]?.fits})`)
  expect(pe.length === MOMENTS.length && nums.every((n, i) => n === i + 1), `${c.persona}: per_event has one entry per event in order (${JSON.stringify(nums)})`)
  const palette = new Set((c.emotional_palette ?? []).map((e) => e.reaction))
  expect(pe.every((e) => (e.best_reactions ?? []).length && e.best_reactions.every((r) => palette.has(r))), `${c.persona}: best_reactions verbatim from the palette`)
  expect(pe.every((e) => e.joke_target && e.trigger_feature && (e.manifestations ?? []).length), `${c.persona}: every per_event entry has target, trigger, manifestations`)
  expect(pe.every((e) => Number.isInteger(e.fits) && e.fits >= 0 && e.fits <= 3 && typeof e.why_it_fits === 'string' && e.why_it_fits.length), `${c.persona}: every per_event entry has an integer fits 0-3 and a why_it_fits`)
  const CHECKS = ['distinctive_detail', 'character_is_actor', 'pathology_on_display']
  expect(pe.every((e) => Array.isArray(e.fit_checks) && e.fit_checks.length === 3 && e.fit_checks.every((k, i) => k.check === CHECKS[i] && typeof k.passes === 'boolean' && typeof k.reason === 'string' && k.reason.length)), `${c.persona}: every per_event entry has the three named checks in order, each with passes and a reason`)
  expect(pe.every((e) => e.fits === (e.fit_checks ?? []).filter((k) => k.passes).length), `${c.persona}: fits equals the number of checks that pass`)
  expect(pe[2]?.fit_checks?.find((k) => k.check === 'character_is_actor')?.passes === false, `${c.persona}: the bakery moment fails character_is_actor`)
  pe.forEach((e) => (e.fit_checks ?? []).forEach((k) => console.log(`      event ${e.event} ${k.passes ? '✓' : '✗'} ${k.check}: ${k.reason}`)))
  const FULL = ['persona_event_translation', 'comic_contradiction', 'reusable_engine', 'punch_direction', 'why_promising']
  expect(pe.every((e) => FULL.every((k) => typeof e[k] === 'string' && e[k].length)), `${c.persona}: every per_event entry is a complete reading (${FULL.join(', ')})`)
  expect(new Set(pe.map((e) => e.reusable_engine)).size === pe.length && new Set(pe.map((e) => e.comic_contradiction)).size === pe.length, `${c.persona}: engines and contradictions differ between events`)
  pe.forEach((e) => console.log(`      event ${e.event}: fits ${e.fits} — ${e.why_it_fits}\n        ${e.trigger_feature} → ${e.joke_target} · plays ${(e.best_reactions ?? []).join(' / ')}`))
})
const leak = JSON.stringify(out1).match(/Columbia|Butler|campus|airline|flight/gi)
expect(!leak, `no campus or illustration noun${leak ? ` (${[...new Set(leak)].join(', ')})` : ''}`)

// ---- step 2 for event 2, with the page's merge
const chosen = candidates.find((c) => c.persona === picks[0]?.persona)
if (!chosen) {
  console.error('no record for the pick')
  process.exit(1)
}
const { persona: name, per_event, ...rest } = { ...chosen, ...picks[0], likely_joke_target: chosen.joke_target }
const note = (per_event ?? []).find((e) => Number(e.event) === 2) ?? per_event?.[1]
const { event: _n, ...fields } = note ?? {}
const context = note ? { ...rest, ...fields, ...(fields.joke_target ? { likely_joke_target: fields.joke_target } : {}) } : rest
const s2Filled = fill(s2.llm_user_prompt, { EVENT: MOMENTS[1], PERSONA: name, PERSONA_CONTEXT: JSON.stringify(context, null, 2) })
const m2 = await modelFor(s2.llm_model_id)
console.log(`step 2: ${m2} for "${name}" on event 2 only…`)
t = Date.now()
const raw2 = await callOpenAI({ apiKey: env.OPENAI_API_KEY, model: m2, systemPrompt: s2.llm_system_prompt || 'Return only JSON.', userPrompt: s2Filled, maxTokens: 30000, reasoningEffort: 'high' })
console.log(`returned in ${Math.round((Date.now() - t) / 1000)}s`)
const out2 = parseJsonLoose(raw2)
const cands = out2?.joke_candidates ?? []
expect(cands.length === 5, `five captions (${cands.length})`)
cands.forEach((c, i) => console.log(`      ${i + 1}. [${c.scores?.overall ?? '?'}] ${c.caption}`))
const text = cands.map((c) => c.caption).join(' ')
expect(/parking|market|\$20|vendor|shopper|attend/i.test(text), 'captions are about event 2 (parking / market)')
expect(!/pool|swim|lifeguard|Labor Day/i.test(text), 'captions do not drift into event 1 (pool)')
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
