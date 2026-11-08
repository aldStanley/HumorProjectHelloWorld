#!/usr/bin/env node
// Seed for the Reaction Joke Maker flavor: two SIBLING steps, not a chain.
// Step 1 takes a persona prompt, a moment, and a count ({{JOKE_COUNT}}, a field on the page) and returns that many reaction jokes,
// one per line. Step 2 (added 2026-09-08) takes the same plus the Student
// Read of the moment ({{STUDENT_READ}}); the page offers it as a second way
// to get jokes, beside step 1, so the two can be compared. Idempotent:
// re-running reports the existing flavor, and adds step 2 if it is missing.
//
//   node scripts/seed-reaction-jokes-flavor.mjs [step-1-file] [step-2-file]
//   (defaults: docs/prompts/reaction-jokes-s1.md, docs/prompts/reaction-jokes-s2.md)
import fs from 'node:fs'

import { createClient } from '@supabase/supabase-js'

const OWNER_USER_ID = '42129dcc-250b-45c1-af3e-bde1fb144111' // lydia
const MODEL_PROVIDER_MODEL_ID = 'gpt-5.6-sol'
const FLAVOR_SLUG_STEM = 'lydia-9-6-26-reaction-jokes'
const TEXT_ONLY_INPUT_TYPE = 2
const STRING_OUTPUT_TYPE = 1
const GENERAL_STEP_TYPE = 3

const promptPath = process.argv[2] ?? 'docs/prompts/reaction-jokes-s1.md'
const prompt = fs.readFileSync(promptPath, 'utf8')
const prompt2Path = process.argv[3] ?? 'docs/prompts/reaction-jokes-s2.md'
const prompt2 = fs.readFileSync(prompt2Path, 'utf8')
const requirePlaceholders = (text, names, label) => {
  for (const name of names) {
    if (!text.includes(`{{${name}}}`)) {
      console.error(`${label} is missing the {{${name}}} placeholder`)
      process.exit(1)
    }
  }
}
requirePlaceholders(prompt, ['PERSONA', 'MOMENT', 'JOKE_COUNT'], promptPath)
requirePlaceholders(prompt2, ['PERSONA', 'MOMENT', 'STUDENT_READ', 'JOKE_COUNT'], prompt2Path)

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
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const die = (label, error) => {
  console.error(`${label}:`, error?.message ?? error)
  process.exit(1)
}

const { data: model } = await sb
  .from('llm_models')
  .select('id, name')
  .eq('provider_model_id', MODEL_PROVIDER_MODEL_ID)
  .maybeSingle()
if (!model) die('model', `no llm_models row for ${MODEL_PROVIDER_MODEL_ID}`)

const stepRow = (flavorId, orderBy, description, userPrompt) => ({
  humor_flavor_id: flavorId,
  order_by: orderBy,
  description,
  llm_system_prompt: '',
  llm_user_prompt: userPrompt,
  llm_temperature: null,
  llm_input_type_id: TEXT_ONLY_INPUT_TYPE,
  llm_output_type_id: STRING_OUTPUT_TYPE,
  llm_model_id: model.id,
  humor_flavor_step_type_id: GENERAL_STEP_TYPE,
  is_hidden: false,
  created_by_user_id: OWNER_USER_ID,
  modified_by_user_id: OWNER_USER_ID,
})
const STEP_2_DESCRIPTION =
  'S2 (sibling of S1, not after it): {{JOKE_COUNT}} reaction jokes for ONE persona reacting to ONE moment, given the Student Read of that moment'

const { data: existing } = await sb
  .from('humor_flavors')
  .select('id, slug')
  .like('slug', `%${FLAVOR_SLUG_STEM}`)
  .maybeSingle()
if (existing) {
  console.log(`flavor already present: ${existing.slug} (id ${existing.id}) — not reseeding`)
  const { data: step2 } = await sb
    .from('humor_flavor_steps')
    .select('id')
    .eq('humor_flavor_id', existing.id)
    .eq('order_by', 2)
    .maybeSingle()
  if (step2) {
    console.log(`  step 2 already present (id ${step2.id})`)
  } else {
    const { data: inserted, error } = await sb
      .from('humor_flavor_steps')
      .insert(stepRow(existing.id, 2, STEP_2_DESCRIPTION, prompt2))
      .select('id')
      .single()
    if (error) die('insert step 2', error)
    console.log(`  added step 2 (id ${inserted.id}) on ${model.name}`)
  }
  console.log(`open: /humor-flavor/${existing.id}/reaction-jokes`)
  process.exit(0)
}

const description =
  'Reaction Joke Maker: pick moments, pick one persona whose voice prompt ' +
  'is its own file in docs/prompts/personas/, and run ONE ' +
  'simple step per moment that writes {{JOKE_COUNT}} reaction jokes in that voice, one ' +
  'per line. No roster, no premises, no scoring.'

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
const { error: slugError } = await sb.from('humor_flavors').update({ slug }).eq('id', flavor.id)
if (slugError) die('set flavor slug', slugError)
console.log(`created flavor ${slug} (id ${flavor.id})`)

const { data: step, error: stepError } = await sb
  .from('humor_flavor_steps')
  .insert(
    stepRow(
      flavor.id,
      1,
      'S1: Write {{JOKE_COUNT}} reaction jokes for ONE persona reacting to ONE moment (one call per moment)',
      prompt
    )
  )
  .select('id')
  .single()
if (stepError) die('insert step 1', stepError)
console.log(`  step 1 (id ${step.id}) on ${model.name}`)
const { data: step2, error: step2Error } = await sb
  .from('humor_flavor_steps')
  .insert(stepRow(flavor.id, 2, STEP_2_DESCRIPTION, prompt2))
  .select('id')
  .single()
if (step2Error) die('insert step 2', step2Error)
console.log(`  step 2 (id ${step2.id}) on ${model.name}`)
console.log(`\nopen: /humor-flavor/${flavor.id}/reaction-jokes`)
