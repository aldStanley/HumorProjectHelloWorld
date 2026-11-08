#!/usr/bin/env node
// Duplicate an existing flavor with a new slug.
//
// Preferred: --name applies the naming convention
//   <new id>-<user>-<M-D-YY>-<short name>-from-<source id>
//
//   node scripts/duplicate-flavor.mjs --source 1540 --name reaction-captions-with-alt-POVs
//   → 1550-lydia-8-13-26-reaction-captions-with-alt-POVs-from-1540
//
// Or pass --slug to set the full slug verbatim (no convention applied).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, makeDb } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : (argv[++i] ?? true)
}

const SOURCE = Number(args.source ?? 1544)
const NAME = args.name
const USER = args.user ?? 'lydia'
const DESCRIPTION = args.description
const DRY = Boolean(args['dry-run'])

if (!NAME && !args.slug) {
  console.error('Error: --name (or --slug) is required')
  process.exit(1)
}

// With --name, the final slug needs the new flavor's id, so we insert under a
// placeholder and patch the slug in afterwards.
const today = new Date()
const dateStr = `${today.getMonth() + 1}-${today.getDate()}-${String(today.getFullYear()).slice(-2)}`
const finalSlug = (id) =>
  args.slug ?? `${id}-${USER}-${dateStr}-${NAME}-from-${SOURCE}`
const SLUG = args.slug ?? `pending-${USER}-${dateStr}-${NAME}`

const env = loadEnv(ROOT)
const db = makeDb(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const post = async (table, body) => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`insert ${table} failed (${res.status}): ${text}`)
  return JSON.parse(text)
}

// ---- load the source flavor + steps
const [flavor] = await db(`humor_flavors?id=eq.${SOURCE}&select=id,slug,description,created_by_user_id`)
if (!flavor) throw new Error(`flavor ${SOURCE} not found in staging`)

const steps = await db(
  `humor_flavor_steps?humor_flavor_id=eq.${SOURCE}&select=order_by,description,humor_flavor_step_type_id,llm_model_id,llm_input_type_id,llm_output_type_id,llm_temperature,llm_system_prompt,llm_user_prompt,is_hidden&order=order_by`
)

console.log(`source flavor ${SOURCE} "${flavor.slug}": ${steps.length} steps`)
console.log(`creating new flavor "${SLUG}"`)

// ---- guard: slug must not exist
const dup = await db(`humor_flavors?slug=eq.${encodeURIComponent(SLUG)}&select=id`)
if (dup.length) throw new Error(`slug "${SLUG}" already exists (id ${dup[0].id}) — pass a different --slug`)

const uid = flavor.created_by_user_id
const audit = { created_by_user_id: uid, modified_by_user_id: uid }

if (DRY) {
  console.log('dry run — no writes')
  console.log(`would create: slug="${finalSlug('<new id>')}", description="${DESCRIPTION || flavor.description}"`)
  console.log(`would copy ${steps.length} steps`)
  process.exit(0)
}

// ---- create the new flavor
const [nf] = await post('humor_flavors', {
  slug: SLUG,
  description: DESCRIPTION || `${flavor.description} (copy)`,
  ...audit,
})

// With --name, stamp the convention slug now that the id is known.
if (nf.slug !== finalSlug(nf.id)) {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/humor_flavors?id=eq.${nf.id}`, {
    method: 'PATCH',
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ slug: finalSlug(nf.id) }),
  })
  if (!res.ok) throw new Error(`slug rename failed (${res.status}): ${await res.text()}`)
  nf.slug = finalSlug(nf.id)
}
console.log(`created flavor id ${nf.id} "${nf.slug}"`)

// ---- copy all steps
const stepInserts = steps.map((step) => ({
  humor_flavor_id: nf.id,
  order_by: step.order_by,
  description: step.description,
  llm_temperature: step.llm_temperature,
  llm_system_prompt: step.llm_system_prompt,
  llm_user_prompt: step.llm_user_prompt,
  humor_flavor_step_type_id: step.humor_flavor_step_type_id,
  llm_input_type_id: step.llm_input_type_id,
  llm_model_id: step.llm_model_id,
  llm_output_type_id: step.llm_output_type_id,
  ...(step.is_hidden != null ? { is_hidden: step.is_hidden } : {}),
  ...audit,
}))

const { error: insertStepsError } = await post('humor_flavor_steps', stepInserts)

if (insertStepsError) {
  console.error('Failed to duplicate humor flavor steps.', insertStepsError)
  process.exit(1)
}

for (const step of stepInserts) {
  console.log(`  inserted order ${step.order_by}: ${step.description}`)
}

const check = await db(`humor_flavor_steps?humor_flavor_id=eq.${nf.id}&select=order_by&order=order_by`)
console.log(`\nVERIFY: flavor ${nf.id} has ${check.length}/${steps.length} steps`)
console.log(`✓ done — open /humor-flavor/${nf.id}`)
