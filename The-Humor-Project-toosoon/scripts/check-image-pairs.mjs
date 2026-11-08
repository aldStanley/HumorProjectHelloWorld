#!/usr/bin/env node
// Runs the POV Joke Maker's pairing step (step 5 of flavor 1560) once, live,
// against a fixture of five captions and a real study image set, and checks
// the contract the page reads: every caption id paired exactly once, every
// image id verbatim from the (short-id) list, fit in 0..1, a one-sentence why.
//
//   node scripts/check-image-pairs.mjs [flavorId] [setId]   # 1560, 69
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { callOpenAI, loadEnv, parseJsonLoose } from './meme-opt/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FLAVOR = Number(process.argv[2] ?? 1560)
const SET = Number(process.argv[3] ?? 69)

const env = loadEnv(ROOT)
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: step } = await sb
  .from('humor_flavor_steps')
  .select('llm_system_prompt, llm_user_prompt, llm_model_id')
  .eq('humor_flavor_id', FLAVOR)
  .eq('order_by', 5)
  .single()
if (!step) {
  console.error(`flavor ${FLAVOR} has no step 5`)
  process.exit(1)
}
const model = (await sb.from('llm_models').select('provider_model_id').eq('id', step.llm_model_id).single()).data
  .provider_model_id

const { data: rows } = await sb
  .from('study_image_set_image_mappings')
  .select('id, image:images ( id, url, image_description, celebrity_recognition )')
  .eq('study_image_set_id', SET)
  .order('id')
const namesFrom = (raw) => {
  try {
    return (JSON.parse(raw ?? '').content ?? []).map((c) => c.name).filter(Boolean).join(', ')
  } catch {
    return ''
  }
}
const images = (rows ?? [])
  .map((r) => (Array.isArray(r.image) ? r.image[0] : r.image))
  .filter((i) => i?.url)
  .map((i, n) => ({ image_id: `img-${String(n + 1).padStart(2, '0')}`, uuid: i.id, who: namesFrom(i.celebrity_recognition) || null, description: (i.image_description ?? '').slice(0, 300) }))
console.log(`set ${SET}: ${images.length} images`)

const EVENT =
  'The town parks board voted to close the community pool two weeks early "to prioritize staff wellness," the same week it approved overtime for the same staff to run a private swim-club rental on the closed dates.'
const JOKES = [
  { id: 'town-1', caption: 'The Town: "It says open. It doesn\'t say for whom."', gif_note: 'smug "actually" correction' },
  { id: 'town-2', caption: 'The Town proudly unveiling its community resource: a padlock.', gif_note: 'proud ribbon-cutting reveal' },
  { id: 'town-3', caption: "The Town's public pool entering its members-only era.", gif_note: 'glamorous transformation reveal' },
  { id: 'town-4', caption: 'The Town: "Staff wellness has been approved for overtime."', gif_note: 'manager stamping APPROVED' },
  { id: 'town-5', caption: 'The Town seeing families at the locked gate and opening Canva.', gif_note: 'genius typing furiously' },
]

const fill = (t, v) => t.replace(/\{\{\s*([A-Z_]+)\s*\}\}/g, (w, n) => (n in v ? v[n] : w))
const filled = fill(step.llm_user_prompt, {
  EVENT,
  PERSONA: 'the Town',
  JOKES: JSON.stringify(JOKES, null, 2),
  // The page hands the model short ids (img-01…) and maps back to UUIDs.
  IMAGES: JSON.stringify(images.map(({ uuid, ...rest }) => rest), null, 2),
})
const unfilled = [...filled.matchAll(/\{\{\s*([A-Z_]+)\s*\}\}/g)].map((m) => m[1])
if (unfilled.length) {
  console.error('unfilled:', unfilled.join(', '))
  process.exit(1)
}
console.log(`prompt is ${filled.length} chars; calling ${model}…`)
const t = Date.now()
const raw = await callOpenAI({
  apiKey: env.OPENAI_API_KEY,
  model,
  systemPrompt: step.llm_system_prompt || 'Return only JSON.',
  userPrompt: filled,
  maxTokens: 12000,
  reasoningEffort: 'medium',
})
console.log(`returned in ${Math.round((Date.now() - t) / 1000)}s`)
const out = parseJsonLoose(raw)
if (!out?.pairs) {
  console.error('no pairs. Raw:\n', raw.slice(0, 3000))
  process.exit(1)
}

let failures = 0
const expect = (c, m) => (c ? console.log(`ok    ${m}`) : (failures += 1, console.error(`FAIL  ${m}`)))
const ids = new Set(images.map((i) => i.image_id))
const byJoke = new Map(out.pairs.map((p) => [p.joke_id, p]))
expect(out.pairs.length === JOKES.length, `${JOKES.length} pairs (got ${out.pairs.length})`)
expect(JOKES.every((j) => byJoke.has(j.id)), 'every caption id is paired')
const bad = out.pairs.filter((p) => !ids.has(p.image_id))
expect(bad.length === 0, `every image id is verbatim from the set${bad.length ? ` (bad: ${bad.map((p) => JSON.stringify(p.image_id)).join(', ')}; sample set id ${images[0].image_id})` : ''}`)
expect(out.pairs.every((p) => typeof p.fit === 'number' && p.fit >= 0 && p.fit <= 1), 'every fit is a number in 0..1')
expect(out.pairs.every((p) => typeof p.why === 'string' && p.why.length > 0), 'every pair has a why')
expect(new Set(out.pairs.map((p) => p.image_id)).size === out.pairs.length, 'distinct images per caption')
JOKES.forEach((j) => {
  const p = byJoke.get(j.id)
  const img = images.find((i) => i.image_id === p?.image_id)
  console.log(`      ${j.caption}\n        → ${img?.who ?? '?'} · fit ${p?.fit} · ${p?.why}`)
})
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed')
process.exit(failures ? 1 : 0)
