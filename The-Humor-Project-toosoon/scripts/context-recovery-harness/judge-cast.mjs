#!/usr/bin/env node
// STRUCTURAL cast check for flavor 1544 captions — validation harness.
//
// The blind *story* judge (judge.mjs) failed: a capable model reasons its way
// past the who-is-who ambiguity that a scroller never resolves, so its scores
// don't track human ratings. This instrument removes the reasoning. The model
// does ONLY perception + enumeration — it never "reconstructs the joke":
//
//   for each visible figure, list every caption-entity that figure could be
//   on FIRST GLANCE (no reasoning, no picking a favourite).
//
// Then CODE computes the verdict from counts alone:
//   - orphan figure   : a visible figure no named entity claims  → "who is the second person?"
//   - ambiguous figure: a figure that ≥2 entities could be       → "who is who?"
//   - unplaceable      : a named entity no figure can be          → "reading his future in a cup?"
//   - cardinality      : #figures ≠ #entities expected in-frame
//   PASS only on a clean 1-to-1 mapping.
//
// It writes nothing to the DB. It rebuilds the 38 caption cards from the shared
// S1-S13 cache and validates the structural FAIL flag against Lydia's ratings —
// especially the who-is-who / "second person" subset the story judge whiffed on.
//
//   node scripts/context-recovery-harness/judge-cast.mjs
//   node scripts/context-recovery-harness/judge-cast.mjs --judge-model gemini-2.5-pro
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv, makeDb, pLimit } from '../meme-opt/lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const CACHE = path.join(HERE, 'cache')
fs.mkdirSync(CACHE, { recursive: true })

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

const imageRows = []
if (args.images) {
  for (const tok of String(args.images).split(',').map((s) => s.trim())) {
    if (tok.startsWith('http')) imageRows.push({ id: tok.slice(-12), url: tok, additional_context: '' })
    else { const [row] = await db(`images?id=eq.${tok}&select=id,url,additional_context`); imageRows.push(row) }
  }
} else {
  const maps = await db(`study_image_set_image_mappings?study_image_set_id=eq.${SET}&select=images(id,url,additional_context)&order=image_id.asc&limit=${COUNT}`)
  imageRows.push(...maps.map((m) => m.images))
}
const mimeOf = (u) => (u.endsWith('.png') ? 'image/png' : u.endsWith('.webp') ? 'image/webp' : 'image/jpeg')

const steps = (await db(`humor_flavor_steps?humor_flavor_id=eq.${FLAVOR}&select=order_by,llm_system_prompt,llm_user_prompt,llm_temperature,llm_input_type_id,llm_model_id&order=order_by`)).filter((s) => s.order_by <= MAX_STEP)
const models = await db('llm_models?select=id,provider_model_id,is_temperature_supported')
const modelById = Object.fromEntries(models.map((m) => [m.id, m]))
const tempSupported = (pmid) => models.some((m) => m.provider_model_id === pmid && m.is_temperature_supported)

const sub = (t, priors, extra) => (t ?? '').replace(/\$\{([^}]+)\}/g, (f, n) => {
  n = n.trim(); const m = n.match(/^step(\d+)Output$/)
  if (m) return priors[m[1]] ?? ''
  if (n in extra) return extra[n]
  return f
})

// ---- model calls + content cache (identical scheme to judge.mjs) ----
const callOpenAIStyle = async (endpoint, apiKey, pmid, sys, usr, temp, b64mime) => {
  const usesMCT = pmid.startsWith('gpt-5') || /^o\d/.test(pmid)
  const content = b64mime ? [{ type: 'text', text: usr }, { type: 'image_url', image_url: { url: `data:${b64mime[1]};base64,${b64mime[0]}` } }] : usr
  const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: pmid, messages: [{ role: 'system', content: sys }, { role: 'user', content }], ...(temp != null && !usesMCT ? { temperature: temp } : {}), ...(usesMCT ? { max_completion_tokens: 32000 } : { max_tokens: 8000 }) }) })
  const d = await r.json()
  if (!r.ok) throw new Error(`${pmid} HTTP ${r.status}: ${JSON.stringify(d).slice(0, 300)}`)
  return (d?.choices?.[0]?.message?.content ?? '').trim()
}
const callGemini = async (pmid, sys, usr, b64, mime) => {
  const maxTok = pmid.includes('pro') ? 32768 : 16384
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${pmid}:generateContent?key=${env.GOOGLE_AI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `System: ${sys}\n\nUser: ${usr}` }, ...(b64 ? [{ inline_data: { mime_type: mime, data: b64 } }] : [])] }], generationConfig: { maxOutputTokens: maxTok } }) })
  const d = await r.json()
  const t = (d?.candidates?.[0]?.content?.parts || []).map((p) => p?.text ?? '').join('').trim()
  if (!t) throw new Error(`gemini empty: ${JSON.stringify(d).slice(0, 300)}`)
  return t
}
const dispatch = (pmid, sys, usr, temp, b64, mime) => {
  if (pmid.startsWith('gemini')) return callGemini(pmid, sys, usr, b64, mime)
  if (pmid.startsWith('grok')) return callOpenAIStyle('https://api.x.ai/v1/chat/completions', env.X_AI_KEY, pmid, sys, usr, temp, b64 ? [b64, mime] : null)
  return callOpenAIStyle('https://api.openai.com/v1/chat/completions', env.OPENAI_API_KEY, pmid, sys, usr, temp, b64 ? [b64, mime] : null)
}
const withRetry = async (fn) => {
  let lastErr
  for (let i = 0; i < 5; i += 1) {
    if (i) await new Promise((r) => setTimeout(r, 2000 * 2 ** i))
    try { const t = await fn(); if (t) return t } catch (e) { lastErr = e; process.stderr.write(`  retry: ${String(e.message).slice(0, 110)}\n`) }
  }
  throw lastErr ?? new Error('empty after 5 tries')
}
const inflight = new Map()
const cachedCall = (pmid, sys, usr, temp, b64, mime, label) => {
  const key = crypto.createHash('sha256').update([pmid, sys, usr, temp ?? '', b64 ? mime : 'noimg', b64 ? crypto.createHash('sha256').update(b64).digest('hex') : ''].join(' ')).digest('hex').slice(0, 16)
  const f = path.join(CACHE, `${key}.txt`)
  if (fs.existsSync(f)) { process.stderr.write(`${label} cached\n`); return fs.readFileSync(f, 'utf8') }
  if (inflight.has(key)) return inflight.get(key)
  const p = withRetry(() => dispatch(pmid, sys, usr, temp, b64, mime)).then((out) => { fs.writeFileSync(f, out); process.stderr.write(`${label} done (${out.length}c ${pmid})\n`); return out }).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}
const imgCacheFile = (url) => path.join(CACHE, `img-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)}.b64`)
const fetchImage = async (url) => {
  const f = imgCacheFile(url)
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8')
  const b64 = Buffer.from(await (await fetch(url)).arrayBuffer()).toString('base64'); fs.writeFileSync(f, b64); return b64
}
const strip = (t) => t.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
const tryParse = (t) => { try { return JSON.parse(strip(t)) } catch { return null } }

// ---- the structural-perception prompt (NO joke reasoning) ----
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

// ---- CODE computes the structural verdict ----
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
function verdict(j) {
  const reasons = []
  if (!j || !Array.isArray(j.figures)) return { pass: null, reasons: ['no parse'], flags: {} }
  const figures = j.figures.map((f) => ({ anchor: f.anchor, cands: (f.candidates || []).map(norm).filter(Boolean) }))
  const expected = (j.entities_expected_in_image || []).map(norm).filter(Boolean)
  const F = figures.length
  const E = expected.length

  const orphan = figures.filter((f) => f.cands.length === 0)                 // figure no entity claims
  const ambiguous = figures.filter((f) => f.cands.length > 1)                // figure ≥2 entities could be
  const homesOf = (e) => figures.filter((f) => f.cands.includes(e))
  const unplaceable = expected.filter((e) => homesOf(e).length === 0)        // named entity no figure can be
  // collision: an entity is the ONLY option for two different figures, or two figures share an identical multi-candidate set
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

// ---- rebuild caption cards from the cached chain ----
const limit = pLimit(Number(args.concurrency ?? 3))
const cards = []
await Promise.all(imageRows.map((img) => limit(async () => {
  const b64 = await fetchImage(img.url); const mime = mimeOf(img.url)
  const extra = { celebrityRecognition: '', imageAdditionalContext: img.additional_context ?? '', imageDescription: '' }
  const priors = {}
  for (const st of steps) {
    const m = modelById[st.llm_model_id]
    const temp = m.is_temperature_supported ? st.llm_temperature : null
    priors[st.order_by] = await cachedCall(m.provider_model_id, sub(st.llm_system_prompt, priors, extra), sub(st.llm_user_prompt, priors, extra), temp, st.llm_input_type_id === 1 ? b64 : null, mime, `${img.id.slice(0, 8)} S${st.order_by}`)
  }
  for (const [ord, text] of Object.entries(priors)) {
    const j = tryParse(text); if (!j || !Array.isArray(j.captions)) continue
    for (const c of j.captions) cards.push({ id: crypto.createHash('sha256').update(img.id + '|' + c.caption).digest('hex').slice(0, 10), imageId: img.id, url: img.url, mime, register: c.register ?? '—', caption: c.caption ?? '', context: c.context ?? '', raw: c })
  }
})))

// ---- run the structural check per caption ----
await Promise.all(cards.map((card) => limit(async () => {
  const b64 = fs.readFileSync(imgCacheFile(card.url), 'utf8')
  const t = tempSupported(JUDGE_MODEL) ? 0 : null
  card.text = await cachedCall(JUDGE_MODEL, JUDGE_SYS, JUDGE_USR(card), t, b64, card.mime, `cast ${card.id}`)
  card.parsed = tryParse(card.text)
  card.v = verdict(card.parsed)
})))

// ---- join human ratings + classify the note type ----
const human = Object.fromEntries(JSON.parse(fs.readFileSync(RATINGS, 'utf8')).map((r) => [r.id, r]))
const noteClass = (note) => {
  const n = (note || '').toLowerCase()
  if (/who is|who are|second person|which|characters|unneeded|reflection|who am i/.test(n)) return 'cast'
  if (/looking down|why are they|sad|expression|bored|skeptic/.test(n)) return 'pose'
  if (n.trim()) return 'story'
  return 'none'
}
for (const c of cards) {
  const h = human[c.id]
  c.human = h ? h.human : null
  c.note = h ? h.note : null
  c.nclass = noteClass(c.note)
}
const rated = cards.filter((c) => c.human != null && c.v.pass != null)

// ---- validation report: does structural FAIL predict the who-is-who losses? ----
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—')
const bandName = { 1: 'got it', 0.5: 'partly', 0: 'lost' }
console.log(`\n=== STRUCTURAL CAST CHECK vs ${rated.length} HUMAN RATINGS ===`)
console.log(`perception model: ${JUDGE_MODEL} (code computes the verdict) | writer was gemini-2.5-pro\n`)

// A. fail-rate by human band — want: high on lost, low on got-it
console.log('structural FAIL rate within each of YOUR bands (want: high on lost, ~0 on got it):')
for (const b of [0, 0.5, 1]) {
  const g = rated.filter((c) => c.human === b)
  const failed = g.filter((c) => c.v.pass === false)
  console.log(`  ${bandName[b].padEnd(7)} (${String(g.length).padStart(2)}): FAIL ${pct(failed.length, g.length).padStart(4)}  (${failed.length}/${g.length})`)
}

// B. the money question — recall on the CAST failure subclass, false-alarm on clean gots
const castNotes = rated.filter((c) => c.nclass === 'cast')
const castHit = castNotes.filter((c) => c.v.pass === false)
const cleanGots = rated.filter((c) => c.human === 1)
const gotFalseAlarm = cleanGots.filter((c) => c.v.pass === false)
const poseStory = rated.filter((c) => c.human === 0 && (c.nclass === 'pose' || c.nclass === 'story'))
console.log('\nthe targeted claim (a CAST check should catch who-is-who, ignore pose/story, spare clean wins):')
console.log(`  recall on your "who is who / second person" notes : ${pct(castHit.length, castNotes.length)}  (${castHit.length}/${castNotes.length})   ← want HIGH`)
console.log(`  false alarms on your "got it" captions           : ${pct(gotFalseAlarm.length, cleanGots.length)}  (${gotFalseAlarm.length}/${cleanGots.length})   ← want LOW`)
console.log(`  (pose/story losses it is NOT meant to catch)     : flagged ${pct(poseStory.filter((c) => c.v.pass === false).length, poseStory.length)} of ${poseStory.length} — expected to mostly MISS these`)

// C. per-caption table
console.log('\n--- per caption (✗=structural FAIL, ✓=PASS) ---')
const sorted = [...rated].sort((a, b) => (a.human - b.human) || (a.imageId.localeCompare(b.imageId)))
for (const c of sorted) {
  const mark = c.v.pass === false ? '✗' : '✓'
  const agree = (c.v.pass === false && c.human < 1) || (c.v.pass === true && c.human === 1) ? ' ' : '⚠'
  console.log(`${agree}${mark} you:${bandName[c.human].padEnd(7)} [${c.nclass.padEnd(5)}] ${c.register.padEnd(13)} ${c.v.pass === false ? c.v.reasons[0] : ''}`)
  console.log(`    "${c.caption}"`)
  if (c.note) console.log(`    note: ${c.note}`)
}

// ---- HTML ----
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const REG = { in_scene: '#0ea5e9', watched_scene: '#a855f7', internal: '#f59e0b' }
const pill = (b) => `<span class="pill b${String(b).replace('.', '')}">${bandName[b]}</span>`
const figList = (j) => Array.isArray(j?.figures) ? j.figures.map((f) => `<li><b>${esc(f.anchor)}</b> → ${(f.candidates || []).length ? f.candidates.map(esc).join(' / ') : '<span class="miss">nobody</span>'}${(f.candidates || []).length > 1 ? ' <span class="miss">(ambiguous)</span>' : ''}</li>`).join('') : ''
const cardHtml = (c) => `<div class="card" data-fail="${c.v.pass === false ? 1 : 0}" data-disagree="${(c.v.pass === false) === (c.human < 1) ? 0 : 1}">
  <div class="cap"><span class="reg" style="background:${REG[c.register] ?? '#999'}22;color:${REG[c.register] ?? '#666'}">${esc(c.register)}</span>${esc(c.caption)}</div>
  <div class="verdicts"><span class="vl">you</span>${pill(c.human)}<span class="vl">structural</span><span class="pill ${c.v.pass === false ? 'sfail' : 'spass'}">${c.v.pass === false ? 'FAIL' : 'PASS'}</span></div>
  ${c.note ? `<p class="note">your note: ${esc(c.note)}</p>` : ''}
  ${c.v.reasons?.length && c.v.pass === false ? `<ul class="reasons">${c.v.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
  <details><summary>figure → candidate entities</summary><ul class="figs">${figList(c.parsed)}</ul>
  <div class="ents">expected in frame: ${(c.parsed?.entities_expected_in_image || []).map(esc).join(', ') || '—'}</div></details>
</div>`
let sections = ''
for (const img of imageRows) {
  const mine = cards.filter((c) => c.imageId === img.id)
  const b64 = fs.readFileSync(imgCacheFile(img.url), 'utf8')
  sections += `<section><h2>${esc(img.id.slice(0, 8))}</h2><div class="row"><figure><img src="data:${mimeOf(img.url)};base64,${b64}"></figure><div class="cards">${mine.map(cardHtml).join('\n')}</div></div></section>\n`
}
const html = `<title>Structural cast check — flavor ${FLAVOR}</title>
<style>
  :root{--ink:#23252b;--dim:#6d7078;--line:#e4e2dc;--ground:#fbfaf7;--mono:ui-monospace,Menlo,monospace}
  body{background:var(--ground);color:var(--ink);font:15px/1.5 system-ui,sans-serif;margin:0;padding:2rem clamp(1rem,3vw,3rem) 4rem}
  header{max-width:80rem;margin:0 auto 1.5rem}h1{font-size:1.5rem;margin:0 0 .4rem}.sub{color:var(--dim);max-width:76ch}
  label{font-size:.85rem;color:var(--dim);cursor:pointer;margin-right:1rem}
  section{max-width:80rem;margin:0 auto 2.5rem;border-top:1px solid var(--line);padding-top:1.2rem}
  h2{font-size:1rem;font-family:var(--mono);margin:0 0 .8rem}
  .row{display:grid;grid-template-columns:minmax(140px,210px) 1fr;gap:1.4rem;align-items:start}
  figure{margin:0;position:sticky;top:1rem}figure img{width:100%;border:1px solid var(--line);border-radius:6px;display:block}
  .card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:.9rem 1rem;margin-bottom:.8rem}
  body.only-fail .card[data-fail="0"]{display:none}
  body.only-dis .card[data-disagree="0"]{display:none}
  .cap{font-size:1.02rem;font-weight:600;line-height:1.35}
  .reg{font-family:var(--mono);font-size:.66rem;padding:.1rem .45rem;border-radius:99px;margin-right:.5rem}
  .verdicts{display:flex;align-items:center;gap:.4rem;margin:.6rem 0}
  .vl{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin-left:.5rem}.vl:first-child{margin-left:0}
  .pill{font-size:.74rem;font-weight:700;padding:.1rem .5rem;border-radius:99px}
  .b1{background:#dcf0e2;color:#1f6b3d}.b05{background:#fdf0d8;color:#8a5a12}.b0{background:#f6dbd8;color:#a3312a}
  .spass{background:#dcf0e2;color:#1f6b3d}.sfail{background:#f6dbd8;color:#a3312a}
  .note{font-size:.82rem;color:#8a5a12;background:#fffbf0;border-left:2px solid #e3c04a;padding:.2rem .5rem;margin:.3rem 0}
  .reasons{margin:.4rem 0;padding-left:1.1rem;font-size:.84rem;color:#a3312a}
  .figs{margin:.4rem 0;padding-left:1.1rem;font-size:.85rem}.figs .miss{color:#a3312a;font-weight:600}
  .ents{font-family:var(--mono);font-size:.75rem;color:var(--dim);margin-top:.3rem}
  details{margin-top:.3rem;font-size:.85rem}summary{cursor:pointer;color:var(--dim);font-size:.78rem}
  @media(max-width:900px){.row{grid-template-columns:1fr}figure{position:static;max-width:230px}}
</style>
<header><h1>Structural cast check — flavor ${FLAVOR}</h1>
<p class="sub"><b>${esc(JUDGE_MODEL)}</b> only enumerates figures + per-figure candidate entities (no joke reasoning); <b>code</b> flags orphan figures, ambiguous figures, unplaceable entities, and cardinality mismatch. Compare the structural FAIL to your rating — it should fire on who-is-who losses and stay quiet on clean wins.</p>
<p><label><input type="checkbox" id="fo"> only structural FAILs</label><label><input type="checkbox" id="do"> only where structural ≠ you</label></p></header>
${sections}
<script>
 document.getElementById('fo').addEventListener('change',(e)=>document.body.classList.toggle('only-fail',e.target.checked))
 document.getElementById('do').addEventListener('change',(e)=>document.body.classList.toggle('only-dis',e.target.checked))
</script>`
const out = path.join(HERE, `cast-eval-${FLAVOR}.html`)
fs.writeFileSync(out, html)
console.log(`\nHTML: ${out}`)
