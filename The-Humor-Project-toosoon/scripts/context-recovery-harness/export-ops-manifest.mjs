#!/usr/bin/env node
// Export the harness's cached intermediate outputs as a JSON manifest the ops
// UI can load (see ops/harness-actions.ts). READ-ONLY: replays the exact
// cache-key computation from judge-cast.mjs/harness.mjs against cache/ and
// never calls an LLM API or writes to the DB. If a step's prompt has changed
// in the DB since the harness ran, its key misses and that step (plus
// everything downstream, whose keys depend on its output) is reported as
// missing rather than recomputed.
//
//   node scripts/context-recovery-harness/export-ops-manifest.mjs
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv, makeDb } from '../meme-opt/lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const CACHE = path.join(HERE, 'cache')

const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i]
}
const FLAVOR = Number(args.flavor ?? 1544)
const SET = Number(args.set ?? 67)
const COUNT = Number(args.count ?? 5)
const MAX_STEP = Number(args['max-step'] ?? 13)
const JUDGE_MODEL = String(args['judge-model'] ?? 'gpt-5.5-2026-04-23')
const RATINGS = path.join(HERE, `human-ratings-${FLAVOR}.json`)

const env = loadEnv(ROOT)
const db = makeDb(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const maps = await db(`study_image_set_image_mappings?study_image_set_id=eq.${SET}&select=images(id,url,additional_context)&order=image_id.asc&limit=${COUNT}`)
const imageRows = maps.map((m) => m.images)
const mimeOf = (u) => (u.endsWith('.png') ? 'image/png' : u.endsWith('.webp') ? 'image/webp' : 'image/jpeg')

const steps = (await db(`humor_flavor_steps?humor_flavor_id=eq.${FLAVOR}&select=order_by,description,llm_system_prompt,llm_user_prompt,llm_temperature,llm_input_type_id,llm_model_id&order=order_by`)).filter((s) => s.order_by <= MAX_STEP)
const models = await db('llm_models?select=id,provider_model_id,is_temperature_supported')
const modelById = Object.fromEntries(models.map((m) => [m.id, m]))
const tempSupported = (pmid) => models.some((m) => m.provider_model_id === pmid && m.is_temperature_supported)

const sub = (t, priors, extra) => (t ?? '').replace(/\$\{([^}]+)\}/g, (f, n) => {
  n = n.trim(); const m = n.match(/^step(\d+)Output$/)
  if (m) return priors[m[1]] ?? ''
  if (n in extra) return extra[n]
  return f
})

// identical key scheme to judge-cast.mjs — but cache-read only, no dispatch
const cacheKey = (pmid, sys, usr, temp, b64, mime) =>
  crypto.createHash('sha256').update([pmid, sys, usr, temp ?? '', b64 ? mime : 'noimg', b64 ? crypto.createHash('sha256').update(b64).digest('hex') : ''].join(' ')).digest('hex').slice(0, 16)
const readCache = (key) => {
  const f = path.join(CACHE, `${key}.txt`)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null
}
const imgCacheFile = (url) => path.join(CACHE, `img-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)}.b64`)
const strip = (t) => t.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
const tryParse = (t) => { try { return JSON.parse(strip(t)) } catch { return null } }

// ---- structural cast prompts + verdict (verbatim from judge-cast.mjs) ----
const REGISTER_RULE = {
  in_scene: 'IN-SCENE: the speaker ("me"/"I") AND everyone else named are all physically present as figures in the photo.',
  watched_scene: 'WATCHED-SCENE: the speaker ("me"/"I"/"my") is the OFF-CAMERA observer and is NOT a figure in the photo; only the people described in third person (him, his friend, his roommate, etc.) are figures in the photo.',
  internal: 'INTERNAL: the photo personifies the speaker\'s inner life — typically the watching self ("me") AND one personified inner force ("my delusion", "my urge", "my brain") are BOTH figures in the photo.',
}
const JUDGE_SYS =
  'You are a perception tool, NOT a comedian and NOT a detective. You will see an IMAGE and a meme CAPTION. Your ONLY job ' +
  'is to enumerate — never to reason about, solve, or justify the joke. A charitable reader who thinks hard can always ' +
  'invent a way to tell figures apart; you must NOT do that. Report only what is forced at a GLANCE.\n\n' +
  'Do exactly this:\n' +
  '1. List every distinct human/character figure visible in the image, each with a short visual anchor (position + what ' +
  'they are doing). Cartoon characters and reflections count as figures.\n' +
  '2. List the distinct named entities the caption refers to (e.g. "me", "my bestie", "his friend", "my delusion").\n' +
  '3. Using the register rule you are given, list which of those entities the caption implies are PRESENT AS FIGURES in ' +
  'the photo (entities_expected_in_image).\n' +
  '4. For EACH figure, list EVERY expected entity that figure could plausibly be on first glance — the candidate set. ' +
  'Include an entity as a candidate whenever nothing visible rules it out. Do NOT narrow to one by reasoning; if two ' +
  'figures are interchangeable (same sort of person, no distinguishing pose/prop/position the caption keys on), then ' +
  'BOTH candidate entities go in BOTH figures\' lists. Only drop a candidate when something visible makes it impossible.\n\n' +
  'Output ONLY strict JSON (these are placeholders, not values):\n' +
  '{\n' +
  '  "figures": [ { "anchor": "<what you see>", "candidates": ["<entity>", "..."] } ],\n' +
  '  "entities_in_caption": ["<entity>", "..."],\n' +
  '  "entities_expected_in_image": ["<entity>", "..."]\n' +
  '}'
const JUDGE_USR = (card) =>
  `CAPTION:\n"${card.caption}"\n\nREGISTER — ${REGISTER_RULE[card.register] ?? 'treat every named entity as present in the photo.'}\n\n` +
  'Enumerate figures, entities, and per-figure candidate sets per the rules. Do not explain the joke. Output only the JSON.'

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
function verdict(j) {
  const reasons = []
  if (!j || !Array.isArray(j.figures)) return { pass: null, reasons: ['no parse'], flags: {} }
  const figures = j.figures.map((f) => ({ anchor: f.anchor, cands: (f.candidates || []).map(norm).filter(Boolean) }))
  const expected = (j.entities_expected_in_image || []).map(norm).filter(Boolean)
  const F = figures.length
  const E = expected.length
  const orphan = figures.filter((f) => f.cands.length === 0)
  const ambiguous = figures.filter((f) => f.cands.length > 1)
  const homesOf = (e) => figures.filter((f) => f.cands.includes(e))
  const unplaceable = expected.filter((e) => homesOf(e).length === 0)
  const soleClaims = {}
  for (const f of figures) if (f.cands.length === 1) soleClaims[f.cands[0]] = (soleClaims[f.cands[0]] || 0) + 1
  const collision = Object.entries(soleClaims).filter(([, n]) => n > 1).map(([e]) => e)
  if (orphan.length) reasons.push(`orphan figure — ${orphan.map((f) => `"${f.anchor}"`).join(', ')} maps to no named entity (who is that?)`)
  if (ambiguous.length) reasons.push(`ambiguous — ${ambiguous.map((f) => `"${f.anchor}" could be [${f.cands.join(' / ')}]`).join('; ')} (who is who?)`)
  if (unplaceable.length) reasons.push(`unplaceable entity — [${unplaceable.join(', ')}] named but not findable in the image`)
  if (collision.length) reasons.push(`collision — [${collision.join(', ')}] is the only option for two different figures`)
  if (F !== E) reasons.push(`cardinality — ${F} figure(s) vs ${E} entity/entities expected in frame`)
  const pass = reasons.length === 0
  return { pass, reasons, flags: { F, E, orphan: orphan.length, ambiguous: ambiguous.length, unplaceable: unplaceable.length, collision: collision.length, cardinality: F !== E } }
}

// ---- rebuild each image's chain from cache ----
const human = fs.existsSync(RATINGS)
  ? Object.fromEntries(JSON.parse(fs.readFileSync(RATINGS, 'utf8')).map((r) => [r.id, r]))
  : {}

const images = []
for (const img of imageRows) {
  const imgFile = imgCacheFile(img.url)
  const entry = { id: img.id, url: img.url, steps: {}, missingSteps: [], cast: [] }
  images.push(entry)
  if (!fs.existsSync(imgFile)) {
    entry.missingSteps = steps.map((s) => s.order_by)
    entry.note = 'image not in cache — harness never ran this image'
    continue
  }
  const b64 = fs.readFileSync(imgFile, 'utf8')
  const mime = mimeOf(img.url)
  const extra = { celebrityRecognition: '', imageAdditionalContext: img.additional_context ?? '', imageDescription: '' }
  const priors = {}
  let broken = false
  for (const st of steps) {
    if (broken) { entry.missingSteps.push(st.order_by); continue }
    const m = modelById[st.llm_model_id]
    const temp = m.is_temperature_supported ? st.llm_temperature : null
    const key = cacheKey(m.provider_model_id, sub(st.llm_system_prompt, priors, extra), sub(st.llm_user_prompt, priors, extra), temp, st.llm_input_type_id === 1 ? b64 : null, mime)
    const text = readCache(key)
    if (text == null) {
      // prompt changed since the run (or step never ran) — downstream keys
      // depend on this output, so the rest of the chain is unrecoverable
      broken = true
      entry.missingSteps.push(st.order_by)
      entry.note = `S${st.order_by} not in cache (prompt likely edited since the harness run) — downstream steps unrecoverable`
      continue
    }
    entry.steps[st.order_by] = text
    priors[st.order_by] = text
  }

  // caption cards + cached cast-judge results
  for (const [ord, text] of Object.entries(entry.steps)) {
    const j = tryParse(text); if (!j || !Array.isArray(j.captions)) continue
    for (const c of j.captions) {
      const card = {
        id: crypto.createHash('sha256').update(img.id + '|' + c.caption).digest('hex').slice(0, 10),
        stepOrderBy: Number(ord),
        register: c.register ?? '—',
        caption: c.caption ?? '',
        context: c.context ?? '',
      }
      const t = tempSupported(JUDGE_MODEL) ? 0 : null
      const judgeText = readCache(cacheKey(JUDGE_MODEL, JUDGE_SYS, JUDGE_USR(card), t, b64, mime))
      if (judgeText != null) {
        card.judge = tryParse(judgeText)
        card.judgeRaw = judgeText
        card.verdict = verdict(card.judge)
      } else {
        card.verdict = null
      }
      const h = human[card.id]
      if (h) { card.human = h.human; card.humanNote = h.note ?? null }
      entry.cast.push(card)
    }
  }
}

const manifest = {
  flavorId: FLAVOR,
  setId: SET,
  judgeModel: JUDGE_MODEL,
  generatedAt: Date.now(),
  stepOrderBys: steps.map((s) => s.order_by),
  images,
}
const outDir = path.join(HERE, 'runs')
fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, `ops-manifest-${FLAVOR}.json`)
fs.writeFileSync(out, JSON.stringify(manifest, null, 1))

for (const e of images) {
  const got = Object.keys(e.steps).length
  const judged = e.cast.filter((c) => c.verdict).length
  console.log(`${e.id.slice(0, 8)}  steps ${got}/${steps.length}${e.missingSteps.length ? ` (missing S${e.missingSteps.join(', S')})` : ''}  captions ${e.cast.length} (${judged} judged)${e.note ? `  — ${e.note}` : ''}`)
}
console.log(`\nwrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`)
