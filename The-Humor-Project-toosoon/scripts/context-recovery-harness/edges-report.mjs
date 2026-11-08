#!/usr/bin/env node
// Run the caption step and SHOW the edge scores — one page, image beside every
// caption, each score labelled with the two artifacts it matches, and the
// mechanical validator's verdict on top.
//
// S1-S12 come straight from the shared cache (their prompts didn't change), so
// only the caption step actually calls a model.
//
//   node scripts/context-recovery-harness/edges-report.mjs
//   node scripts/context-recovery-harness/edges-report.mjs --count 3
//   node scripts/context-recovery-harness/edges-report.mjs --step 7   (after porting)
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv, makeDb, pLimit } from '../meme-opt/lib.mjs'
import { isSpanOf, repairSpan, validateCard } from './validate-edges.mjs'

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
const STEP = Number(args.step ?? 13)

const env = loadEnv(ROOT)
const db = makeDb(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const imageRows = []
if (args.images) {
  for (const tok of String(args.images).split(',').map((s) => s.trim())) {
    const [row] = await db(`images?id=eq.${tok}&select=id,url,additional_context`)
    imageRows.push(row)
  }
} else {
  const maps = await db(`study_image_set_image_mappings?study_image_set_id=eq.${SET}&select=images(id,url,additional_context)&order=image_id.asc&limit=${COUNT}`)
  imageRows.push(...maps.map((m) => m.images))
}
const mimeOf = (u) => (u.endsWith('.png') ? 'image/png' : u.endsWith('.webp') ? 'image/webp' : 'image/jpeg')

const steps = (await db(`humor_flavor_steps?humor_flavor_id=eq.${FLAVOR}&select=order_by,description,llm_system_prompt,llm_user_prompt,llm_temperature,llm_input_type_id,llm_model_id&order=order_by`)).filter((s) => s.order_by <= STEP)
const stepDesc = steps.find((s) => s.order_by === STEP)?.description ?? `S${STEP}`
const models = await db('llm_models?select=id,provider_model_id,is_temperature_supported')
const modelById = Object.fromEntries(models.map((m) => [m.id, m]))

const sub = (t, priors, extra) => (t ?? '').replace(/\$\{([^}]+)\}/g, (f, n) => {
  n = n.trim(); const m = n.match(/^step(\d+)Output$/)
  if (m) return priors[m[1]] ?? ''
  if (n in extra) return extra[n]
  return f
})

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

// ---- carry the upstream ROLE FIT down onto the metaphor rows ----
// S13's per-element score only asks whether the caption NAMES the party in a
// metaphor slot. Whether that party actually FILLS the slot was already scored
// one step up, in element_map — and that score is where a backwards mapping
// shows up ("the delusion of being the chill girl" playing "your current, wiser
// self": element_map 0.7, "an inverted fit"; S13 1.0, because the caption does
// say it). The number never reached the caption card, so the row read as a
// clean 1. Join it back on so the page shows both and the validator can bound
// the naming score by the fit.
const normKey = (s) => String(s ?? '').toLowerCase().replace(/[‘’“”]/g, "'").replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()

// Deep-walk, so this keeps working if element_map moves steps or gets nested.
const walkElementMaps = (node, out) => {
  if (Array.isArray(node)) { node.forEach((n) => walkElementMaps(n, out)); return }
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node.element_map)) {
    for (const e of node.element_map) {
      out.push({ context: node.context ?? '', metaphor: node.metaphor ?? '', element: e?.element ?? '', score: typeof e?.score === 'number' ? e.score : null, reason: e?.reason ?? '' })
    }
  }
  for (const v of Object.values(node)) walkElementMaps(v, out)
}
const collectElementFits = (priors) => {
  const out = []
  // numeric keys iterate ascending, so the EARLIEST step that scored an
  // element wins — that's the one that did the mapping, not a later restatement
  for (const raw of Object.values(priors)) { const j = tryParse(raw); if (j) walkElementMaps(j, out) }
  return out
}
// A card and its element_map are both built from ONE context; fall back to the
// metaphor when a downstream step rewrote the context string.
const attachRoleFits = (card, fits) => {
  const rows = Array.isArray(card?.element_allusions) ? card.element_allusions : []
  if (!rows.length || !fits.length) return
  const byCtx = fits.filter((f) => normKey(f.context) === normKey(card?.context))
  const scoped = byCtx.length ? byCtx : fits.filter((f) => normKey(f.metaphor) === normKey(card?.metaphor))
  for (const r of rows) {
    const hit = scoped.find((f) => normKey(f.element) === normKey(r.element))
    if (!hit || hit.score == null) continue
    r.role_fit = hit.score
    if (hit.reason) r.role_fit_reason = hit.reason
  }
}

// ---- run the chain, keep only the target step's cards ----
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
  const j = tryParse(priors[STEP])
  if (!j || !Array.isArray(j.captions)) { process.stderr.write(`${img.id.slice(0, 8)} S${STEP}: no captions array\n`); return }
  const fits = collectElementFits(priors)
  for (const c of j.captions) {
    attachRoleFits(c, fits)
    cards.push({ imageId: img.id, url: img.url, card: c, check: validateCard(c) })
  }
})))

// ---- render ----
// The ops step-output view, ported from ops-client.tsx's <JsonTree> to plain
// HTML/CSS so the card looks exactly like it does in the app: mono uppercase
// labels in a left rail, values on one vertical rule, parallel objects (cast,
// element_allusions) as numbered comparison tables, scores in emerald/rose.
//
// Three things are ADDED on top of that view, all of them things the ops page
// cannot show you:
//   1. an EDGE CHIP under every scoring label — the two artifacts that score
//      matches, and the direction ("ANALOG → IMAGE"). A bare label like
//      "physical fit" reads as a mood; an edge reads as a claim.
//   2. caption_span rendered as a chip that is green only when it really is a
//      substring of THIS caption — the same test validate-edges.mjs runs.
//   3. the validator's verdict and violations, above the card.
//   4. ROLE FIT on every metaphor-element row — the element_map score from the
//      step upstream, which the caption card never carried. "metaphor" scores
//      naming; "role fit" scores whether the party belongs in the slot at all.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ops-client.tsx: fields that ARE the step's output, bolded inside the tree
const MAIN_OUTPUT_KEYS = new Set(['figure', 'entity', 'context', 'moment', 'situation'])

// Which two artifacts each score matches. Five artifacts exist; a viewer sees
// only IMAGE and CAPTION, so an edge that never touches one of those two is a
// score no reader could have earned.
const EDGES = {
  metaphor_recovery: ['CAPTION+IMAGE', 'METAPHOR'],
  analog_to_image: ['ANALOG', 'IMAGE'],
  analog_to_caption: ['ANALOG', 'CAPTION'],
  physical_fit: ['ANALOG', 'IMAGE+CAPTION'],
  context_to_caption: ['CONTEXT', 'CAPTION'],
  context_recovery: ['CAPTION+IMAGE', 'CONTEXT'],
  score: ['IMAGE figure', 'CAPTION entity'],
  allusion: ['METAPHOR slot', 'CAPTION'],
  role_fit: ['CONTEXT party', 'METAPHOR role'],
  caption_span: ['this row', 'CAPTION'],
  match_overall: ['the match', 'itself'],
}
const edgeChip = (k) =>
  EDGES[k] ? `<span class="edge"><b>${esc(EDGES[k][0])}</b><i>→</i><b>${esc(EDGES[k][1])}</b></span>` : ''

// Display labels only — the JSON keys are what the step emits, so they stay.
// "allusion" is really the metaphor mapping: which caption entity fills which
// slot of the metaphor, so say metaphor.
const LABELS = {
  element_allusions: 'metaphor elements',
  element: 'metaphor element',
  allusion: 'metaphor',
}

const labelFor = (k, isMoment) =>
  k === 'context' && isMoment ? 'sad-girl moment' : LABELS[k] ?? k.replace(/_/g, ' ')

const spanChip = (span, caption) => {
  if (span === '') return '<span class="span none">✗ the caption never names it</span>'
  if (isSpanOf(span, caption)) return `<span class="span ok">“${esc(span)}”</span>`
  const fix = repairSpan(span, caption)
  return fix
    ? `<span class="span fix" title="the model stitched two verbatim runs with “…”; the checker kept the longest one">“${esc(fix)}” — repaired from “${esc(span)}”</span>`
    : `<span class="span bad">“${esc(span)}” — not in this caption</span>`
}

const depthOf = (v) => {
  if (v == null || typeof v !== 'object') return 0
  const vals = Array.isArray(v) ? v : Object.values(v)
  return 1 + vals.reduce((m, x) => Math.max(m, depthOf(x)), 0)
}
const isTableItem = (v) => typeof v === 'object' && v !== null && !Array.isArray(v) && depthOf(v) <= 2

function tree(data, caption, o = {}) {
  if (data == null) return '<span class="nul">null</span>'
  if (typeof data === 'string') {
    if (o.key === 'caption_span') return spanChip(data, caption)
    return `<span class="${o.emphasize ? 'v emph' : o.bold ? 'v bold' : 'v'}">${esc(data)}</span>`
  }
  if (typeof data === 'number') {
    const isScore = data >= 0 && data <= 1
    const cls = !isScore ? '' : data >= 0.8 ? ' good' : data <= 0.4 ? ' bad' : ' mid'
    return `<span class="num${cls}">${data}</span>`
  }
  if (typeof data === 'boolean') return `<span class="num ${data ? 'good' : 'bad'}">${data}</span>`

  if (Array.isArray(data)) {
    if (!data.length) return '<span class="nul">(empty list)</span>'
    // 2–4 parallel objects → one column per item, one row per field
    if (data.length >= 2 && data.length <= 4 && data.every(isTableItem)) {
      const keys = []
      data.forEach((it) => Object.keys(it).forEach((k) => { if (!keys.includes(k)) keys.push(k) }))
      return `<div class="tw"><table class="cmp">
        <thead><tr><th class="rl"></th>${data.map((_, i) => `<th>${i + 1}</th>`).join('')}</tr></thead>
        <tbody>${keys.map((k) => `<tr><td class="rl">${esc(labelFor(k, false))}${edgeChip(k)}</td>${data
          .map((it) => `<td>${k in it
            ? tree(it[k], caption, { key: k, emphasize: k === 'caption', bold: MAIN_OUTPUT_KEYS.has(k) })
            : '<span class="nul">—</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`
    }
    return `<div class="blocks">${data.map((it, i) => (typeof it === 'object' && it !== null
      ? `<div class="blk"><p class="idx">${i + 1}</p>${tree(it, caption)}</div>`
      : `<div class="blk">${tree(it, caption)}</div>`)).join('')}</div>`
  }

  const record = data
  const isMoment = 'context' in record && !('caption' in record)
  const entries = Object.entries(record).filter(([k]) => !(k === 'register' && isMoment))
  if (!entries.length) return '<span class="nul">(empty)</span>'
  return `<div class="kv">${entries.map(([k, v], i) => {
    const inline = v == null || ['string', 'number', 'boolean'].includes(typeof v)
    const lab = `${esc(labelFor(k, isMoment))}${edgeChip(k)}`
    return inline
      ? `<p class="lab">${lab}</p><div class="val">${tree(v, caption, { key: k, emphasize: k === 'caption', bold: MAIN_OUTPUT_KEYS.has(k) })}</div>`
      : `<p class="lab full${i > 0 ? ' gap' : ''}">${lab}</p><div class="val full nest">${tree(v, caption)}</div>`
  }).join('')}</div>`
}

// the caption with every cast span highlighted, so the naming is visible at once
const markSpans = (caption, spans) => {
  const hits = []
  for (const s of spans) {
    if (!s) continue
    const i = caption.toLowerCase().indexOf(String(s).toLowerCase())
    if (i >= 0 && !hits.some((h) => i < h.end && i + s.length > h.start)) hits.push({ start: i, end: i + s.length })
  }
  hits.sort((a, b) => a.start - b.start)
  let out = '', at = 0
  for (const h of hits) { out += `${esc(caption.slice(at, h.start))}<mark>${esc(caption.slice(h.start, h.end))}</mark>`; at = h.end }
  return out + esc(caption.slice(at))
}

const cardHtml = ({ card: c, check }, i) => {
  const cap = c.caption ?? ''
  const spans = (c.image_configuration?.cast ?? []).map((e) => (isSpanOf(e.caption_span, cap) ? e.caption_span : repairSpan(e.caption_span, cap) ?? e.caption_span))
  const reps = check.repairs ?? []
  return `<article class="card ${check.ok ? 'pass' : 'fail'}" data-fail="${check.ok ? 0 : 1}">
  <header class="ch">
    <p class="idx">${i + 1}</p>
    <span class="verdict ${check.ok ? 'pass' : 'fail'}">${check.ok ? 'every score is evidenced' : `${check.violations.length} violation${check.violations.length > 1 ? 's' : ''}`}</span>
    ${reps.length ? `<span class="verdict fix">${reps.length} span${reps.length > 1 ? 's' : ''} repaired</span>` : ''}
  </header>
  ${check.ok ? '' : `<ul class="viols">${check.violations.map((v) => `<li><code>${esc(v.code)}</code> ${esc(v.msg)}</li>`).join('')}</ul>`}
  ${reps.length ? `<ul class="reps">${reps.map((r) => `<li><code>${esc(r.code)}</code> ${esc(r.msg)}</li>`).join('')}</ul>` : ''}
  ${tree(c, cap)}
  <details><summary>the caption with every cast span highlighted, and the raw JSON</summary>
    <p class="marked">${markSpans(cap, spans)}</p>
    <pre>${esc(JSON.stringify(c, null, 2))}</pre>
  </details>
</article>`
}

const totalViol = cards.reduce((a, c) => a + c.check.violations.length, 0)
const totalReps = cards.reduce((a, c) => a + (c.check.repairs?.length ?? 0), 0)
const failCards = cards.filter((c) => !c.check.ok).length

let sections = ''
for (const img of imageRows) {
  const mine = cards.filter((c) => c.imageId === img.id)
  if (!mine.length) continue
  const b64 = fs.readFileSync(imgCacheFile(img.url), 'utf8')
  sections += `<section><div class="row"><figure><img src="data:${mimeOf(img.url)};base64,${b64}" alt="the image these captions are written for"><figcaption>${esc(img.id.slice(0, 8))}</figcaption></figure><div class="cards"><p class="secthead">captions</p>${mine.map(cardHtml).join('\n')}</div></div></section>\n`
}

const html = `<title>Edge scores — flavor ${FLAVOR} ${stepDesc}</title>
<style>
  /* the ops palette (src/app/globals.css) — the page this view belongs to.
     Light is the default, dark follows the OS, and an explicit data-theme on
     the root beats both so the viewer's own toggle works in either direction. */
  :root,:root[data-theme="light"]{
    --canvas:255 248 238; --ink:54 32 22; --muted:132 88 63; --accent-strong:190 18 60;
    --panel:255 254 250; --gloss:255 255 255; --good:5 150 105; --bad:225 29 72; --mid:180 83 9;
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  @media (prefers-color-scheme:dark){:root{
    --canvas:8 6 8; --ink:255 248 240; --muted:228 196 170; --accent-strong:225 29 72;
    --panel:26 18 22; --gloss:60 52 52; --good:52 211 153; --bad:251 113 133; --mid:245 158 11}}
  :root[data-theme="dark"]{
    --canvas:8 6 8; --ink:255 248 240; --muted:228 196 170; --accent-strong:225 29 72;
    --panel:26 18 22; --gloss:60 52 52; --good:52 211 153; --bad:251 113 133; --mid:245 158 11}

  *{box-sizing:border-box}
  body{background:rgb(var(--canvas));color:rgb(var(--ink));margin:0;
       font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;
       padding:1.5rem clamp(.75rem,2.5vw,2.5rem) 5rem}
  header.top{max-width:78rem;margin:0 auto 1.5rem}
  h1{font-size:1.3rem;font-weight:700;margin:0 0 .35rem;text-wrap:balance}
  .sub{color:rgb(var(--muted));max-width:68ch;margin:0 0 .9rem;font-size:.92rem}
  .tally{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
  .tag{font:600 .74rem/1 var(--mono);padding:.4rem .65rem;border-radius:99px;
       background:rgb(var(--panel));border:1px solid rgb(var(--gloss)/.5);color:rgb(var(--muted))}
  .tag.bad{background:rgb(var(--bad)/.13);color:rgb(var(--bad));border-color:transparent}
  .tag.good{background:rgb(var(--good)/.14);color:rgb(var(--good));border-color:transparent}
  .tag.fix{background:rgb(var(--mid)/.14);color:rgb(var(--mid));border-color:transparent}
  label.only{font-size:.85rem;color:rgb(var(--muted));cursor:pointer;user-select:none;
             display:inline-flex;align-items:center;gap:.35rem}
  label.only:focus-within{outline:2px solid rgb(var(--accent-strong));outline-offset:3px;border-radius:4px}
  .legend{display:grid;gap:.3rem;margin:.9rem 0 0;padding:.7rem .9rem;max-width:72ch;
          background:rgb(var(--panel));border:1px solid rgb(var(--gloss)/.5);border-radius:8px;
          font-size:.84rem;color:rgb(var(--muted))}
  .legend b{color:rgb(var(--ink));font:600 .74rem var(--mono);letter-spacing:.04em}

  section{max-width:78rem;margin:0 auto 1.75rem;border-top:1px solid rgb(var(--ink)/.14);padding-top:1.2rem}
  .row{display:grid;grid-template-columns:minmax(140px,200px) 1fr;gap:1.4rem;align-items:start}
  figure{margin:0;position:sticky;top:.8rem}
  figure img{width:100%;display:block;border-radius:8px;border:1px solid rgb(var(--gloss)/.5)}
  figcaption{font:.66rem var(--mono);color:rgb(var(--muted));margin-top:.35rem;letter-spacing:.06em}
  .cards{min-width:0;display:grid;gap:1rem}
  .secthead{font:600 .62rem/1 var(--mono);text-transform:uppercase;letter-spacing:.18em;
            color:rgb(var(--muted));margin:0}

  /* a card is the ops step-output panel; the left rule carries the verdict */
  .card{background:rgb(var(--panel));border:1px solid rgb(var(--gloss)/.5);
        border-left:3px solid rgb(var(--good));border-radius:8px;padding:1rem 1.1rem;min-width:0}
  .card.fail{border-left-color:rgb(var(--bad))}
  body.only-fails .card[data-fail="0"]{display:none}
  .ch{display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap;margin-bottom:.7rem}
  .idx{font:600 .58rem/1 var(--mono);text-transform:uppercase;letter-spacing:.18em;
       color:rgb(var(--accent-strong));margin:0}
  .verdict{font:700 .68rem/1 var(--mono);padding:.3rem .55rem;border-radius:99px}
  .verdict.pass{background:rgb(var(--good)/.14);color:rgb(var(--good))}
  .verdict.fail{background:rgb(var(--bad)/.13);color:rgb(var(--bad))}
  .verdict.fix{background:rgb(var(--mid)/.14);color:rgb(var(--mid))}
  .viols{margin:0 0 .9rem;padding-left:1.1rem;font-size:.82rem;color:rgb(var(--bad))}
  .viols li{margin:.2rem 0}
  .viols code{font:.72rem var(--mono);background:rgb(var(--bad)/.12);padding:.05rem .3rem;border-radius:3px}
  .reps{margin:0 0 .9rem;padding-left:1.1rem;font-size:.82rem;color:rgb(var(--mid))}
  .reps li{margin:.2rem 0}
  .reps code{font:.72rem var(--mono);background:rgb(var(--mid)/.12);padding:.05rem .3rem;border-radius:3px}

  /* --- the JsonTree, one-for-one with ops-client.tsx --- */
  .kv{display:grid;grid-template-columns:minmax(4rem,max-content) 1fr;column-gap:.75rem;row-gap:.375rem}
  .lab{margin:0;max-width:12rem;overflow-wrap:anywhere;padding-top:2px;
       font:500 10px/1.35 var(--mono);text-transform:uppercase;letter-spacing:.12em;color:rgb(var(--muted))}
  .lab.full{grid-column:1/-1;max-width:none}
  .lab.gap{margin-top:.75rem}
  .val{min-width:0;font-size:12px;line-height:1.4}
  .val.full{grid-column:1/-1;padding-left:.5rem}
  .v{white-space:pre-wrap;font-size:12px;line-height:1.4;color:rgb(var(--ink))}
  .v.bold{font-weight:700}
  .v.emph{font-size:15px;font-weight:700}
  .num{font:12px var(--mono);color:rgb(var(--ink));font-variant-numeric:tabular-nums}
  .num.good{font-weight:700;color:rgb(var(--good))}
  .num.bad{font-weight:700;color:rgb(var(--bad))}
  .num.mid{font-weight:700;color:rgb(var(--ink))}
  .nul{font-size:12px;color:rgb(var(--muted))}
  .blocks{display:grid}
  .blk{padding:1.4rem 0;border-top:1px solid rgb(var(--ink)/.18)}
  .blk:first-child{padding-top:0;border-top:0}
  .blk:last-child{padding-bottom:0}
  .blk .idx{margin-bottom:.375rem}
  .tw{overflow-x:auto}
  .cmp{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}
  .cmp th{padding:0 .5rem .25rem;text-align:left;vertical-align:bottom;
          font:600 9px/1.3 var(--mono);text-transform:uppercase;letter-spacing:.18em;color:rgb(var(--accent-strong));
          border-left:1px solid rgb(var(--gloss)/.45)}
  /* ops uses 6rem here; the edge chip under each row label needs the extra room */
  .cmp th.rl{width:7.5rem;border-left:0;padding:0}
  .cmp tr{border-top:1px solid rgb(var(--ink)/.1)}
  .cmp td{padding:.25rem .5rem;vertical-align:top;border-left:1px solid rgb(var(--gloss)/.45)}
  .cmp td.rl{overflow-wrap:anywhere;padding:5px .5rem .25rem 0;border-left:0;
             font:500 10px/1.35 var(--mono);text-transform:uppercase;letter-spacing:.12em;color:rgb(var(--muted))}

  /* --- the additions --- */
  .edge{display:block;margin-top:.2rem;font:600 8.5px/1.3 var(--mono);letter-spacing:.06em;
        text-transform:none;color:rgb(var(--muted));opacity:.85}
  .edge b{color:rgb(var(--ink));font-weight:700}
  .edge i{font-style:normal;padding:0 .25rem;color:rgb(var(--accent-strong))}
  .span{display:inline-block;max-width:100%;overflow-wrap:anywhere;
        font:11px/1.4 var(--mono);padding:.1rem .35rem;border-radius:4px}
  .span.ok{background:rgb(var(--good)/.14);color:rgb(var(--good))}
  .span.fix{background:rgb(var(--mid)/.14);color:rgb(var(--mid))}
  .span.bad,.span.none{background:rgb(var(--bad)/.13);color:rgb(var(--bad))}
  details{margin-top:.9rem;font-size:.8rem}
  summary{cursor:pointer;color:rgb(var(--muted));font:.74rem var(--mono)}
  summary:focus-visible{outline:2px solid rgb(var(--accent-strong));outline-offset:2px}
  .marked{font-size:15px;font-weight:700;margin:.6rem 0}
  mark{background:rgb(var(--good)/.16);color:rgb(var(--good));padding:.05rem .2rem;border-radius:3px}
  pre{white-space:pre-wrap;overflow-wrap:anywhere;background:rgb(var(--canvas));
      border:1px solid rgb(var(--gloss)/.5);border-radius:6px;padding:.6rem;
      font:11px/1.45 var(--mono);max-height:360px;overflow:auto}
  @media(max-width:860px){.row{grid-template-columns:1fr}figure{position:static;max-width:220px}}
  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
<header class="top">
  <h1>Edge scores — flavor ${FLAVOR}, S${STEP}</h1>
  <p class="sub">${esc(stepDesc)}, rendered the way the ops page renders a step — with the two artifacts each score matches printed under its label.</p>
  <div class="tally">
    <span class="tag">${cards.length} captions</span>
    <span class="tag ${failCards ? 'bad' : 'good'}">${failCards} with violations</span>
    <span class="tag ${totalViol ? 'bad' : 'good'}">${totalViol} violations total</span>
    ${totalReps ? `<span class="tag fix">${totalReps} elided span${totalReps > 1 ? 's' : ''} repaired</span>` : ''}
    <label class="only"><input type="checkbox" id="only"> show only captions with violations</label>
  </div>
  <div class="legend">
    <p><b>IMAGE</b> and <b>CAPTION</b> are the only two artifacts a viewer ever sees. <b>ANALOG</b>, <b>METAPHOR</b> and <b>CONTEXT</b> are ours alone — a score leaning on those is not evidence a reader could have used.</p>
    <p>Read <b>CAST</b> first: every figure in the picture needs words in the caption that NAME it. A red <b>CAPTION SPAN</b> is a citation the caption cannot back — either a body on screen the viewer cannot name, or wording that isn't in the caption at all.</p>
    <p>An amber <b>CAPTION SPAN</b> was stitched from two verbatim runs with "…" — the evidence is real, the citation format was wrong, so the checker kept the longest contiguous run. Repairs never count as violations.</p>
  </div>
</header>
${sections}
<script>document.getElementById('only').addEventListener('change',(e)=>document.body.classList.toggle('only-fails',e.target.checked))</script>`

const out = path.join(HERE, `edges-${FLAVOR}-s${STEP}.html`)
fs.writeFileSync(out, html)
console.log(`\n${cards.length} captions · ${failCards} with violations · ${totalViol} violations total · ${totalReps} elided span(s) repaired`)
console.log(`HTML: ${out}`)
