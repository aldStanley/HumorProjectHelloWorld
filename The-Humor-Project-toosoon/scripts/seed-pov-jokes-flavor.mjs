#!/usr/bin/env node
// One-shot seed for the POV Joke Maker flavor: the GPT-5.6 Sol model row, the
// flavor itself, and its two steps (S1 finds POVs for a moment, S2 makes jokes
// for ONE POV). Idempotent — re-running reports what already exists instead of
// creating duplicates.
//
//   node scripts/seed-pov-jokes-flavor.mjs <step1-prompt-file> <step2-prompt-file>
import fs from 'node:fs'

import { createClient } from '@supabase/supabase-js'

const OWNER_USER_ID = '42129dcc-250b-45c1-af3e-bde1fb144111' // lydia
const OPENAI_PROVIDER_ID = 1
const MODEL_NAME = 'GPT-5.6 Sol'
const MODEL_PROVIDER_MODEL_ID = 'gpt-5.6-sol'
const FLAVOR_SLUG_STEM = 'lydia-8-15-26-pov-jokes'
const TEXT_ONLY_INPUT_TYPE = 2
const STRING_OUTPUT_TYPE = 1
const GENERAL_STEP_TYPE = 3

const [, , step1Path, step2Path] = process.argv
if (!step1Path || !step2Path) {
  console.error('usage: seed-pov-jokes-flavor.mjs <step1-file> <step2-file>')
  process.exit(1)
}

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => [
      line.slice(0, line.indexOf('=')).trim(),
      line.slice(line.indexOf('=') + 1).trim(),
    ])
)
const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
)

const die = (label, error) => {
  console.error(`${label}:`, error?.message ?? error)
  process.exit(1)
}

// 1. The model row.
let modelId
const { data: existingModel } = await sb
  .from('llm_models')
  .select('id, name')
  .eq('provider_model_id', MODEL_PROVIDER_MODEL_ID)
  .maybeSingle()
if (existingModel) {
  modelId = existingModel.id
  console.log(`model already present: ${existingModel.name} (id ${modelId})`)
} else {
  const { data, error } = await sb
    .from('llm_models')
    .insert({
      name: MODEL_NAME,
      provider_model_id: MODEL_PROVIDER_MODEL_ID,
      llm_provider_id: OPENAI_PROVIDER_ID,
      is_temperature_supported: false,
      created_by_user_id: OWNER_USER_ID,
      modified_by_user_id: OWNER_USER_ID,
    })
    .select('id')
    .single()
  if (error) die('insert model', error)
  modelId = data.id
  console.log(`created model ${MODEL_NAME} (id ${modelId})`)
}

// 2. The flavor. The slug convention embeds the flavor id, which Postgres
// assigns on insert — so insert with a placeholder slug, then rewrite it.
const { data: existingFlavor } = await sb
  .from('humor_flavors')
  .select('id, slug')
  .like('slug', `%${FLAVOR_SLUG_STEM}`)
  .maybeSingle()
if (existingFlavor) {
  console.log(
    `flavor already present: ${existingFlavor.slug} (id ${existingFlavor.id}) — not reseeding`
  )
  process.exit(0)
}

const description =
  'POV Joke Maker: a moment goes in, nothing else. S1 evaluates a recurring ' +
  'persona library against the moment, discovers event-native and narrow-lens ' +
  'personas, and returns a scored, diversity-checked set of selected POVs as ' +
  'JSON. S2 runs once per selected POV — inhabiting that persona to produce ' +
  '5 scored joke angles and a best caption. S2 is never run automatically: ' +
  'the POV Joke Maker surface fans it out only over the POVs you pick.'

const { data: flavor, error: flavorError } = await sb
  .from('humor_flavors')
  .insert({
    slug: `pending-${FLAVOR_SLUG_STEM}`,
    description,
    created_by_user_id: OWNER_USER_ID,
    modified_by_user_id: OWNER_USER_ID,
  })
  .select('id')
  .single()
if (flavorError) die('insert flavor', flavorError)

const slug = `${flavor.id}-${FLAVOR_SLUG_STEM}`
const { error: slugError } = await sb
  .from('humor_flavors')
  .update({ slug })
  .eq('id', flavor.id)
if (slugError) die('set flavor slug', slugError)
console.log(`created flavor ${slug} (id ${flavor.id})`)

// 3. The two steps. Prompts are stored verbatim; their {{EVENT}}-style
// placeholders are filled by the POV Joke Maker surface, not by the shared
// ${...} resolver.
const steps = [
  {
    order_by: 1,
    description: 'S1: Find the POVs worth joking from (one call per moment)',
    llm_user_prompt: fs.readFileSync(step1Path, 'utf8'),
  },
  {
    order_by: 2,
    description: 'S2: Make jokes from ONE POV (one call per selected POV)',
    llm_user_prompt: fs.readFileSync(step2Path, 'utf8'),
  },
]

for (const step of steps) {
  const { data, error } = await sb
    .from('humor_flavor_steps')
    .insert({
      humor_flavor_id: flavor.id,
      order_by: step.order_by,
      description: step.description,
      llm_system_prompt: '',
      llm_user_prompt: step.llm_user_prompt,
      llm_temperature: null,
      llm_input_type_id: TEXT_ONLY_INPUT_TYPE,
      llm_output_type_id: STRING_OUTPUT_TYPE,
      llm_model_id: modelId,
      humor_flavor_step_type_id: GENERAL_STEP_TYPE,
      is_hidden: false,
      created_by_user_id: OWNER_USER_ID,
      modified_by_user_id: OWNER_USER_ID,
    })
    .select('id')
    .single()
  if (error) die(`insert step ${step.order_by}`, error)
  console.log(`  step ${step.order_by} (id ${data.id}) — ${step.description}`)
}

console.log(`\nopen: /humor-flavor/${flavor.id}/pov-jokes`)
