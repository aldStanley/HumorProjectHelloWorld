#!/usr/bin/env node
// Runs the premise-first S2 prompt once, against a fixture persona, and checks
// the result against the contract the surface renders. Prose in a prompt is
// not a guarantee; this is the guarantee.
//
//   node scripts/check-s2-contract.mjs [flavorId]      # default 1554
//
// The fixture is deliberately in a domain that appears neither in the prompt's
// own illustrations (wedding, airport, hardware store) nor in real use
// (campus), so a caption mentioning any of those is provable leakage.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { callOpenAI, loadEnv, parseJsonLoose } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLAVOR = Number(process.argv[2] ?? 1554)

const env = loadEnv(ROOT)
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: step, error } = await sb
  .from('humor_flavor_steps')
  .select('llm_system_prompt, llm_user_prompt, llm_model_id')
  .eq('humor_flavor_id', FLAVOR)
  .eq('order_by', 2)
  .single()
if (error) {
  console.error('could not read step 2:', error.message)
  process.exit(1)
}
const { data: model } = await sb
  .from('llm_models')
  .select('provider_model_id')
  .eq('id', step.llm_model_id)
  .single()

// A community pool on the last hot day of summer. Nothing to do with weddings,
// airports, hardware stores, or a campus.
const PAYLOAD = {
  persona: {
    persona_id: 'persona_lifeguard',
    persona: 'the community pool lifeguard',
    persona_baseline:
      'Has watched the same forty families all summer and knows exactly which child will run.',
    general_processing_rule: 'public event → a crowd-control problem in a confined space',
  },
  premises: [
    {
      idea_id: 'idea_lifeguard_01',
      moment_id: 'moment_01',
      moment: 'The town announces the pool closes for the season on Monday',
      trigger_feature: 'the announced closing date',
      concern: 'everyone in town arriving on the same afternoon',
      processing_path: 'closing announcement → one enormous final crowd',
      comic_role: 'functional_role',
      comic_translation: 'a nostalgic milestone becomes a staffing emergency',
      comic_contradiction:
        'It is funny that the town is feeling sentimental while the lifeguard is doing arithmetic about capacity.',
      core_comic_idea:
        'The town hears a bittersweet last weekend; the lifeguard hears every resident arriving at once.',
      likely_joke_target: 'the sentimentality of the announcement',
      visual_primitives: ['person watching a packed pool', 'someone counting a crowd'],
      semantic_cluster: 'closing becomes a crowd',
    },
    {
      idea_id: 'idea_lifeguard_02',
      moment_id: 'moment_02',
      moment: 'A heat advisory is issued for the same weekend',
      trigger_feature: 'the heat advisory',
      concern: 'nobody will get out of the water for the hourly break',
      processing_path: 'heat warning → whistle nobody obeys',
      comic_role: 'affected_stakeholder',
      comic_translation: 'a public safety notice becomes a personal authority problem',
      comic_contradiction:
        'It is funny that the advisory tells everyone to stay cool while making the lifeguard powerless to clear the water.',
      core_comic_idea:
        'The hotter it gets, the less anyone obeys the whistle at adult swim.',
      likely_joke_target: 'the futility of the whistle',
      visual_primitives: ['person blowing a whistle nobody hears'],
      semantic_cluster: 'heat becomes lost authority',
    },
    {
      idea_id: 'idea_lifeguard_03',
      moment_id: 'moment_03',
      moment: 'The snack bar sells out of ice cream by noon',
      trigger_feature: 'the sold-out sign',
      concern: 'the complaints arrive at the lifeguard chair, not the snack bar',
      processing_path: 'shortage elsewhere → complaints redirected to whoever is visible',
      comic_role: 'bystander',
      comic_translation: 'someone else running out becomes his problem',
      comic_contradiction:
        'It is funny that the one person with no connection to the freezer is the one being asked about it.',
      core_comic_idea:
        'He does not run the snack bar but is the only staff member sitting somewhere visible.',
      likely_joke_target: 'being the visible employee',
      visual_primitives: ['person pointing somewhere else'],
      semantic_cluster: 'someone else’s shortage becomes his',
    },
  ],
}

const filled = step.llm_user_prompt.replace(
  /\{\{\s*PERSONA_AND_PREMISES\s*\}\}/g,
  JSON.stringify(PAYLOAD, null, 2)
)
if (filled === step.llm_user_prompt) {
  console.error('the prompt has no {{PERSONA_AND_PREMISES}} placeholder')
  process.exit(1)
}

console.log(`calling ${model.provider_model_id} for flavor ${FLAVOR}…`)
const raw = await callOpenAI({
  apiKey: env.OPENAI_API_KEY,
  model: model.provider_model_id,
  systemPrompt: step.llm_system_prompt || 'Return only JSON.',
  userPrompt: filled,
  maxTokens: 40000,
})

const out = parseJsonLoose(raw)
if (!out) {
  console.error('the model did not return parseable JSON. Raw output:\n', raw.slice(0, 4000))
  process.exit(1)
}

let failures = 0
const fail = (msg) => {
  failures += 1
  console.error(`FAIL  ${msg}`)
}
const pass = (msg) => console.log(`ok    ${msg}`)
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg))

const suppliedIds = PAYLOAD.premises.map((p) => p.idea_id)
const premises = out.premises ?? []
const wildcards = out.wildcards ?? []
const finalists = out.ranked_finalists ?? []

expect(out.persona_id === PAYLOAD.persona.persona_id, 'persona_id copied verbatim')
expect(out.persona === PAYLOAD.persona.persona, 'persona name copied verbatim')

expect(
  premises.length === suppliedIds.length &&
    suppliedIds.every((id, i) => premises[i]?.source_idea_id === id),
  'every supplied premise appears exactly once, in order'
)

const executions = new Map()
premises.forEach((premise, i) => {
  const label = premise.source_idea_id ?? `premise ${i + 1}`
  expect(
    (premise.executions ?? []).length === 2,
    `${label}: exactly two executions`
  )
  ;(premise.executions ?? []).forEach((execution) => {
    if (execution.execution_id) executions.set(execution.execution_id, execution)
  })
  const ownIds = (premise.executions ?? []).map((e) => e.execution_id)
  expect(
    ownIds.includes(premise.selected_execution_id),
    `${label}: the winner is one of its own two executions`
  )
})
wildcards.forEach((wildcard) => {
  if (wildcard.execution_id) executions.set(wildcard.execution_id, wildcard)
})

// Scores: integers, correct sums, and JSON numbers rather than quoted strings.
const SCORE_KEYS = [
  'persona_specificity',
  'event_specificity',
  'comic_tension',
  'naturalness',
  'simplicity',
  'target_clarity',
]
let scoreProblems = 0
let typeProblems = 0
let wordProblems = 0
executions.forEach((execution, id) => {
  const scores = execution.scores ?? {}
  SCORE_KEYS.forEach((key) => {
    const value = scores[key]
    if (typeof value !== 'number') typeProblems += 1
    else if (!Number.isInteger(value) || value < 1 || value > 5) scoreProblems += 1
  })
  const sum = SCORE_KEYS.reduce((n, key) => n + (Number(scores[key]) || 0), 0)
  if (scores.total_score !== sum) {
    scoreProblems += 1
    console.error(`      ${id}: total_score ${scores.total_score} but the six sum to ${sum}`)
  }
  if (typeof execution.word_count !== 'number') typeProblems += 1
  else {
    const actual = (execution.caption ?? '').trim().split(/\s+/).filter(Boolean).length
    if (execution.word_count !== actual) {
      wordProblems += 1
      console.error(`      ${id}: word_count ${execution.word_count} but the caption has ${actual}`)
    }
  }
})
expect(typeProblems === 0, 'every score and word_count is a JSON number, not a string')
expect(scoreProblems === 0, 'every score is an integer 1-5 and every total is the exact sum')
expect(wordProblems === 0, 'every word_count matches its caption')

// The ranking is the answer, so its integrity matters most.
const winners = premises.map((p) => p.selected_execution_id)
const gated = wildcards.map((w) => w.execution_id)
expect(
  finalists.length === winners.length + gated.length,
  `ranked_finalists holds one winner per premise plus any wildcard (expected ${winners.length + gated.length}, got ${finalists.length})`
)
expect(
  finalists.every((f) => winners.includes(f.execution_id) || gated.includes(f.execution_id)),
  'every finalist is a premise winner or a gated wildcard'
)
expect(
  new Set(finalists.map((f) => f.source_idea_id ?? 'wildcard')).size === finalists.length,
  'no two finalists come from the same premise'
)
expect(
  finalists.every((f, i) => f.rank === i + 1),
  'rank runs 1..N with no gaps or ties'
)
expect(
  out.best_overall_execution_id === finalists[0]?.execution_id,
  'best_overall_execution_id equals the rank-1 finalist'
)

// The wildcard gate.
if (wildcards.length) {
  expect(wildcards.length === 1, 'at most one wildcard')
  const lowestWinner = Math.min(
    ...winners.map((id) => executions.get(id)?.scores?.total_score ?? 0)
  )
  wildcards.forEach((wildcard) => {
    const s = wildcard.scores ?? {}
    expect(
      (s.total_score ?? 0) > lowestWinner,
      `the wildcard beats the weakest winner (${s.total_score} vs ${lowestWinner})`
    )
    expect(
      (s.comic_tension ?? 0) >= 4 && (s.persona_specificity ?? 0) >= 4,
      'the wildcard clears comic_tension and persona_specificity 4+'
    )
  })
} else {
  pass('no wildcard returned (the expected common case)')
}

// Leakage from the prompt's own illustrations.
const allText = JSON.stringify(out).toLowerCase()
const LEAKS = ['wedding', 'photographer', 'airport', 'gate agent', 'hardware store', 'columbia', 'knicks']
const found = LEAKS.filter((word) => allText.includes(word))
expect(found.length === 0, `no illustration leaked into the output${found.length ? ` (found: ${found.join(', ')})` : ''}`)

// Captions should be short.
const captions = [...executions.values()].map((e) => (e.caption ?? '').trim())
const long = captions.filter((c) => c.split(/\s+/).length > 24)
expect(long.length === 0, `no caption runs past 24 words${long.length ? ` (${long.length} did)` : ''}`)

console.log('\n--- the ranking ---')
finalists.forEach((f) => {
  const e = executions.get(f.execution_id)
  console.log(`${f.rank}. [${e?.scores?.total_score}/30] ${e?.caption}`)
  console.log(`   image: ${e?.simple_image_concept}`)
})

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall contract checks passed')
process.exit(failures ? 1 : 0)
