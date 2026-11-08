#!/usr/bin/env node
// Blind-judge VALIDATION harness for flavor 1544 captions.
//
// The instrument we want to trust: a judge that sees ONLY the image + one
// caption (no context, no scene read) and tries to reconstruct the scene —
// who each visible figure is, why they're posed that way, what the story is.
// A separate grader then compares that BLIND reconstruction against the
// withheld truth (the caption's own context + cast) and scores how much was
// actually recovered.
//
// This script does NOT touch the flavor. It re-derives the caption cards from
// the already-cached S1-S13 chain (shared cache/ with harness.mjs), runs
// judge + grader per caption, and correlates both against Lydia's 38 human
// ratings in human-ratings-1544.json — so we learn whether the judge tracks a
// human BEFORE promoting it into the DB pipeline.
//
//   node scripts/context-recovery-harness/judge.mjs
//   node scripts/context-recovery-harness/judge.mjs --judge-model gemini-2.5-pro
//   node scripts/context-recovery-harness/judge.mjs --count 5 --set 67
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv, makeDb, pLimit } from '../meme-opt/lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const CACHE = path.join(HERE, 'cache') // shared with harness.mjs — caption chain already cached
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
const JUDGE_MODEL = String(args['judge-model'] ?? 'gpt-5.5-2026-04-23') // independent of the writer (gemini-2.5-pro)
const GRADE_MODEL = String(args['grade-model'] ?? JUDGE_MODEL)
const RATINGS = path.join(HERE, `human-ratings-${FLAVOR}.json`)

const env = loadEnv(ROOT)
const db = makeDb(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

// ---- resolve images (same default as harness.mjs) ----
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

// ---- model calls + content cache (same scheme as harness.mjs) ----
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

// ---- blind judge + grader prompts ----
const JUDGE_SYS =
  'You are shown an IMAGE and ONE caption someone wrote to turn that image into a relatable meme. You do NOT have their ' +
  'backstory — only what you can see plus the caption words. Your job is to reconstruct the joke the way an ordinary ' +
  'viewer scrolling past would, and to be HONEST about what you cannot place.\n\n' +
  'A caption casts the visible figures as entities in a little story ("me", "my bestie", "my delusion", "his best friend"). ' +
  'Work figure by figure:\n' +
  '1. For EACH distinct person/figure you can see in the image, say which entity in the caption it is meant to be — or ' +
  'null if the caption gives you no way to tell. Two figures that are both "me"-ish must each get a DIFFERENT anchor ' +
  '(position, action, what they hold) or you cannot tell them apart — say so.\n' +
  '2. For EACH figure, does the caption explain WHY they are posed/looking/emoting the way the image shows? If a figure ' +
  'is looking down, slumped, deadpan, laughing — does the caption give a reason that fits? null if not.\n' +
  '3. Name anything the caption points at ("his reflection", "his future in a cup", a quoted phrase) that you cannot ' +
  'resolve from image + caption alone.\n' +
  'Do not use outside knowledge to fill gaps — if you have to guess, mark it a guess. Score honestly; most captions are ' +
  'NOT perfectly clear.\n\n' +
  'Output ONLY strict JSON (placeholders are NOT values):\n' +
  '{\n' +
  '  "figures": [ { "figure": "<what you see, e.g. \'seated woman looking down-left\'>", "entity_guess": "<caption entity or null>", "confident": <true|false>, "pose_explained": <true|false>, "pose_note": "<why they look that way, or what is unexplained>" } ],\n' +
  '  "unresolved": [ "<pointing word/phrase you could not resolve>" ],\n' +
  '  "story_guess": "<one sentence: the joke as you\'d read it, or \'unclear\'>",\n' +
  '  "cast_clarity": <0-1: can each figure be assigned to a distinct entity>,\n' +
  '  "pose_clarity": <0-1: are the visible poses/expressions explained>,\n' +
  '  "story_clarity": <0-1: do you get the joke>,\n' +
  '  "verdict": "<got_it | partly | lost>"\n' +
  '}'

const JUDGE_USR = (caption) =>
  `The caption written for this image:\n"${caption}"\n\nReconstruct it per the rules. Output only the JSON.`

const GRADE_SYS =
  'You compare a BLIND viewer\'s reconstruction of a meme to the TRUTH the caption\'s author intended. The blind viewer ' +
  'saw only the image + caption; you also get the author\'s real context and the cast they intended. Score how much the ' +
  'blind viewer ACTUALLY recovered — reward correct recovery, penalize confident misreads as well as blanks.\n\n' +
  'Output ONLY strict JSON:\n' +
  '{\n' +
  '  "cast_match": <0-1: did the viewer map the visible figures to the entities the author intended>,\n' +
  '  "pose_match": <0-1: did the viewer\'s pose reasons match the real story (a figure the author never explains counts against the CAPTION, so if the viewer also could not explain it, that is an honest low score)>,\n' +
  '  "story_match": <0-1: did the viewer recover the author\'s actual trigger/joke>,\n' +
  '  "overall_recovered": <0-1: holistic — could this viewer laugh at the joke the author meant>,\n' +
  '  "verdict": "<got_it | partly | lost>",\n' +
  '  "note": "<one sentence: the biggest thing the viewer missed or nailed>"\n' +
  '}'

const castLines = (raw) => {
  const cast = raw?.image_configuration?.cast
  if (!Array.isArray(cast)) return '(no cast recorded)'
  return cast.map((c) => `- ${c.image_party} → ${c.played_by ?? 'null'}${c.score != null ? ` (fit ${c.score})` : ''}`).join('\n')
}
const GRADE_USR = (card, judgeText) =>
  `CAPTION:\n"${card.caption}"\n\nBLIND VIEWER'S RECONSTRUCTION:\n${strip(judgeText)}\n\n` +
  `--- TRUTH (the viewer did NOT see this) ---\nAUTHOR'S CONTEXT:\n${card.context}\n\nINTENDED CAST (image figure → entity):\n${castLines(card.raw)}\n\n` +
  `Score how much the viewer recovered. Output only the JSON.`

// ---- 1. rebuild caption cards from the cached chain ----
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
    for (const c of j.captions) cards.push({ id: crypto.createHash('sha256').update(img.id + '|' + c.caption).digest('hex').slice(0, 10), imageId: img.id, url: img.url, mime, register: c.register ?? '—', caption: c.caption ?? '', context: c.context ?? '', cr: typeof c.context_recovery === 'number' ? c.context_recovery : null, raw: c })
  }
})))

// ---- 2. judge (blind) then grade (truth-compared), per caption ----
await Promise.all(cards.map((card) => limit(async () => {
  const b64 = fs.readFileSync(imgCacheFile(card.url), 'utf8')
  const jt = tempSupported(JUDGE_MODEL) ? 0.2 : null
  card.judgeText = await cachedCall(JUDGE_MODEL, JUDGE_SYS, JUDGE_USR(card.caption), jt, b64, card.mime, `judge ${card.id}`)
  card.judge = tryParse(card.judgeText)
  const gt = tempSupported(GRADE_MODEL) ? 0 : null
  card.gradeText = await cachedCall(GRADE_MODEL, GRADE_SYS, GRADE_USR(card, card.judgeText), gt, null, null, `grade ${card.id}`)
  card.grade = tryParse(card.gradeText)
})))

// ---- 3. join human ratings + correlate ----
const human = Object.fromEntries(JSON.parse(fs.readFileSync(RATINGS, 'utf8')).map((r) => [r.id, r]))
const verdictBand = { got_it: 1, partly: 0.5, lost: 0 }
const band = (x) => (x >= 0.7 ? 1 : x >= 0.4 ? 0.5 : 0)
const bandName = { 1: 'got it', 0.5: 'partly', 0: 'lost' }

for (const c of cards) {
  const h = human[c.id]
  c.human = h ? h.human : null
  c.note = h ? h.note : null
  c.jVerdict = c.judge?.verdict != null ? verdictBand[c.judge.verdict] : null
  c.gOverall = typeof c.grade?.overall_recovered === 'number' ? c.grade.overall_recovered : null
  c.gBand = c.gOverall != null ? band(c.gOverall) : null
}
const rated = cards.filter((c) => c.human != null)

// correlation helpers
const corr = (xs, ys) => { // Pearson
  const n = xs.length; if (!n) return NaN
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i += 1) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2 }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN
}
const agree = (pred) => { const r = rated.filter((c) => pred(c) != null); return { n: r.length, hit: r.filter((c) => pred(c) === c.human).length } }

const meanBy = (band, get) => {
  const out = {}
  for (const b of [0, 0.5, 1]) {
    const vs = rated.filter((c) => c.human === b).map(get).filter((v) => v != null)
    out[b] = vs.length ? vs.reduce((a, x) => a + x, 0) / vs.length : null
  }
  return out
}

// ---- report ----
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—')
console.log(`\n=== BLIND JUDGE vs ${rated.length} HUMAN RATINGS ===`)
console.log(`judge model: ${JUDGE_MODEL} | grader: ${GRADE_MODEL} | writer was gemini-2.5-pro\n`)

const cr = { n: rated.filter((c) => c.cr != null).length, hit: rated.filter((c) => c.cr != null && band(c.cr) === c.human).length }
const jv = agree((c) => c.jVerdict)
const gb = agree((c) => c.gBand)
console.log('band agreement with human (got it / partly / lost):')
console.log(`  self-score context_recovery : ${pct(cr.hit, cr.n)}  (${cr.hit}/${cr.n})   [the saturating baseline]`)
console.log(`  blind judge verdict         : ${pct(jv.hit, jv.n)}  (${jv.hit}/${jv.n})`)
console.log(`  grader overall_recovered    : ${pct(gb.hit, gb.n)}  (${gb.hit}/${gb.n})`)

console.log('\nPearson r vs human 0/0.5/1 (higher = tracks the human better):')
const rHuman = rated.map((c) => c.human)
console.log(`  self-score context_recovery : ${corr(rated.map((c) => c.cr ?? 0), rHuman).toFixed(2)}`)
console.log(`  blind judge story_clarity   : ${corr(rated.map((c) => c.judge?.story_clarity ?? 0), rHuman).toFixed(2)}`)
console.log(`  blind judge cast_clarity    : ${corr(rated.map((c) => c.judge?.cast_clarity ?? 0), rHuman).toFixed(2)}`)
console.log(`  blind judge pose_clarity    : ${corr(rated.map((c) => c.judge?.pose_clarity ?? 0), rHuman).toFixed(2)}`)
console.log(`  grader overall_recovered    : ${corr(rated.map((c) => c.gOverall ?? 0), rHuman).toFixed(2)}`)
console.log(`  grader cast_match           : ${corr(rated.map((c) => c.grade?.cast_match ?? 0), rHuman).toFixed(2)}`)
console.log(`  grader pose_match           : ${corr(rated.map((c) => c.grade?.pose_match ?? 0), rHuman).toFixed(2)}`)
console.log(`  grader story_match          : ${corr(rated.map((c) => c.grade?.story_match ?? 0), rHuman).toFixed(2)}`)

console.log('\nmean grader scores by YOUR band (want: lost < partly < got it, i.e. monotonic increase):')
const gm = { overall: meanBy(0, (c) => c.gOverall), cast: meanBy(0, (c) => c.grade?.cast_match), pose: meanBy(0, (c) => c.grade?.pose_match), story: meanBy(0, (c) => c.grade?.story_match), cr: meanBy(0, (c) => c.cr) }
const fmt = (v) => (v == null ? ' — ' : v.toFixed(2))
console.log('                     lost   partly  got it')
for (const [k, m] of Object.entries(gm)) console.log(`  ${k.padEnd(18)} ${fmt(m[0])}   ${fmt(m[0.5])}   ${fmt(m[1])}`)

console.log('\n=== where the blind judge DISAGREES with you (biggest gaps first) ===')
const gap = rated.filter((c) => c.gBand != null).map((c) => ({ c, d: Math.abs(c.gBand - c.human) })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d)
for (const { c } of gap.slice(0, 12)) {
  console.log(`\n[you ${bandName[c.human]} · judge ${c.judge?.verdict} · grader ${c.gOverall}] (${c.register})`)
  console.log(`  "${c.caption}"`)
  if (c.note) console.log(`  your note: ${c.note}`)
  console.log(`  judge story: ${c.judge?.story_guess ?? '?'}`)
  if (c.grade?.note) console.log(`  grader: ${c.grade.note}`)
}

// ---- HTML: every caption, human vs judge vs grader, judge reconstruction ----
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const REG = { in_scene: '#0ea5e9', watched_scene: '#a855f7', internal: '#f59e0b' }
const chip = (b) => b == null ? '<span class="pill dim">—</span>' : `<span class="pill b${String(b).replace('.', '')}">${bandName[b]}</span>`
const figRow = (f) => `<tr><td>${esc(f.figure)}</td><td class="${f.entity_guess ? '' : 'miss'}">${esc(f.entity_guess ?? 'null')}</td><td>${f.confident ? '✓' : '?'}</td><td class="${f.pose_explained ? '' : 'miss'}">${f.pose_explained ? 'pose ✓' : 'pose ✗'}</td></tr>`
const cardHtml = (c) => `<div class="card" data-gap="${c.gBand != null && c.human != null && c.gBand !== c.human ? 1 : 0}">
  <div class="cap"><span class="reg" style="background:${REG[c.register] ?? '#999'}22;color:${REG[c.register] ?? '#666'}">${esc(c.register)}</span>${esc(c.caption)}</div>
  <div class="verdicts">
    <span class="vl">you</span>${chip(c.human)}
    <span class="vl">judge (blind)</span>${chip(c.jVerdict)}
    <span class="vl">grader</span>${chip(c.gBand)} <span class="num">${c.gOverall ?? '—'}</span>
    <span class="vl">self-CR</span><span class="num">${c.cr ?? '—'}</span>
  </div>
  ${c.note ? `<p class="note">your note: ${esc(c.note)}</p>` : ''}
  <p class="story"><b>judge read it as:</b> ${esc(c.judge?.story_guess ?? '?')}</p>
  ${c.grade?.note ? `<p class="gnote"><b>grader:</b> ${esc(c.grade.note)}</p>` : ''}
  ${Array.isArray(c.judge?.figures) && c.judge.figures.length ? `<table class="figs"><tr><th>figure seen</th><th>entity guess</th><th>sure?</th><th>pose</th></tr>${c.judge.figures.map(figRow).join('')}</table>` : ''}
  ${Array.isArray(c.judge?.unresolved) && c.judge.unresolved.length ? `<p class="unres"><b>couldn't resolve:</b> ${c.judge.unresolved.map(esc).join(' · ')}</p>` : ''}
  <div class="scores">cast ${c.grade?.cast_match ?? '—'} · pose ${c.grade?.pose_match ?? '—'} · story ${c.grade?.story_match ?? '—'} <span class="dim">| judge clarity: cast ${c.judge?.cast_clarity ?? '—'} pose ${c.judge?.pose_clarity ?? '—'} story ${c.judge?.story_clarity ?? '—'}</span></div>
  <details><summary>raw judge + grade JSON</summary><pre>${esc(strip(c.judgeText ?? ''))}\n---\n${esc(strip(c.gradeText ?? ''))}</pre></details>
</div>`

let sections = ''
for (const img of imageRows) {
  const mine = cards.filter((c) => c.imageId === img.id)
  const b64 = fs.readFileSync(imgCacheFile(img.url), 'utf8')
  sections += `<section><h2>${esc(img.id.slice(0, 8))}</h2><div class="row"><figure><img src="data:${mimeOf(img.url)};base64,${b64}"></figure><div class="cards">${mine.map(cardHtml).join('\n')}</div></div></section>\n`
}
const html = `<title>Blind judge validation — flavor ${FLAVOR}</title>
<style>
  :root{--ink:#23252b;--dim:#6d7078;--line:#e4e2dc;--ground:#fbfaf7;--mono:ui-monospace,Menlo,monospace}
  body{background:var(--ground);color:var(--ink);font:15px/1.5 system-ui,sans-serif;margin:0;padding:2rem clamp(1rem,3vw,3rem) 4rem}
  header{max-width:80rem;margin:0 auto 1.5rem}h1{font-size:1.5rem;margin:0 0 .4rem}
  .sub{color:var(--dim);max-width:74ch}
  label{font-size:.85rem;color:var(--dim);cursor:pointer}
  section{max-width:80rem;margin:0 auto 2.5rem;border-top:1px solid var(--line);padding-top:1.2rem}
  h2{font-size:1rem;font-family:var(--mono);margin:0 0 .8rem}
  .row{display:grid;grid-template-columns:minmax(140px,210px) 1fr;gap:1.4rem;align-items:start}
  figure{margin:0;position:sticky;top:1rem}figure img{width:100%;border:1px solid var(--line);border-radius:6px;display:block}
  .card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:.9rem 1rem;margin-bottom:.8rem}
  body.only-gaps .card[data-gap="0"]{display:none}
  .cap{font-size:1.02rem;font-weight:600;line-height:1.35}
  .reg{font-family:var(--mono);font-size:.66rem;padding:.1rem .45rem;border-radius:99px;margin-right:.5rem;white-space:nowrap}
  .verdicts{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin:.6rem 0}
  .vl{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin-left:.5rem}
  .vl:first-child{margin-left:0}
  .pill{font-size:.74rem;font-weight:700;padding:.1rem .5rem;border-radius:99px}
  .b1{background:#dcf0e2;color:#1f6b3d}.b05{background:#fdf0d8;color:#8a5a12}.b0{background:#f6dbd8;color:#a3312a}.dim{color:var(--dim)}
  .num{font-family:var(--mono);font-size:.78rem;color:var(--dim)}
  .note{font-size:.82rem;color:#8a5a12;background:#fffbf0;border-left:2px solid #e3c04a;padding:.2rem .5rem;margin:.3rem 0}
  .story,.gnote,.unres{font-size:.85rem;margin:.35rem 0}
  .gnote{color:var(--dim)}.unres{color:#a3312a}
  table.figs{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.8rem}
  .figs th{text-align:left;font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);font-weight:600;border-bottom:1px solid var(--line);padding:.2rem .5rem .2rem 0}
  .figs td{padding:.2rem .5rem .2rem 0;border-bottom:1px solid #f0efea}
  .figs td.miss{color:#a3312a;font-weight:600}
  .scores{font-family:var(--mono);font-size:.74rem;color:var(--ink);margin-top:.4rem}
  details{margin-top:.4rem;font-size:.78rem;color:var(--dim)}
  pre{white-space:pre-wrap;word-break:break-word;background:#f6f5f1;border:1px solid var(--line);border-radius:6px;padding:.5rem;font-size:.68rem;max-height:320px;overflow:auto}
  @media(max-width:900px){.row{grid-template-columns:1fr}figure{position:static;max-width:230px}}
</style>
<header><h1>Blind judge validation — flavor ${FLAVOR}</h1>
<p class="sub">Each caption judged by <b>${esc(JUDGE_MODEL)}</b> seeing only image + caption (writer was gemini-2.5-pro), then graded against the withheld context. Compare the three verdicts: <b>you</b>, the blind <b>judge</b>, the truth-compared <b>grader</b>. If judge/grader line up with you, the instrument works.</p>
<p><label><input type="checkbox" id="gapsOnly"> show only captions where the grader disagrees with you</label></p></header>
${sections}
<script>document.getElementById('gapsOnly').addEventListener('change',(e)=>document.body.classList.toggle('only-gaps',e.target.checked))</script>`
const out = path.join(HERE, `judge-eval-${FLAVOR}.html`)
fs.writeFileSync(out, html)
console.log(`\n\nHTML: ${out}`)
