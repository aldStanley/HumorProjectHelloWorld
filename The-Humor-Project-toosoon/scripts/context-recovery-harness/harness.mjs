#!/usr/bin/env node
// Context-recovery harness: runs flavor 1544's read→moments→captions chain
// (S1-S13) on images from a study set and builds a BLIND evaluation page.
//
// The page shows each caption with its image and asks "can you reconstruct
// the story?" BEFORE revealing the hidden context and the model's own
// context_recovery score — so the human rating is uncontaminated. Ratings
// persist in localStorage; a button exports human-vs-model JSON.
//
//   node scripts/context-recovery-harness/harness.mjs                 # 5 images from set 67
//   node scripts/context-recovery-harness/harness.mjs --count 8
//   node scripts/context-recovery-harness/harness.mjs --images 3c63d67c-a51c-445d-a3f7-3d2ae1b9d06e
//   node scripts/context-recovery-harness/harness.mjs --flavor 1544 --set 67
//
// --images takes image ids (looked up in the DB) or literal URLs. Prompts are
// fetched fresh from the DB each run; every LLM call is cached in cache/ by
// content hash, so a prompt tweak re-runs only that step and its downstream.
// The harness never writes to the database.
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
const MAX_STEP = Number(args['max-step'] ?? 13) // stop before the collector steps

const env = loadEnv(ROOT)
const db = makeDb(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

// ---- resolve images: ids/URLs from --images, else first COUNT of the set ----
const imageRows = []
if (args.images) {
  for (const tok of String(args.images).split(',').map((s) => s.trim())) {
    if (tok.startsWith('http')) imageRows.push({ id: tok.slice(-12), url: tok, additional_context: '' })
    else {
      const [row] = await db(`images?id=eq.${tok}&select=id,url,additional_context`)
      if (!row) { console.error(`image ${tok} not found`); process.exit(1) }
      imageRows.push(row)
    }
  }
} else {
  const maps = await db(`study_image_set_image_mappings?study_image_set_id=eq.${SET}&select=image_id,images(id,url,additional_context)&order=image_id.asc&limit=${COUNT}`)
  if (!maps.length) { console.error(`set ${SET} has no images`); process.exit(1) }
  imageRows.push(...maps.map((m) => m.images))
}
const mimeOf = (u) => (u.endsWith('.png') ? 'image/png' : u.endsWith('.webp') ? 'image/webp' : 'image/jpeg')

// ---- flavor steps + models ----
const steps = (await db(`humor_flavor_steps?humor_flavor_id=eq.${FLAVOR}&select=order_by,llm_system_prompt,llm_user_prompt,llm_temperature,llm_input_type_id,llm_model_id&order=order_by`))
  .filter((s) => s.order_by <= MAX_STEP)
if (!steps.length) { console.error(`flavor ${FLAVOR} has no steps`); process.exit(1) }
const models = await db('llm_models?select=id,provider_model_id,is_temperature_supported')
const modelById = Object.fromEntries(models.map((m) => [m.id, m]))

const sub = (t, priors, extra) => (t ?? '').replace(/\$\{([^}]+)\}/g, (f, n) => {
  n = n.trim()
  const m = n.match(/^step(\d+)Output$/)
  if (m) return priors[m[1]] ?? ''
  if (n in extra) return extra[n]
  return f
})

// ---- model calls, content-addressed cache (same scheme as scene-harness) ----
const callOpenAIStyle = async (endpoint, apiKey, pmid, sys, usr, temp, b64mime) => {
  const usesMCT = pmid.startsWith('gpt-5') || /^o\d/.test(pmid)
  const content = b64mime ? [{ type: 'text', text: usr }, { type: 'image_url', image_url: { url: `data:${b64mime[1]};base64,${b64mime[0]}` } }] : usr
  const r = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: pmid, messages: [{ role: 'system', content: sys }, { role: 'user', content }],
      ...(temp != null && !usesMCT ? { temperature: temp } : {}), ...(usesMCT ? { max_completion_tokens: 32000 } : { max_tokens: 8000 }) }),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(`${pmid} HTTP ${r.status}: ${JSON.stringify(d).slice(0, 300)}`)
  return (d?.choices?.[0]?.message?.content ?? '').trim()
}
const callGemini = async (pmid, sys, usr, b64, mime) => {
  const maxTok = pmid.includes('pro') ? 32768 : 16384
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${pmid}:generateContent?key=${env.GOOGLE_AI_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: `System: ${sys}\n\nUser: ${usr}` }, ...(b64 ? [{ inline_data: { mime_type: mime, data: b64 } }] : [])] }], generationConfig: { maxOutputTokens: maxTok } }),
  })
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
  throw lastErr ?? new Error('empty output after 5 tries')
}
const inflight = new Map()
const cachedCall = (pmid, sys, usr, temp, b64, mime, label) => {
  const key = crypto.createHash('sha256').update([pmid, sys, usr, temp ?? '', b64 ? mime : 'noimg', b64 ? crypto.createHash('sha256').update(b64).digest('hex') : ''].join(' ')).digest('hex').slice(0, 16)
  const f = path.join(CACHE, `${key}.txt`)
  if (fs.existsSync(f)) { process.stderr.write(`${label} cached\n`); return fs.readFileSync(f, 'utf8') }
  if (inflight.has(key)) return inflight.get(key)
  const p = withRetry(() => dispatch(pmid, sys, usr, temp, b64, mime))
    .then((out) => { fs.writeFileSync(f, out); process.stderr.write(`${label} done (${out.length} chars, ${pmid})\n`); return out })
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

// ---- run the chain per image ----
const limit = pLimit(Number(args.concurrency ?? 3))
const results = {} // results[image.id] = { steps: {order: text} }
await Promise.all(imageRows.map((img) => limit(async () => {
  const b64 = await fetchImage(img.url)
  const mime = mimeOf(img.url)
  const extra = { celebrityRecognition: '', imageAdditionalContext: img.additional_context ?? '', imageDescription: '' }
  const priors = {}
  for (const st of steps) {
    const m = modelById[st.llm_model_id]
    const temp = m.is_temperature_supported ? st.llm_temperature : null
    const withImg = st.llm_input_type_id === 1
    priors[st.order_by] = await cachedCall(m.provider_model_id, sub(st.llm_system_prompt, priors, extra), sub(st.llm_user_prompt, priors, extra), temp, withImg ? b64 : null, mime, `${img.id.slice(0, 8)} S${st.order_by}`)
  }
  results[img.id] = { steps: { ...priors } }
})))

// ---- collect captions (shape-based: any step whose JSON has "captions") ----
const strip = (t) => t.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
const tryParse = (t) => { try { return JSON.parse(strip(t)) } catch { return null } }

const cards = [] // {id, imageId, step, register, caption, context, cr, crReason, physicalFit, matchOverall, raw}
for (const img of imageRows) {
  for (const [ord, text] of Object.entries(results[img.id].steps)) {
    const j = tryParse(text)
    if (!j || !Array.isArray(j.captions)) continue
    for (const c of j.captions) {
      cards.push({
        id: crypto.createHash('sha256').update(img.id + '|' + c.caption).digest('hex').slice(0, 10),
        imageId: img.id, step: Number(ord),
        register: c.register ?? '—', caption: c.caption ?? '(no caption)', context: c.context ?? '(no context)',
        cr: typeof c.context_recovery === 'number' ? c.context_recovery : null,
        crReason: c.context_recovery_reason ?? '', physicalFit: c.physical_fit ?? null, matchOverall: c.match_overall ?? null,
        raw: c,
      })
    }
  }
}

// ---- blind-eval page ----
const esc = (s) => String(s ?? 'null').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const REG_COLOR = { in_scene: '#0ea5e9', watched_scene: '#a855f7', internal: '#f59e0b' }

const cardHtml = (c) => `<div class="card" data-id="${c.id}" data-cr="${c.cr ?? ''}">
  <div class="capline"><span class="reg" style="background:${REG_COLOR[c.register] ?? '#999'}22;color:${REG_COLOR[c.register] ?? '#666'}">${esc(c.register)}</span><p class="captext">${esc(c.caption)}</p></div>
  <div class="ask">
    <span class="q">From the caption + image alone — do you get the story?</span>
    <button data-h="1">Got it</button><button data-h="0.5">Partly</button><button data-h="0">Lost</button>
    <a class="peek" href="#">just reveal</a>
  </div>
  <div class="reveal" hidden>
    <div class="verdict"></div>
    <div class="mrow"><span class="mlbl">model context_recovery</span><span class="mval">${c.cr ?? '—'}</span></div>
    <p class="mreason">${esc(c.crReason)}</p>
    <div class="mlbl">the hidden context</div>
    <p class="ctx">${esc(c.context)}</p>
    <div class="mrow small"><span>physical_fit ${c.physicalFit ?? '—'}</span><span>match_overall ${c.matchOverall ?? '—'}</span></div>
    <details><summary>full caption JSON</summary><pre>${esc(JSON.stringify(c.raw, null, 2))}</pre></details>
  </div>
  <textarea class="note" rows="1" placeholder="notes — saved in this browser; use 'Download notes for Claude' when done"></textarea>
</div>`

let sections = ''
for (const img of imageRows) {
  const mine = cards.filter((c) => c.imageId === img.id)
  const b64 = fs.readFileSync(imgCacheFile(img.url), 'utf8')
  sections += `<section>
  <h2>${esc(img.id.slice(0, 8))} <span class="dim">· ${mine.length} captions</span></h2>
  <div class="row">
    <figure><img src="data:${mimeOf(img.url)};base64,${b64}" alt=""></figure>
    <div class="cards">${mine.map(cardHtml).join('\n')}</div>
  </div>
</section>\n`
}

const html = `<title>Context recovery — flavor ${FLAVOR}</title>
<style>
  :root{--ink:#23252b;--dim:#6d7078;--line:#e4e2dc;--ground:#fbfaf7;--good:#2f7d4f;--bad:#b3372f;--mono:ui-monospace,'SF Mono',Menlo,monospace}
  body{background:var(--ground);color:var(--ink);font:15px/1.5 system-ui,-apple-system,sans-serif;margin:0;padding:2rem clamp(1rem,3vw,3rem) 4rem}
  header{max-width:75rem;margin:0 auto 1.5rem}
  h1{font-size:1.5rem;margin:0 0 .3rem}
  .sub{color:var(--dim);max-width:72ch;margin:0 0 .8rem}
  #tally{font-family:var(--mono);font-size:.85rem;background:#fff;border:1px solid var(--line);border-radius:8px;padding:.6rem .9rem;display:inline-flex;gap:1.2rem;align-items:center}
  #tally button{font:inherit;padding:.2rem .6rem;border:1px solid var(--line);border-radius:6px;background:#f6f5f1;cursor:pointer}
  section{max-width:75rem;margin:0 auto 2.5rem;border-top:1px solid var(--line);padding-top:1.2rem}
  h2{font-size:1rem;font-family:var(--mono);margin:0 0 .8rem}
  .dim{color:var(--dim);font-weight:400}
  .row{display:grid;grid-template-columns:minmax(140px,220px) 1fr;gap:1.4rem;align-items:start}
  figure{margin:0;position:sticky;top:1rem}
  figure img{width:100%;border:1px solid var(--line);border-radius:6px;display:block}
  .card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:.9rem 1rem;margin-bottom:.8rem}
  .capline{display:flex;gap:.6rem;align-items:baseline}
  .reg{font-family:var(--mono);font-size:.68rem;padding:.1rem .45rem;border-radius:99px;white-space:nowrap}
  .captext{margin:0;font-size:1.02rem;font-weight:600;line-height:1.35}
  .ask{margin-top:.7rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
  .ask .q{font-size:.82rem;color:var(--dim)}
  .ask button{font:inherit;font-size:.85rem;padding:.25rem .7rem;border:1px solid var(--line);border-radius:6px;background:#f6f5f1;cursor:pointer}
  .ask button:hover{border-color:#aaa}
  .peek{font-size:.75rem;color:var(--dim)}
  .reveal{margin-top:.7rem;border-top:1px dashed var(--line);padding-top:.6rem}
  .verdict{font-size:.85rem;font-weight:600;margin-bottom:.35rem}
  .verdict.agree{color:var(--good)} .verdict.off{color:var(--bad)}
  .mrow{display:flex;gap:.6rem;align-items:baseline;font-family:var(--mono);font-size:.8rem}
  .mrow.small{color:var(--dim);font-size:.72rem;gap:1rem;margin-top:.3rem}
  .mlbl{font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin-top:.5rem}
  .mval{font-weight:700;font-size:1rem}
  .mreason{font-size:.82rem;color:var(--dim);margin:.2rem 0 .4rem}
  .ctx{font-size:.88rem;margin:.15rem 0 .3rem}
  .note{width:100%;box-sizing:border-box;margin-top:.6rem;font:inherit;font-size:.85rem;padding:.4rem .55rem;border:1px dashed var(--line);border-radius:6px;background:#fffdf5;resize:vertical;min-height:2.1rem}
  .note:focus{border-style:solid;outline:none;border-color:#c9b458}
  details{margin-top:.4rem;font-size:.78rem;color:var(--dim)}
  pre{white-space:pre-wrap;word-break:break-word;background:#f6f5f1;border:1px solid var(--line);border-radius:6px;padding:.5rem;font-size:.7rem;max-height:280px;overflow:auto}
  @media (max-width:900px){.row{grid-template-columns:1fr}figure{position:static;max-width:240px}}
</style>
<header>
  <h1>Context recovery — flavor ${FLAVOR}</h1>
  <p class="sub">Blind test: for each caption, decide whether you can reconstruct the story from the caption + image <b>before</b> revealing the hidden context and the model's self-scored <code>context_recovery</code>. "Got it" should line up with scores &ge; 0.7, "Partly" with 0.4&ndash;0.69, "Lost" with &lt; 0.4. Ratings save in this browser.</p>
  <div id="tally"><span id="tcount">0/${cards.length} rated</span><span id="tagree"></span><button id="export">Copy results JSON</button><button id="download">Download notes for Claude</button><button id="clear">Clear my ratings</button></div>
</header>
${sections}
<script>
const KEY = 'ctxrec-${FLAVOR}'
const NKEY = 'ctxrec-${FLAVOR}-notes'
const load = () => JSON.parse(localStorage.getItem(KEY) || '{}')
const save = (r) => localStorage.setItem(KEY, JSON.stringify(r))
const loadNotes = () => JSON.parse(localStorage.getItem(NKEY) || '{}')
const saveNotes = (n) => localStorage.setItem(NKEY, JSON.stringify(n))
const band = (cr) => cr >= 0.7 ? 1 : cr >= 0.4 ? 0.5 : 0
const tally = () => {
  const r = load(); const cards = [...document.querySelectorAll('.card')]
  let n = 0, agree = 0, scored = 0
  for (const el of cards) {
    const h = r[el.dataset.id]; if (h == null) continue
    n += 1
    const cr = el.dataset.cr === '' ? null : Number(el.dataset.cr)
    if (cr != null) { scored += 1; if (band(cr) === h) agree += 1 }
  }
  document.getElementById('tcount').textContent = n + '/' + cards.length + ' rated'
  document.getElementById('tagree').textContent = scored ? 'model agrees ' + agree + '/' + scored : ''
}
const show = (el, h) => {
  const rev = el.querySelector('.reveal'); rev.hidden = false
  el.querySelector('.ask').style.display = 'none'
  const v = el.querySelector('.verdict')
  const cr = el.dataset.cr === '' ? null : Number(el.dataset.cr)
  if (h == null) { v.textContent = 'revealed without rating'; v.className = 'verdict' }
  else if (cr == null) { v.textContent = 'you: ' + h + ' — model gave no score'; v.className = 'verdict off' }
  else {
    const ok = band(cr) === h
    v.textContent = 'you: ' + (h === 1 ? 'got it' : h === 0.5 ? 'partly' : 'lost') + ' · model: ' + cr + (ok ? ' — agree' : ' — mismatch')
    v.className = 'verdict ' + (ok ? 'agree' : 'off')
  }
}
for (const el of document.querySelectorAll('.card')) {
  el.querySelectorAll('.ask button').forEach((b) => b.addEventListener('click', () => {
    const r = load(); r[el.dataset.id] = Number(b.dataset.h); save(r); show(el, Number(b.dataset.h)); tally()
  }))
  el.querySelector('.peek').addEventListener('click', (e) => { e.preventDefault(); show(el, load()[el.dataset.id] ?? null) })
  el.querySelector('.note').addEventListener('input', (e) => {
    const n = loadNotes(); n[el.dataset.id] = e.target.value; if (!e.target.value) delete n[el.dataset.id]; saveNotes(n)
  })
}
// restore prior ratings + notes
{
  const r = load(), n = loadNotes()
  for (const el of document.querySelectorAll('.card')) {
    if (r[el.dataset.id] != null) show(el, r[el.dataset.id])
    if (n[el.dataset.id]) el.querySelector('.note').value = n[el.dataset.id]
  }
}
tally()
const rows = () => {
  const r = load(), n = loadNotes()
  return [...document.querySelectorAll('.card')].map((el) => ({
    id: el.dataset.id,
    image: el.closest('section').querySelector('h2').firstChild.textContent.trim(),
    register: el.querySelector('.reg').textContent,
    caption: el.querySelector('.captext').textContent,
    context: el.querySelector('.ctx').textContent,
    model_context_recovery: el.dataset.cr === '' ? null : Number(el.dataset.cr),
    human: r[el.dataset.id] ?? null,
    note: n[el.dataset.id] ?? null,
  }))
}
document.getElementById('export').addEventListener('click', () => {
  navigator.clipboard.writeText(JSON.stringify(rows(), null, 2))
  document.getElementById('export').textContent = 'Copied!'
  setTimeout(() => { document.getElementById('export').textContent = 'Copy results JSON' }, 1200)
})
document.getElementById('download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(rows(), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'ctxrec-${FLAVOR}-notes.json'
  a.click()
  URL.revokeObjectURL(a.href)
})
document.getElementById('clear').addEventListener('click', () => { localStorage.removeItem(KEY); location.reload() })
</script>`

const outFile = path.join(HERE, `eval-${FLAVOR}.html`)
fs.writeFileSync(outFile, html)
console.log(`\neval page: ${outFile}`)

// stdout summary: score distribution + per-caption line
console.log(`\n${cards.length} captions across ${imageRows.length} images`)
for (const img of imageRows) {
  console.log(`== ${img.id.slice(0, 8)}`)
  for (const c of cards.filter((x) => x.imageId === img.id)) {
    console.log(`  [${String(c.cr ?? '—').padEnd(4)}] (${c.register}) ${c.caption}`)
  }
}
const scores = cards.map((c) => c.cr).filter((x) => x != null)
if (scores.length) {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  console.log(`\ncontext_recovery: mean ${mean.toFixed(2)}, min ${Math.min(...scores)}, max ${Math.max(...scores)}, ${scores.filter((s) => s >= 0.9).length}/${scores.length} at ≥0.9`)
}
