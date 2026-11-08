#!/usr/bin/env node
// End-to-end check of the premise-first pipeline against the LIVE prompts:
// runs step 1 on a test moment, resolves its normalized output into flat
// premises exactly as the surface does, then runs step 2 for one persona from
// that resolution. Two model calls.
//
//   node scripts/check-premise-pipeline.mjs [flavorId]     # default 1554
//
// This is the check that FIELD_NAMES in resolve-premises.ts matches what the
// discovery prompt actually emits. The fixture tests cannot prove that; only
// the real output can.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { callOpenAI, loadEnv, parseJsonLoose } from './meme-opt/lib.mjs'
import {
  buildS2Payload,
  isDiscoverySchema,
  resolveDiscovery,
} from '../src/app/humor-flavor/[humorFlavorId]/pov-jokes/resolve-premises.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLAVOR = Number(process.argv[2] ?? 1554)

// Off-domain on purpose: not a campus, and not one of the S2 prompt's own
// illustrations, so leakage from either is visible.
const MOMENT =
  'The town pool announces it will close for the season on Monday, three days earlier than usual, because the lifeguard staff have all gone back to school. A heat advisory is issued for the same weekend.'
const PERSONA_LIBRARY = `* the exhausted parent: every announcement is measured in hours of childcare gained or lost
* the retired regular: has swum the same lane at the same time for nineteen years
* the teenage lifeguard: the job was supposed to be easy money
* the town council member: every complaint becomes a budget line`

const env = loadEnv(ROOT)
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: steps } = await sb
  .from('humor_flavor_steps')
  .select('order_by, llm_system_prompt, llm_user_prompt, llm_model_id')
  .eq('humor_flavor_id', FLAVOR)
  .in('order_by', [1, 2])
const step1 = steps.find((s) => s.order_by === 1)
const step2 = steps.find((s) => s.order_by === 2)
const { data: model } = await sb
  .from('llm_models')
  .select('provider_model_id')
  .eq('id', step1.llm_model_id)
  .single()

let failures = 0
const fail = (m) => {
  failures += 1
  console.error(`FAIL  ${m}`)
}
const expect = (cond, m) => (cond ? console.log(`ok    ${m}`) : fail(m))

// ---- step 1 -----------------------------------------------------------
const s1Prompt = step1.llm_user_prompt
  .replace(/\{\{\s*EVENT\s*\}\}/g, MOMENT)
  .replace(/\{\{\s*EVENT_CONTEXT\s*\}\}/g, 'None provided.')
  .replace(/\{\{\s*PERSONAS\s*\}\}/g, PERSONA_LIBRARY)
const leftover1 = [...new Set([...s1Prompt.matchAll(/\{\{\s*([A-Z_]+)\s*\}\}/g)].map((m) => m[1]))]
expect(leftover1.length === 0, `step 1 fully filled${leftover1.length ? ` (left ${leftover1.join(', ')})` : ''}`)

console.log(`\ncalling ${model.provider_model_id} for step 1…`)
const raw1 = await callOpenAI({
  apiKey: env.OPENAI_API_KEY,
  model: model.provider_model_id,
  systemPrompt: step1.llm_system_prompt || 'Return only JSON.',
  userPrompt: s1Prompt,
  maxTokens: 60000,
})
const discovery = parseJsonLoose(raw1)
if (!discovery) {
  console.error('step 1 did not return parseable JSON:\n', raw1.slice(0, 3000))
  process.exit(1)
}

expect(isDiscoverySchema(discovery), 'the surface recognizes this as the discovery schema')

// ---- the join, exactly as the surface does it -------------------------
const { personas, problems } = resolveDiscovery(discovery)
expect(problems.length === 0, `no top-level resolution problems${problems.length ? `: ${problems.join(' | ')}` : ''}`)
expect(personas.length > 0, `at least one persona resolved (got ${personas.length})`)

const premiseProblems = personas.flatMap((p) => [
  ...p.problems,
  ...p.premises.flatMap((premise) => premise.problems),
])
expect(
  premiseProblems.length === 0,
  `every premise resolved every hop${premiseProblems.length ? `:\n        ${premiseProblems.join('\n        ')}` : ''}`
)

// The fields that matter are the ones step 2 is told are authoritative.
const allPremises = personas.flatMap((p) => p.premises)
const missing = (key) => allPremises.filter((p) => !p[key]).length
;['coreComicIdea', 'moment', 'processingPath', 'likelyJokeTarget', 'triggerFeature', 'concern'].forEach(
  (key) => {
    const n = missing(key)
    expect(n === 0, `every premise has ${key}${n ? ` (${n} of ${allPremises.length} missing)` : ''}`)
  }
)

console.log(`\nresolved ${personas.length} personas, ${allPremises.length} premises:`)
personas.forEach((p) => {
  console.log(`  ${p.persona} (${p.premises.length})`)
  p.premises.forEach((premise) =>
    console.log(`    - [${premise.semanticCluster ?? '?'}] ${premise.coreComicIdea?.slice(0, 90)}`)
  )
})

// ---- step 2, from the resolved payload --------------------------------
const persona = personas.find((p) => p.premises.length >= 2) ?? personas[0]
if (!persona) {
  console.error('no persona to run step 2 with')
  process.exit(1)
}
const payload = buildS2Payload(persona, persona.premises)
const s2Prompt = step2.llm_user_prompt.replace(
  /\{\{\s*PERSONA_AND_PREMISES\s*\}\}/g,
  JSON.stringify(payload, null, 2)
)
const leftover2 = [...new Set([...s2Prompt.matchAll(/\{\{\s*([A-Z_]+)\s*\}\}/g)].map((m) => m[1]))]
expect(leftover2.length === 0, `step 2 fully filled${leftover2.length ? ` (left ${leftover2.join(', ')})` : ''}`)

console.log(`\ncalling step 2 for "${persona.persona}" (${persona.premises.length} premises)…`)
const raw2 = await callOpenAI({
  apiKey: env.OPENAI_API_KEY,
  model: model.provider_model_id,
  systemPrompt: step2.llm_system_prompt || 'Return only JSON.',
  userPrompt: s2Prompt,
  maxTokens: 40000,
})
const out = parseJsonLoose(raw2)
if (!out) {
  console.error('step 2 did not return parseable JSON:\n', raw2.slice(0, 3000))
  process.exit(1)
}
if (typeof out.error === 'string') {
  fail(`step 2 refused: ${out.error}`)
  process.exit(1)
}

const supplied = persona.premises.map((p) => p.ideaId)
const returned = (out.premises ?? []).map((p) => p.source_idea_id)
expect(
  supplied.length === returned.length && supplied.every((id, i) => returned[i] === id),
  'step 2 returned exactly the premises it was given, in order'
)
expect(
  (out.premises ?? []).every((p) => (p.executions ?? []).length === 2),
  'two executions per premise'
)
const finalists = out.ranked_finalists ?? []
expect(
  finalists.length === (out.premises ?? []).length + (out.wildcards ?? []).length,
  'one finalist per premise, plus any wildcard'
)
expect(
  out.best_overall_execution_id === finalists[0]?.execution_id,
  'best_overall is the rank-1 finalist'
)

console.log('\n--- the ranking ---')
const byId = new Map()
;(out.premises ?? []).forEach((p) => (p.executions ?? []).forEach((e) => byId.set(e.execution_id, e)))
;(out.wildcards ?? []).forEach((w) => byId.set(w.execution_id, w))
finalists.forEach((f) => {
  const e = byId.get(f.execution_id)
  console.log(`${f.rank}. [${e?.scores?.total_score}/30] ${e?.caption}`)
})

console.log(failures ? `\n${failures} check(s) FAILED` : '\nthe whole pipeline holds')
process.exit(failures ? 1 : 0)
