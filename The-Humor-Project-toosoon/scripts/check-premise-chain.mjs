#!/usr/bin/env node
// Runs the premise-discovery chain (flavor 1562) once, live, on ONE
// off-domain moment with one supplied character: step 1 (fit the character
// to the moment), step 2 (discover premises), step 3 (execute them), and
// checks the contracts the page reads.
//
//   node scripts/check-premise-chain.mjs [flavorId]   # default 1562
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { callOpenAI, loadEnv, parseJsonLoose } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLAVOR = Number(process.argv[2] ?? 1562)
const env = loadEnv(ROOT)
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: steps } = await sb
  .from('humor_flavor_steps')
  .select('order_by, llm_system_prompt, llm_user_prompt, llm_model_id')
  .eq('humor_flavor_id', FLAVOR)
  .in('order_by', [1, 2, 3])
  .order('order_by')
const [s1, s2, s3] = steps ?? []
if (!s1 || !s2 || !s3) {
  console.error('missing steps')
  process.exit(1)
}
const modelFor = async (id) =>
  (await sb.from('llm_models').select('provider_model_id').eq('id', id).single()).data.provider_model_id

const EVENT =
  'The town parks board voted to close the community pool two weeks early "to prioritize staff wellness," the same week it approved overtime for the same staff to run a private swim-club rental on the closed dates. Lifeguards now spend afternoons turning away families at a locked gate while a banner over the gate still says "Open Through Labor Day." The board chair posted that the pool "remains a community resource."'
const PERSONAS = `* the Town
  - wants: to keep control of public space while appearing reasonable, normal, and family-friendly
  - pretends: nothing has changed; every closure or fee is ordinary administration
  - does compulsively: renames the obvious problem, calmly doubles down, posts polished explanations, treats complaints as a messaging problem
  - would never admit: the residents' blunt description is more accurate than the board's
  - comic emotion: serene municipal confidence while padlocking the public
  - best joke behavior: denial, euphemism, doubling down, proudly presenting the problem as the solution
  - emotional palette: smug denial → "actually…" correction; cheerful rebranding → proudly unveiling; casual doubling down → pressing the same button again; caught-but-unbothered → zero embarrassment`

const fill = (t, v) => t.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (w, n) => (n in v ? v[n] : w))
const unfilled = (t) => [...t.matchAll(/\{\{\s*([A-Z_]+)\s*\}\}/g)].map((m) => m[1])
let failures = 0
const expect = (c, m) => (c ? console.log(`ok    ${m}`) : (failures += 1, console.error(`FAIL  ${m}`)))
const call = async (step, filled, effort) => {
  const model = await modelFor(step.llm_model_id)
  const t = Date.now()
  const raw = await callOpenAI({ apiKey: env.OPENAI_API_KEY, model, systemPrompt: step.llm_system_prompt || 'Return only JSON.', userPrompt: filled, maxTokens: 30000, reasoningEffort: effort })
  console.log(`  ${model} returned in ${Math.round((Date.now() - t) / 1000)}s, ${raw.length} chars`)
  return parseJsonLoose(raw)
}

console.log('step 1: fit the character to the moment…')
const out1 = await call(s1, fill(s1.llm_user_prompt, { EVENT, EVENT_CONTEXT: 'None provided.', PERSONAS }), 'medium')
const record = out1?.candidates?.[0]
expect(Boolean(record), 'step 1 returned the character record')
if (!record) process.exit(1)
const { persona: name, per_event, ...rest } = { ...record, ...out1.selected_personas?.[0], likely_joke_target: record.joke_target }
const note = per_event?.[0] ?? {}
const { event: _n, ...fields } = note
const context = { ...rest, ...fields, ...(fields.joke_target ? { likely_joke_target: fields.joke_target } : {}) }
console.log(`  fit ${note.fits} — ${note.why_it_fits}`)

console.log('step 2: discover premises…')
const f2 = fill(s2.llm_user_prompt, { EVENT, PERSONA: name, PERSONA_CONTEXT: JSON.stringify(context, null, 2), PREVIOUS_PREMISES: 'None.' })
expect(unfilled(f2).length === 0, `step 2 fully filled${unfilled(f2).length ? ` (left: ${unfilled(f2).join(', ')})` : ''}`)
const out2 = await call(s2, f2, 'high')
expect(Boolean(out2), 'step 2 returned JSON')
if (!out2) process.exit(1)
const raw = out2.raw_premises ?? []
const sel = out2.selected_premises ?? []
expect(raw.length >= 10 && raw.length <= 15, `10-15 raw premises (${raw.length})`)
expect(sel.length >= 1 && sel.length <= 5, `1-5 selected premises (${sel.length})`)
expect(raw.every((r) => r.swap_test?.result && r.scores && r.duplicate_family), 'every raw premise has a swap test, scores, and a family')
const rawById = new Map(raw.map((r) => [r.premise_id, r]))
expect(sel.every((p) => rawById.has(p.premise_id)), 'every selected premise is a raw premise by id')
expect(sel.every((p) => (rawById.get(p.premise_id)?.scores?.factual_support ?? 0) >= 3), 'no selected premise has factual_support below 3')
expect(sel.every((p) => rawById.get(p.premise_id)?.swap_test?.result === 'passes'), 'every selected premise passes the swap test')
expect(new Set(sel.map((p) => rawById.get(p.premise_id)?.duplicate_family)).size === sel.length, 'selected premises are distinct families')
expect(Boolean(out2.character_role?.event_specific_exposure), 'character_role has an event-specific exposure')
const capLike = raw.filter((r) => /^["“].*["”]$/.test((r.premise ?? '').trim()))
expect(capLike.length === 0, `no raw premise is a quoted caption (${capLike.length})`)
sel.forEach((p, i) => console.log(`      ${i + 1}. ${p.premise}  [${rawById.get(p.premise_id)?.duplicate_family}]`))

console.log('step 3: execute the premises…')
const f3 = fill(s3.llm_user_prompt, {
  EVENT, PERSONA: name, PERSONA_CONTEXT: JSON.stringify(context, null, 2),
  EVENT_ANALYSIS: JSON.stringify(out2.event_analysis ?? null, null, 2),
  CHARACTER_ROLE: JSON.stringify(out2.character_role ?? null, null, 2),
  SELECTED_PREMISES: JSON.stringify(sel, null, 2),
  PREVIOUS_JOKES: 'None.',
})
expect(unfilled(f3).length === 0, `step 3 fully filled${unfilled(f3).length ? ` (left: ${unfilled(f3).join(', ')})` : ''}`)
const out3 = await call(s3, f3, 'high')
expect(Boolean(out3), 'step 3 returned JSON')
if (!out3) process.exit(1)
const execs = out3.premise_executions ?? []
const finals = out3.final_candidates ?? []
expect(execs.length === sel.length, `one execution record per selected premise (${execs.length} of ${sel.length})`)
expect(execs.every((e) => (e.executions ?? []).length === 2), 'every premise has exactly two executions')
expect(execs.every((e) => e.executions.every((x) => x.fact_integrity && x.premise_fidelity_check && x.swap_test && x.generic_template_check)), 'every execution carries all four checks')
expect(finals.length === sel.length, `one final candidate per premise (${finals.length})`)
const S = ['punch', 'compression', 'event_generatedness', 'comic_leap', 'premise_fidelity', 'factual_support', 'target_clarity', 'naturalness', 'gif_ability']
expect(finals.every((c) => c.scores && S.every((k) => typeof c.scores[k] === 'number') && c.scores.overall === Math.min(...S.map((k) => c.scores[k]))), 'every final overall is the minimum of nine scores')
expect(finals.every((c) => c.scores?.factual_support >= 4), 'every final has factual_support of 4 or more')
expect(finals.some((c) => (c.caption ?? '').trim() === (out3.best?.best_caption ?? '').trim()), 'best_caption is one of the finals, verbatim')
expect(execs.every((e) => (e.finalization?.final_caption ?? '') === (finals.find((c) => c.premise_id === e.premise_id)?.caption ?? '')), 'each final caption equals its finalization')
const words = (t) => (t ?? '').trim().split(/\s+/).filter(Boolean).length
finals.forEach((c, i) => console.log(`      ${i + 1}. [${c.scores?.overall} · ${words(c.caption)}w] ${c.caption}\n         premise: ${c.premise}\n         GIF: ${c.image_situation}`))
expect(new Set(finals.map((c) => (c.caption ?? '').toLowerCase())).size === finals.length, 'final captions are distinct')
const leak = JSON.stringify(out3.final_candidates).match(/Columbia|Butler|Uris|campus/gi)
expect(!leak, `no campus or illustration noun in the finals${leak ? ` (${[...new Set(leak)].join(', ')})` : ''}`)
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
