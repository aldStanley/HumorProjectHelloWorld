#!/usr/bin/env node
// Promote a flavor from the staging DB (.env) to the production DB
// (.env.production): copies the humor_flavors row and all its
// humor_flavor_steps, remapping llm_model_id by provider_model_id (model ids
// are NOT synced between the two databases). Creates any missing model row in
// prod. Audit fields are stamped with the prod user id passed via --prod-uid.
//
//   node scripts/promote-flavor.mjs --flavor 1528
//   node scripts/promote-flavor.mjs --flavor 1528 --dry-run
//
// Refuses to run if the slug already exists in prod (no partial re-runs).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, makeDb } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : (argv[++i] ?? true)
}
const FLAVOR = Number(args.flavor)
if (!FLAVOR) { console.error('usage: node scripts/promote-flavor.mjs --flavor <id> [--dry-run]'); process.exit(1) }
const DRY = Boolean(args['dry-run'])
// Default: Lydia's prod user id (creator of prod flavor 115, lifecycle-ter-re-lyn-test-lydia)
const PROD_UID = args['prod-uid'] ?? '3caa0904-5aa6-4e7a-ad80-6d9bc0a6be0b'

const loadEnvFile = (file) => {
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const stagEnv = loadEnv(ROOT)
const prodEnv = loadEnvFile(path.join(ROOT, '.env.production'))
const stag = makeDb(stagEnv.NEXT_PUBLIC_SUPABASE_URL, stagEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const prod = makeDb(prodEnv.NEXT_PUBLIC_SUPABASE_URL, prodEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const postRaw = async (table, body) => {
  const res = await fetch(`${prodEnv.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: prodEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${prodEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, text }
}

// Insert letting the sequence assign the id; if the sequence is desynced
// (23505 duplicate pkey — prod has rows inserted with explicit ids), retry
// with an explicit max(id)+1.
const post = async (table, body) => {
  let res = await postRaw(table, body)
  for (let attempt = 0; !res.ok && res.text.includes('23505') && attempt < 3; attempt += 1) {
    const [top] = await prod(`${table}?select=id&order=id.desc&limit=1`)
    res = await postRaw(table, { ...body, id: top.id + 1 })
  }
  if (!res.ok) throw new Error(`insert ${table} failed (${res.status}): ${res.text}`)
  return JSON.parse(res.text)
}

// ---- load staging flavor + steps
const flavor = (await stag(`humor_flavors?id=eq.${FLAVOR}&select=slug,description`))[0]
if (!flavor) throw new Error(`flavor ${FLAVOR} not found in staging`)
const steps = await stag(
  `humor_flavor_steps?humor_flavor_id=eq.${FLAVOR}&select=order_by,description,humor_flavor_step_type_id,llm_model_id,llm_input_type_id,llm_output_type_id,llm_temperature,llm_system_prompt,llm_user_prompt&order=order_by`
)
console.log(`staging flavor ${FLAVOR} "${flavor.slug}": ${steps.length} steps`)

// ---- guard: slug must not exist in prod
const dup = await prod(`humor_flavors?slug=eq.${encodeURIComponent(flavor.slug)}&select=id`)
if (dup.length) throw new Error(`slug "${flavor.slug}" already exists in prod (id ${dup[0].id}) — aborting`)

// ---- model mapping by provider_model_id
const usedIds = [...new Set(steps.map((s) => s.llm_model_id))]
const stagModels = await stag(`llm_models?id=in.(${usedIds})&select=id,name,llm_provider_id,provider_model_id,is_temperature_supported`)
const prodModels = await prod('llm_models?select=id,provider_model_id')
const prodByProviderId = new Map(prodModels.map((m) => [m.provider_model_id, m.id]))
const modelMap = new Map()
const missing = []
for (const m of stagModels) {
  const prodId = prodByProviderId.get(m.provider_model_id)
  if (prodId) modelMap.set(m.id, prodId)
  else missing.push(m)
}
for (const m of stagModels) {
  const to = modelMap.get(m.id)
  console.log(`  model ${m.id} (${m.name}) -> ${to ?? 'MISSING in prod, will create'}`)
}

if (DRY) { console.log('dry run — no writes'); process.exit(0) }

// ---- create missing models in prod
for (const m of missing) {
  const [row] = await post('llm_models', {
    name: m.name,
    llm_provider_id: m.llm_provider_id,
    provider_model_id: m.provider_model_id,
    is_temperature_supported: m.is_temperature_supported,
    created_by_user_id: PROD_UID,
    modified_by_user_id: PROD_UID,
  })
  modelMap.set(m.id, row.id)
  console.log(`created prod model "${m.name}" id ${row.id}`)
}

// ---- insert flavor (prod has no is_pinned column; id auto-assigned)
const [pf] = await post('humor_flavors', {
  slug: flavor.slug,
  description: flavor.description,
  created_by_user_id: PROD_UID,
  modified_by_user_id: PROD_UID,
})
console.log(`created prod flavor id ${pf.id} "${pf.slug}"`)

// ---- insert steps
for (const s of steps) {
  await post('humor_flavor_steps', {
    humor_flavor_id: pf.id,
    order_by: s.order_by,
    description: s.description,
    humor_flavor_step_type_id: s.humor_flavor_step_type_id,
    llm_model_id: modelMap.get(s.llm_model_id),
    llm_input_type_id: s.llm_input_type_id,
    llm_output_type_id: s.llm_output_type_id,
    llm_temperature: s.llm_temperature,
    llm_system_prompt: s.llm_system_prompt,
    llm_user_prompt: s.llm_user_prompt,
    created_by_user_id: PROD_UID,
    modified_by_user_id: PROD_UID,
  })
  console.log(`  inserted S${s.order_by} — ${s.description}`)
}

// ---- verify
const check = await prod(`humor_flavor_steps?humor_flavor_id=eq.${pf.id}&select=order_by&order=order_by`)
console.log(`\nVERIFY: prod flavor ${pf.id} has ${check.length}/${steps.length} steps`)
console.log(`https://matrix.crackd.ai/humor-flavor/${pf.id}/ops`)
