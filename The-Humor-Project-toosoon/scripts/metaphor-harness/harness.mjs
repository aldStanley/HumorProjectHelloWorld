#!/usr/bin/env node
// Metaphor-track harness: runs flavor 1528's early steps (default S1-S3:
// plain visual read -> metaphor situations -> physical analog) on the four
// test images and builds a side-by-side page for iterating on the
// physical-analogy prompts.
//
//   node scripts/metaphor-harness/harness.mjs
//   node scripts/metaphor-harness/harness.mjs --flavor 1528 --max-step 3 --images img1,img2
//
// Prompts are fetched fresh from the DB every run; every LLM call is cached
// in cache/ keyed by (model + substituted prompts + image), so tweaking a
// prompt re-runs exactly that step and its dependents. Delete cache/ to force
// a fresh run.
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

const FLAVOR = Number(args.flavor ?? 1528)
const MAX_STEP = Number(args['max-step'] ?? 3)

const DEFAULT_IMAGES = {
  img1: 'https://images.almostcrackd.ai/2877cb7c-4ef9-4fcc-921c-8ca87d6ed47f/4b5611ff-cc17-421f-8871-19b1e5aa1eff.png',
  img2: 'https://images.crackd.ai/0fae3aa5-e009-4bbf-a1dc-6d7d84b9191b/89652aa3-758a-477d-8069-d0bb63b3aa98.webp',
  img3: 'https://images.crackd.ai/829fb130-c570-463c-9a87-e67f695108c2/39724cde-17eb-4401-829d-66d6b425657e.webp',
  img4: 'https://images.crackd.ai/ea962639-7491-4396-8e4c-d4b50cd37c21/333933c6-66c2-4e8a-b3c8-e8c4f2730aba.png',
}
const IMAGE_KEYS = args.images ? String(args.images).split(',') : Object.keys(DEFAULT_IMAGES)
const IMAGES = IMAGE_KEYS.map((k) => [k, DEFAULT_IMAGES[k] ?? k])
const mimeOf = (u) => (u.endsWith('.png') ? 'image/png' : u.endsWith('.webp') ? 'image/webp' : 'image/jpeg')

const env = loadEnv(ROOT)
const db = makeDb(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const steps = (await db(`humor_flavor_steps?humor_flavor_id=eq.${FLAVOR}&select=order_by,llm_system_prompt,llm_user_prompt,llm_temperature,llm_input_type_id,llm_model_id&order=order_by`))
  .filter((s) => s.order_by <= MAX_STEP)
if (!steps.length) { console.error(`flavor ${FLAVOR} has no steps <= ${MAX_STEP}`); process.exit(1) }
const models = await db('llm_models?select=id,provider_model_id,is_temperature_supported')
const modelById = Object.fromEntries(models.map((m) => [m.id, m]))
const allCommunityContexts = (await db('community_contexts?select=content&order=id')).map((c) => c.content).filter(Boolean).join('\n')

// Image-level fields (celebrity_recognition etc.) fetched per image URL, so
// prompts can use the ops page's built-in slots and resolve identically here.
const imageFields = {}
await Promise.all(IMAGES.map(async ([key, url]) => {
  const rows = await db(`images?url=eq.${encodeURIComponent(url)}&select=celebrity_recognition,additional_context,image_description`)
  imageFields[key] = rows[0] ?? {}
}))

const sub = (t, priors, img = {}) => (t ?? '').replace(/\$\{([^}]+)\}/g, (f, n) => {
  n = n.trim()
  const m = n.match(/^step(\d+)Output$/)
  if (m) return priors[m[1]] ?? ''
  if (n === 'imageAdditionalContext') return img.additional_context ?? ''
  if (n === 'imageDescription') return img.image_description ?? ''
  if (n === 'celebrityRecognition') return img.celebrity_recognition ?? ''
  if (n === 'allCommunityContexts') return allCommunityContexts
  return f
})

const callOpenAI = async (pmid, sys, usr, temp, b64mime) => {
  const usesMCT = pmid.startsWith('gpt-5') || /^o\d/.test(pmid)
  const content = b64mime ? [{ type: 'text', text: usr }, { type: 'image_url', image_url: { url: `data:${b64mime[1]};base64,${b64mime[0]}` } }] : usr
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: pmid, messages: [{ role: 'system', content: sys }, { role: 'user', content }],
      ...(temp != null && !usesMCT ? { temperature: temp } : {}), ...(usesMCT ? { max_completion_tokens: 32000 } : { max_tokens: 8000 }) }),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(`${pmid} HTTP ${r.status}: ${JSON.stringify(d).slice(0, 300)}`)
  return (d?.choices?.[0]?.message?.content ?? '').trim()
}
const callGemini = async (pmid, sys, usr, b64, mime) => {
  const maxTok = pmid.includes('pro') ? 32768 : 8192
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${pmid}:generateContent?key=${env.GOOGLE_AI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `System: ${sys}\n\nUser: ${usr}` }, ...(b64 ? [{ inline_data: { mime_type: mime, data: b64 } }] : [])] }], generationConfig: { maxOutputTokens: maxTok } }),
  })
  const d = await r.json()
  const t = (d?.candidates?.[0]?.content?.parts || []).map((p) => p?.text ?? '').join('').trim()
  if (!t) throw new Error(`gemini empty: ${JSON.stringify(d).slice(0, 300)}`)
  return t
}
const withRetry = async (fn) => {
  let lastErr
  for (let i = 0; i < 5; i += 1) {
    if (i) await new Promise((r) => setTimeout(r, 2000 * 2 ** i))
    try { const t = await fn(); if (t) return t } catch (e) { lastErr = e; process.stderr.write(`  retry: ${String(e.message).slice(0, 110)}\n`) }
  }
  throw lastErr ?? new Error('empty output after 5 tries')
}
const inflight = new Map()
const cachedCall = (pmid, sys, usr, temp, b64, mime, label) => {
  const key = crypto.createHash('sha256').update([pmid, sys, usr, temp ?? '', b64 ? mime : 'noimg', b64 ? crypto.createHash('sha256').update(b64).digest('hex') : ''].join(' ')).digest('hex').slice(0, 16)
  const f = path.join(CACHE, `${key}.txt`)
  if (fs.existsSync(f)) { process.stderr.write(`${label} cached\n`); return Promise.resolve(fs.readFileSync(f, 'utf8')) }
  if (inflight.has(key)) { process.stderr.write(`${label} shared\n`); return inflight.get(key) }
  const p = withRetry(() => pmid.startsWith('gemini')
    ? callGemini(pmid, sys, usr, b64, mime)
    : callOpenAI(pmid, sys, usr, temp, b64 ? [b64, mime] : null))
    .then((out) => {
      fs.writeFileSync(f, out)
      process.stderr.write(`${label} done (${out.length} chars, ${pmid})\n`)
      return out
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

const imgCacheFile = (url) => path.join(CACHE, `img-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)}.b64`)
const fetchImage = async (url) => {
  const f = imgCacheFile(url)
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8')
  const b64 = Buffer.from(await (await fetch(url)).arrayBuffer()).toString('base64')
  fs.writeFileSync(f, b64)
  return b64
}

// Extraction variants: input-ablated copies of the flavor's extraction step,
// one file each under extract-variants/. All run on the same model as the
// extraction step in the DB (S4), image attached, so the only difference per
// column is which upstream signal the prompt gets.
const VARIANTS_DIR = path.join(HERE, 'extract-variants')
const EXTRACT_VARIANTS = ['physical-only', 'metaphor-only', 'both']
  .map((name) => {
    const f = path.join(VARIANTS_DIR, `${name}.json`)
    return fs.existsSync(f) ? { name, ...JSON.parse(fs.readFileSync(f, 'utf8')) } : null
  })
  .filter(Boolean)
const extractStep = (await db(`humor_flavor_steps?humor_flavor_id=eq.${FLAVOR}&order_by=eq.4&select=llm_model_id,llm_input_type_id,llm_temperature`))[0]
const extractModel = extractStep ? modelById[extractStep.llm_model_id] : null

const limit = pLimit(Number(args.concurrency ?? 4))
const results = {} // results[imgKey] = { steps: {order: text}, extracts: {variant: text} }
await Promise.all(IMAGES.map(([key, url]) => limit(async () => {
  const b64 = await fetchImage(url)
  const mime = mimeOf(url)
  const priors = {}
  for (const st of steps) {
    const m = modelById[st.llm_model_id]
    const temp = m.is_temperature_supported ? st.llm_temperature : null
    const withImg = st.llm_input_type_id === 1
    priors[st.order_by] = await cachedCall(m.provider_model_id, sub(st.llm_system_prompt, priors, imageFields[key]), sub(st.llm_user_prompt, priors, imageFields[key]), temp, withImg ? b64 : null, mime, `${key} S${st.order_by}`)
  }
  const extracts = {}
  if (extractModel) {
    const temp = extractModel.is_temperature_supported ? extractStep.llm_temperature : null
    // Text-only on purpose: attaching the image (or the plain read) would leak
    // the physical arrangement into every column and defeat the ablation.
    await Promise.all(EXTRACT_VARIANTS.map(async (v) => {
      extracts[v.name] = await cachedCall(extractModel.provider_model_id, sub(v.system, priors), sub(v.user, priors), temp, null, mime, `${key} extract:${v.name}`)
    }))
  }
  results[key] = { steps: { ...priors }, extracts }
})))

// ---- uniform scoring pass ----
// Selection stays ablated per variant, but every selected moment (from all
// three columns) is measured against the SAME yardstick: the slots of the
// physical analog core, decomposed ONCE per image so rows are identical and
// columns directly comparable.
const stripFence = (t) => t.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
const parseJson = (t) => { try { return JSON.parse(stripFence(t ?? '')) } catch { return null } }
const ctxKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)

const SCORER_SYSTEM = 'You measure how well community moments fill a meme image\'s physical analog. You only respond in JSON.'
const scorerPrompt = (analog, moments) =>
  'The image\'s physical analog (core = the binding relational skeleton; secondary = nice-to-have texture that never gates):\n' + analog +
  '\n\nCommunity moments:\n' + moments.map((m, i) => `${i + 1}. ${m}`).join('\n') +
  '\n\nFIRST break the analog CORE into its SLOTS — the entities and relations that make the arrangement what it is. Decompose the core ONCE; every moment is measured against that same slot list.\n' +
  'THEN for EACH moment, for EACH slot: name who or what in the moment plays it, with a score 0-1 and a one-sentence reason. A slot-filler must be something that can FEEL or PROJECT an emotion, or a nameable force — NEVER a bare event or activity. A slot nothing in the moment plays gets played_by null and score 0.0. Secondary texture never raises or lowers a score.\n' +
  '"overall" is never higher than the weakest slot\'s score; the reason names the weakest aspect.\n\n' +
  'Output ONLY strict JSON (placeholders are NOT values; never copy them):\n' +
  '{\n  "slots": ["<slot 1>", "<slot 2>"],\n  "moments": [\n    { "index": <the moment\'s number>, "fills": [ { "slot": "<slot, copied VERBATIM from slots>", "played_by": "<who or what plays it, or null>", "score": <0-1>, "reason": "<one sentence>" } ], "overall": { "score": <0-1>, "reason": "<one sentence>" } }\n  ]\n}'

if (extractModel) {
  await Promise.all(IMAGES.map(([key, url]) => limit(async () => {
    const r = results[key]
    const analog = r.steps[3]
    if (!analog) return
    // unique moments across all variants, in first-seen order
    const uniq = []
    const seen = new Set()
    for (const v of EXTRACT_VARIANTS) {
      for (const m of parseJson(r.extracts[v.name])?.matches ?? []) {
        const k = ctxKey(m.context)
        if (m.context && !seen.has(k)) { seen.add(k); uniq.push(m.context) }
      }
    }
    if (!uniq.length) return
    const out = await cachedCall(extractModel.provider_model_id, SCORER_SYSTEM, scorerPrompt(analog, uniq), null, null, null, `${key} score:${uniq.length} moments`)
    const parsed = parseJson(out)
    r.scoring = { slots: parsed?.slots ?? [], byKey: new Map() }
    for (const m of parsed?.moments ?? []) {
      const ctx = uniq[Number(m.index) - 1]
      if (ctx) r.scoring.byKey.set(ctxKey(ctx), m)
    }
  })))
}

// ---- page ----
const esc = (s) => String(s ?? 'null').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const strip = (t) => t.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
const tryParse = (t) => { try { return JSON.parse(strip(t)) } catch { return null } }

const renderStep = (ord, text) => {
  const j = tryParse(text)
  if (Array.isArray(j) && j.every((x) => typeof x === 'string'))
    return `<div class="lbl">S${ord} · metaphor situations</div><ol class="sits">${j.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
  if (j && typeof j.core === 'string')
    return `<div class="lbl">S${ord} · physical analog</div>
      <p class="core">${esc(j.core)}</p>
      <p class="secondary"><span class="k">secondary</span> ${esc(j.secondary ?? '—')}</p>`
  if (j == null && ord === 1)
    return `<div class="lbl">S${ord} · plain visual read</div><p class="read">${esc(text)}</p>`
  return `<div class="lbl">S${ord}</div><pre>${esc(strip(text))}</pre>`
}

const mapTable = (rows, keyField) => `<table>
${(rows ?? []).map((r) => `<tr><td class="slot">${esc(r[keyField])}</td><td class="pb ${r.played_by ? '' : 'nullcast'}">${esc(r.played_by)}</td><td class="score">${r.score ?? '—'}</td></tr>`).join('\n')}
</table>`

// Every column shows the SAME breakdown: the shared scorer's slot fills for
// this moment (measured against the physical analog core). The variant's own
// selection metadata (its metaphor line) stays; its own scores do not.
const matchBlock = (m, scoring) => {
  const scored = scoring?.byKey.get(ctxKey(m.context))
  return `<div class="match">
  <div class="mhead"><span class="score">${scored?.overall?.score ?? '—'}</span><p class="ctx">${esc((m.context ?? '').slice(0, 180))}${(m.context ?? '').length > 180 ? '…' : ''}</p></div>
  ${m.metaphor ? `<p class="metaphor">↳ ${esc(m.metaphor)}</p>` : ''}
  ${scored ? mapTable(scored.fills, 'slot') : '<p class="corefit">not scored</p>'}
</div>`
}

const extractCol = (name, cls, text, scoring) => {
  const j = tryParse(text ?? '')
  const matches = (j?.matches ?? []).slice()
    .sort((a, b) => (scoring?.byKey.get(ctxKey(b.context))?.overall?.score ?? -1) - (scoring?.byKey.get(ctxKey(a.context))?.overall?.score ?? -1))
  return `<div class="col ${cls}">
  <div class="col-head">${esc(name)}</div>
  ${j?.chosen_metaphor ? `<p class="chosen"><span class="k">picked</span> ${esc(j.chosen_metaphor)}${j.chosen_reason ? `<span class="why"> — ${esc(j.chosen_reason)}</span>` : ''}</p>` : ''}
  ${matches.length ? matches.map((m) => matchBlock(m, scoring)).join('\n') : '<p class="nullcast">no matches parsed</p>'}
</div>`
}

const VCLS = { 'physical-only': 'vphys', 'metaphor-only': 'vmet', both: 'vboth' }
let sections = ''
for (const [key, url] of IMAGES) {
  const b64 = fs.readFileSync(imgCacheFile(url), 'utf8')
  const ex = results[key].extracts
  sections += `<section>
  <h2>${esc(key)}</h2>
  <div class="row">
    <figure><img src="data:${mimeOf(url)};base64,${b64}" alt="${esc(key)}"></figure>
    <div class="steps">
      ${Object.entries(results[key].steps).map(([ord, text]) => renderStep(Number(ord), text)).join('\n')}
    </div>
  </div>
  ${Object.keys(ex).length ? `<div class="lbl exlbl">CU context extraction — selected by each signal, all measured against the analog core's slots</div>
  ${results[key].scoring?.slots?.length ? `<p class="slotlist">slots: ${results[key].scoring.slots.map((s) => `<span>${esc(s)}</span>`).join(' · ')}</p>` : ''}
  <div class="cols">
    ${EXTRACT_VARIANTS.map((v) => extractCol(v.name, VCLS[v.name] ?? '', ex[v.name], results[key].scoring)).join('\n')}
  </div>` : ''}
</section>\n`
}

const html = `<title>Physical analog harness — flavor ${FLAVOR}</title>
<style>
  :root{--ink:#23252b;--dim:#6d7078;--line:#e4e2dc;--ground:#fbfaf7;--accent:#7a4a2f;--mono:ui-monospace,'SF Mono',Menlo,monospace}
  body{background:var(--ground);color:var(--ink);font:15px/1.5 system-ui,-apple-system,sans-serif;margin:0;padding:2rem clamp(1rem,3vw,3rem) 4rem}
  header{max-width:90rem;margin:0 auto 2.5rem}
  h1{font-size:1.6rem;letter-spacing:-.01em;margin:0 0 .35rem;text-wrap:balance}
  .sub{color:var(--dim);max-width:70ch;margin:0}
  section{max-width:90rem;margin:0 auto 2.5rem;border-top:1px solid var(--line);padding-top:1.4rem}
  h2{font-size:1rem;margin:0 0 .9rem;font-family:var(--mono);color:var(--dim)}
  .row{display:grid;grid-template-columns:minmax(180px,260px) 1fr;gap:1.5rem;align-items:start}
  figure{margin:0;position:sticky;top:1rem}
  figure img{width:100%;border:1px solid var(--line);border-radius:6px;display:block}
  .steps{background:#fff;border:1px solid var(--line);border-radius:8px;padding:1.1rem 1.3rem;min-width:0}
  .lbl{font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin:1.1rem 0 .4rem}
  .lbl:first-child{margin-top:0}
  .read{font-size:.88rem;color:var(--dim);margin:.2rem 0;max-width:65ch}
  ol.sits{margin:.2rem 0;padding-left:1.4rem}
  ol.sits li{margin:.25rem 0;font-size:.95rem}
  .core{font-size:1.02rem;font-weight:600;margin:.2rem 0;border-left:3px solid var(--accent);padding-left:.7rem;max-width:65ch}
  .secondary{font-size:.88rem;color:var(--dim);margin:.45rem 0 0;max-width:65ch}
  .secondary .k{font-family:var(--mono);font-size:.7rem;text-transform:uppercase;letter-spacing:.06em}
  pre{white-space:pre-wrap;word-break:break-word;background:#f6f5f1;border:1px solid var(--line);border-radius:6px;padding:.6rem;font-size:.75rem;max-height:300px;overflow:auto}
  :root{--vphys:#7a4a2f;--vmet:#3a5fa8;--vboth:#2f7d4f}
  .exlbl{margin-top:1.6rem}
  .cols{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;min-width:0;margin-top:.5rem}
  .col{background:#fff;border:1px solid var(--line);border-radius:8px;padding:1rem;min-width:0}
  .col.vphys{border-top:3px solid var(--vphys)} .col.vmet{border-top:3px solid var(--vmet)} .col.vboth{border-top:3px solid var(--vboth)}
  .col-head{font-weight:600;font-size:.9rem;margin-bottom:.8rem;font-family:var(--mono)}
  .vphys .col-head{color:var(--vphys)} .vmet .col-head{color:var(--vmet)} .vboth .col-head{color:var(--vboth)}
  .match{border:1px solid var(--line);border-radius:6px;padding:.6rem .7rem;margin-bottom:.6rem}
  .vphys .match{background:color-mix(in srgb,var(--vphys) 6%,#fff)} .vmet .match{background:color-mix(in srgb,var(--vmet) 6%,#fff)} .vboth .match{background:color-mix(in srgb,var(--vboth) 6%,#fff)}
  .mhead{display:flex;gap:.6rem;align-items:flex-start}
  .mhead .score{font-family:var(--mono);font-size:.85rem;font-weight:700;font-variant-numeric:tabular-nums}
  .mhead .ctx{margin:0;font-size:.84rem}
  .metaphor{font-size:.8rem;font-style:italic;color:var(--dim);margin:.35rem 0}
  .match table{border-collapse:collapse;width:100%;margin-top:.35rem}
  .match td{padding:.12rem .5rem .12rem 0;vertical-align:top;font-size:.8rem}
  td.slot{color:var(--dim);font-size:.76rem}
  td.pb{font-weight:500}
  td.pb.nullcast,.nullcast{color:#b3372f;font-weight:700}
  td.score{font-family:var(--mono);font-size:.74rem;text-align:right;font-variant-numeric:tabular-nums}
  .corefit{font-size:.76rem;color:var(--dim);margin:.35rem 0 0}
  .slotlist{font-size:.8rem;color:var(--dim);margin:.3rem 0 .2rem;max-width:100ch}
  .slotlist span{font-style:italic}
  .chosen{font-size:.85rem;margin:-.3rem 0 .8rem;border-left:3px solid var(--line);padding-left:.6rem}
  .chosen .k{font-family:var(--mono);font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin-right:.35rem}
  .chosen .why{color:var(--dim);font-size:.78rem}
  @media (max-width:1000px){.cols{grid-template-columns:1fr}}
  @media (max-width:760px){.row{grid-template-columns:1fr}figure{position:static;max-width:280px}}
</style>
<header>
  <h1>Physical analog — flavor ${FLAVOR}, S1–S${MAX_STEP}</h1>
  <p class="sub">Per image: the plain visual read, the metaphor situations, and the physical analog (core + secondary) — then the CU context extraction run three ways on the same model: gated by the physical analog only, by the metaphor situations only, and by both (the current S4). S1–S3 prompts come fresh from the DB; the three extraction prompts live in extract-variants/*.json. Calls are cached by content, so a tweak re-runs only what it touches.</p>
</header>
${sections}`
const outFile = path.join(HERE, `analog-${FLAVOR}.html`)
fs.writeFileSync(outFile, html)
console.log(`\npage: ${outFile}`)

for (const [key] of IMAGES) {
  console.log(`== ${key}`)
  for (const [ord, text] of Object.entries(results[key].steps)) {
    const j = tryParse(text)
    if (j && typeof j.core === 'string') console.log(`  core: ${j.core}`)
    if (Array.isArray(j)) for (const s of j) console.log(`  • ${s}`)
  }
  for (const [name, text] of Object.entries(results[key].extracts)) {
    const j = tryParse(text ?? '')
    console.log(`  [${name}] ${j?.matches?.length ?? 0} matches (scores = shared analog-slot scorer)`)
    if (j?.chosen_metaphor) console.log(`    picked: ${j.chosen_metaphor}`)
    for (const m of j?.matches ?? []) {
      const scored = results[key].scoring?.byKey.get(ctxKey(m.context))
      console.log(`    ${scored?.overall?.score ?? '—'}  ${(m.context ?? '').slice(0, 110)}`)
    }
  }
}
