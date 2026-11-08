#!/usr/bin/env node
// Copy a study image set from the production DB (.env.production) to the
// dev/staging DB (.env): creates the study_image_sets row (same slug +
// description; id auto-assigned), inserts any images rows missing in dev
// (same image id; profile_id nulled when the owning profile doesn't exist in
// dev — image files live on the shared images.crackd.ai CDN so URLs copy
// verbatim), then inserts the mappings in the same order.
//
//   node scripts/copy-image-set.mjs --set 30
//   node scripts/copy-image-set.mjs --set 30 --dry-run
//
// Refuses to run if the slug already exists in dev (no partial re-runs).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeDb } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : (argv[++i] ?? true)
}
const SET = Number(args.set)
if (!SET) { console.error('usage: node scripts/copy-image-set.mjs --set <id> [--dry-run]'); process.exit(1) }
const DRY = Boolean(args['dry-run'])

const loadEnvFile = (file) => {
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const prodEnv = loadEnvFile(path.join(ROOT, '.env.production'))
const devEnv = loadEnvFile(path.join(ROOT, '.env'))
const prod = makeDb(prodEnv.NEXT_PUBLIC_SUPABASE_URL, prodEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const dev = makeDb(devEnv.NEXT_PUBLIC_SUPABASE_URL, devEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const postRaw = async (table, body) => {
  const res = await fetch(`${devEnv.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: devEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${devEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, text }
}

// Insert letting the sequence assign the id; if the sequence is desynced
// (23505 duplicate pkey), retry with an explicit max(id)+1.
const post = async (table, body) => {
  let res = await postRaw(table, body)
  for (let attempt = 0; !res.ok && res.text.includes('23505') && attempt < 3; attempt += 1) {
    const [top] = await dev(`${table}?select=id&order=id.desc&limit=1`)
    res = await postRaw(table, { ...body, id: top.id + 1 })
  }
  if (!res.ok) throw new Error(`insert ${table} failed (${res.status}): ${res.text}`)
  return JSON.parse(res.text)
}

// ---- load prod set + mappings + images
const [set] = await prod(`study_image_sets?id=eq.${SET}&select=slug,description`)
if (!set) throw new Error(`study image set ${SET} not found in prod`)
const maps = await prod(`study_image_set_image_mappings?study_image_set_id=eq.${SET}&select=image_id&order=id`)
if (!maps.length) throw new Error(`set ${SET} has no image mappings in prod`)
const ids = maps.map((m) => m.image_id)
const imgRows = await prod(
  `images?id=in.(${ids.join(',')})&select=id,url,image_description,additional_context,celebrity_recognition,embedding,is_public,is_common_use,profile_id`
)
const imgById = new Map(imgRows.map((r) => [r.id, r]))
console.log(`prod set ${SET} "${set.slug}": ${maps.length} mappings, ${imgRows.length} image rows`)

// ---- guard: slug must not exist in dev
const dup = await dev(`study_image_sets?slug=eq.${encodeURIComponent(set.slug)}&select=id`)
if (dup.length) throw new Error(`slug "${set.slug}" already exists in dev (id ${dup[0].id}) — aborting`)

// ---- diff images against dev
const devHave = new Set((await dev(`images?id=in.(${ids.join(',')})&select=id`)).map((r) => r.id))
const missing = ids.filter((id) => !devHave.has(id))
const profIds = [...new Set(missing.map((id) => imgById.get(id)?.profile_id).filter(Boolean))]
const devProfs = profIds.length
  ? new Set((await dev(`profiles?id=in.(${profIds.join(',')})&select=id`)).map((r) => r.id))
  : new Set()
console.log(`dev already has ${devHave.size}/${ids.length} images; will insert ${missing.length}`)
for (const id of missing) {
  const im = imgById.get(id)
  const keepProfile = im.profile_id && devProfs.has(im.profile_id)
  console.log(`  ${id} ${keepProfile ? '' : '(profile_id -> null) '}${im.url}`)
}

if (DRY) { console.log('dry run — no writes'); process.exit(0) }

// ---- insert missing images (same id; CDN url verbatim)
for (const id of missing) {
  const im = imgById.get(id)
  await post('images', {
    id: im.id,
    url: im.url,
    image_description: im.image_description,
    additional_context: im.additional_context,
    celebrity_recognition: im.celebrity_recognition,
    embedding: im.embedding,
    is_public: im.is_public,
    is_common_use: im.is_common_use,
    profile_id: im.profile_id && devProfs.has(im.profile_id) ? im.profile_id : null,
  })
  console.log(`inserted image ${id}`)
}

// ---- insert the set (id auto-assigned)
const [ds] = await post('study_image_sets', { slug: set.slug, description: set.description })
console.log(`created dev set id ${ds.id} "${ds.slug}"`)

// ---- insert mappings in prod order
for (const id of ids) {
  await post('study_image_set_image_mappings', { study_image_set_id: ds.id, image_id: id })
}

// ---- verify
const check = await dev(`study_image_set_image_mappings?study_image_set_id=eq.${ds.id}&select=image_id&order=id`)
const orderOk = check.length === ids.length && check.every((r, i) => r.image_id === ids[i])
console.log(`\nVERIFY: dev set ${ds.id} has ${check.length}/${ids.length} mappings, order ${orderOk ? 'preserved' : 'MISMATCH'}`)
