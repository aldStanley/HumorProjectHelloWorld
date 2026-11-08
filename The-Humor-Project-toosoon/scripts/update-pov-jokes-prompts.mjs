#!/usr/bin/env node
// Write stored user prompts for the POV Joke Maker flavor's steps. The DB is
// the source of truth for prompts; this just writes files into it.
//
//   node scripts/update-pov-jokes-prompts.mjs <flavorId> --step <n> <file> [...]
//   node scripts/update-pov-jokes-prompts.mjs <flavorId> --step 4 file.md \
//     --create --description "S4: ..."
//
// --create inserts the step when that order_by does not exist yet (it copies
// the model and type columns from step 1, so a new step runs like the others).
import fs from 'node:fs'

import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const flavorId = Number.parseInt(args[0] ?? '', 10)
const create = args.includes('--create')
const descriptionIndex = args.indexOf('--description')
const description =
  descriptionIndex === -1 ? null : args[descriptionIndex + 1] ?? null

// Every `--step <n> <file>` pair, in the order given.
const targets = []
args.forEach((arg, i) => {
  if (arg !== '--step') return
  const orderBy = Number.parseInt(args[i + 1] ?? '', 10)
  const file = args[i + 2]
  if (Number.isFinite(orderBy) && file) targets.push({ orderBy, file })
})

if (!Number.isFinite(flavorId) || !targets.length) {
  console.error(
    'usage: update-pov-jokes-prompts.mjs <flavorId> --step <n> <file> [--step <n> <file>] [--create --description "..."]'
  )
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

for (const { orderBy, file } of targets) {
  const prompt = fs.readFileSync(file, 'utf8')
  const { data, error } = await sb
    .from('humor_flavor_steps')
    .update({
      llm_user_prompt: prompt,
      modified_datetime_utc: new Date().toISOString(),
    })
    .eq('humor_flavor_id', flavorId)
    .eq('order_by', orderBy)
    .select('id, description')
  if (error) die(`step ${orderBy}`, error)

  if (data?.length) {
    console.log(
      `step ${orderBy} (id ${data[0].id}) updated — ${prompt.length} chars — ${data[0].description}`
    )
    continue
  }

  if (!create) {
    console.error(
      `step ${orderBy}: no such step on flavor ${flavorId} (pass --create to add it)`
    )
    process.exit(1)
  }

  // New step: take the model and the input/output/step type from step 1 so it
  // is configured exactly like the steps already on this flavor.
  const { data: template, error: templateError } = await sb
    .from('humor_flavor_steps')
    .select(
      'llm_model_id, llm_temperature, llm_input_type_id, llm_output_type_id, humor_flavor_step_type_id, created_by_user_id'
    )
    .eq('humor_flavor_id', flavorId)
    .eq('order_by', 1)
    .maybeSingle()
  if (templateError) die(`step ${orderBy} template`, templateError)
  if (!template) die(`step ${orderBy} template`, 'flavor has no step 1 to copy')

  const { data: inserted, error: insertError } = await sb
    .from('humor_flavor_steps')
    .insert({
      humor_flavor_id: flavorId,
      order_by: orderBy,
      description: description ?? `S${orderBy}`,
      llm_system_prompt: '',
      llm_user_prompt: prompt,
      llm_temperature: template.llm_temperature,
      llm_input_type_id: template.llm_input_type_id,
      llm_output_type_id: template.llm_output_type_id,
      llm_model_id: template.llm_model_id,
      humor_flavor_step_type_id: template.humor_flavor_step_type_id,
      is_hidden: false,
      created_by_user_id: template.created_by_user_id,
      modified_by_user_id: template.created_by_user_id,
    })
    .select('id, description')
    .single()
  if (insertError) die(`insert step ${orderBy}`, insertError)
  console.log(
    `step ${orderBy} (id ${inserted.id}) CREATED — ${prompt.length} chars — ${inserted.description}`
  )
}
