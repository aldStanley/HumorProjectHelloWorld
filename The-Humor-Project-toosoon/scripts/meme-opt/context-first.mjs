#!/usr/bin/env node
// Context-first meme lab: pick ONE community context, have GPT-5.5 pick the 3
// best meme templates from the pinned library (pins/registry.json), write one
// joke per template with the SAME caption+judge prompts the ops pipeline uses,
// and iterate via chat — the improver can propose revisions to the template-
// SELECTION prompt (```selection block) or an additive JOKE guidance block
// (```joke block); each shows a diff and applies only when you click.
//
//   node scripts/meme-opt/context-first.mjs [--port 5100] [--name context-lab]
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { exec } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { loadEnv, makeDb, pLimit, callOpenAI, parseJsonLoose, asPromptString, substitute } from './lib.mjs'
import { CAPTION_SYSTEM, CAPTION_USER, ALIGN_SYSTEM, ALIGN_USER, CAPTION_MODEL } from './pipeline.mjs'
import { diffHtml } from './report.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  if (!argv[i].startsWith('--')) continue
  args[argv[i].slice(2)] = argv[++i]
}

const IMPROVER_MODEL = args['improver-model'] ?? 'gpt-5.5'
const PORT = Number(args.port ?? 5100)
const RUN_NAME = args.name ?? 'context-lab'

const DEFAULT_SELECTION_PROMPT = `You are selecting meme templates for a specific community moment.

THE MOMENT:
\${context}

THE TEMPLATE LIBRARY (each entry is one meme image with its curated verdict):
\${templates}

Pick the 3 templates whose FORMAT best fits this moment — the moment should slot
naturally into what the template requires (its setup, its snowclone, its
emotional shape). Judge fit by format compatibility, not topic similarity.

Output ONLY a JSON array of exactly 3, best first:
[
  { "image_id": "<id>", "template_name": "<name>", "fit": <0..1>,
    "reason": "<one sentence: why this moment fits this template's format>" }
]`

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : '—')

async function main() {
  const env = loadEnv(ROOT)
  const apiKey = env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY
  if (!apiKey || !env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.error('Missing OPENAI_API_KEY / Supabase vars in .env')
    process.exit(1)
  }
  const db = makeDb(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const limit = pLimit(6)

  // ---- template library from pins/registry.json ----
  const registry = JSON.parse(fs.readFileSync(path.join(HERE, 'pins', 'registry.json'), 'utf8'))
  const ids = registry.templates.map((t) => t.imageId)
  const imageRows = await db(`images?id=in.(${ids.join(',')})&select=id,url`)
  const urlById = new Map(imageRows.map((r) => [r.id, r.url]))
  const templates = registry.templates.map((t) => {
    const pinText = fs.readFileSync(path.join(HERE, 'pins', t.file), 'utf8').trim()
    const parsed = parseJsonLoose(pinText)
    const meme = parsed?.meme ?? parsed ?? {}
    return {
      imageId: t.imageId,
      file: t.file,
      url: urlById.get(t.imageId) ?? null,
      pinText,
      meme,
      // A pin may have template_name: null (unnamed reaction images) — fall
      // back to the recognized content name, then the pin filename.
      displayName:
        meme.template_name ?? parsed?.content?.[0]?.name ?? t.file.replace(/\.json$/, ''),
    }
  })
  const contexts = (await db('community_contexts?select=content&order=id'))
    .map((c) => c.content)
    .filter(Boolean)

  // ---- state ----
  const runDir = path.join(HERE, 'runs', RUN_NAME)
  fs.mkdirSync(runDir, { recursive: true })
  const statePath = path.join(runDir, 'state.json')
  const state = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
    : {
        config: { runName: RUN_NAME, improverModel: IMPROVER_MODEL, captionModel: CAPTION_MODEL },
        prompts: { selection: DEFAULT_SELECTION_PROMPT, jokeAppend: '' },
        attempts: [],
        chatLog: [],
      }
  const chat = state.chatLog
  const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2))

  const status = { phase: 'idle', pendingSelection: null, pendingJoke: null }

  // ---- one attempt: select 3 templates for the context, joke + judge each ----
  const makeAttempt = async (contextText) => {
    const attempt = {
      id: state.attempts.length,
      context: contextText,
      startedAt: new Date().toISOString(),
      jokes: [],
    }
    const templateCatalog = JSON.stringify(
      templates.map((t) => ({
        image_id: t.imageId,
        template_name: t.displayName,
        meaning: t.meme.meaning,
        how_a_caption_should_use_it: t.meme.how_a_caption_should_use_it,
        image_is_punchline: t.meme.image_is_punchline,
        image_delivers: t.meme.image_delivers,
      })),
      null,
      2
    )
    const selectionText = await limit(() =>
      callOpenAI({
        apiKey,
        model: IMPROVER_MODEL,
        systemPrompt: 'You select meme templates for community moments. You only respond in JSON.',
        userPrompt: substitute(state.prompts.selection, { context: contextText, templates: templateCatalog }),
        maxTokens: 6000,
      })
    )
    attempt.selectionText = selectionText
    const picks = parseJsonLoose(selectionText)
    if (!Array.isArray(picks) || !picks.length) {
      attempt.error = 'template selection did not return a JSON list'
      return attempt
    }
    attempt.selection = picks

    await Promise.all(
      picks.slice(0, 3).map(async (pick, i) => {
        const joke = { index: i, pick }
        attempt.jokes[i] = joke
        const tpl = templates.find((t) => t.imageId === pick.image_id)
        if (!tpl?.url) {
          joke.error = `unknown template image_id ${pick.image_id}`
          return
        }
        joke.imageId = tpl.imageId
        joke.url = tpl.url
        joke.templateName = tpl.displayName
        try {
          const vars = {
            recognizedContent: tpl.pinText,
            memeRelevantContext: asPromptString({ moment: contextText }),
          }
          const captionText = await limit(() =>
            callOpenAI({
              apiKey,
              model: CAPTION_MODEL,
              systemPrompt: CAPTION_SYSTEM,
              userPrompt:
                substitute(CAPTION_USER, vars) +
                (state.prompts.jokeAppend
                  ? '\n\n--------------------------------------\nADDITIONAL GUIDANCE (applies on top of everything above):\n' +
                    state.prompts.jokeAppend
                  : ''),
              temperature: 0.7,
              imageUrl: tpl.url,
            })
          )
          joke.captionText = captionText
          const capParsed = parseJsonLoose(captionText)
          joke.caption =
            capParsed && typeof capParsed === 'object' ? capParsed.caption ?? captionText : captionText
          joke.captionReason = capParsed?.reason ?? ''

          const alignText = await limit(() =>
            callOpenAI({
              apiKey,
              model: CAPTION_MODEL,
              systemPrompt: ALIGN_SYSTEM,
              userPrompt: substitute(ALIGN_USER, { ...vars, memeCaption: captionText }),
              temperature: 0.2,
              imageUrl: tpl.url,
            })
          )
          joke.alignText = alignText
          const a = parseJsonLoose(alignText)
          if (a && typeof a === 'object') {
            const n = Number(a.meme_format_alignment)
            joke.score = Number.isFinite(n) ? n : null
            joke.judgeReason = a.reason ?? ''
          }
        } catch (err) {
          joke.error = String(err?.message ?? err)
        }
      })
    )
    return attempt
  }

  // ---- chat (same pattern as the per-image lab) ----
  const chatSystem = () => {
    const latest = state.attempts[state.attempts.length - 1]
    const lines = []
    lines.push(
      'You are an expert meme-prompt engineer helping the user tune a CONTEXT-FIRST meme lab: ' +
        'the user picks one community moment, a selection prompt picks the 3 best-fitting meme ' +
        'templates from a curated library, then one joke per template is written (with the ops ' +
        "pipeline's caption prompt) and judged. Diagnose failures, explain why, be direct. " +
        'THE USER is the real judge.'
    )
    lines.push(
      '\nYOU CAN REVISE TWO THINGS. When proposing, use exactly ONE fenced block per proposal:\n' +
        '- the template-SELECTION prompt: a ```selection fenced block containing the COMPLETE ' +
        'replacement prompt (keep the ${context} and ${templates} placeholders);\n' +
        '- the additive JOKE guidance: a ```joke fenced block containing the COMPLETE replacement ' +
        'guidance appended to the caption prompt (short, structural — capture patterns, never ' +
        'literal caption blocklists, no long topic menus, no Columbia-specific examples).'
    )
    lines.push('\n=== CURRENT SELECTION PROMPT ===\n' + state.prompts.selection)
    lines.push('\n=== CURRENT JOKE GUIDANCE (appended to the caption prompt) ===\n' + (state.prompts.jokeAppend || '(none)'))
    lines.push(
      '\n=== TEMPLATE LIBRARY ===\n' +
        templates.map((t) => `- ${t.displayName} (${t.imageId})`).join('\n')
    )
    if (latest) {
      lines.push(`\n=== LATEST ATTEMPT (context: ${latest.context}) ===`)
      for (const j of latest.jokes ?? []) {
        if (!j || j.error) continue
        lines.push(
          `template: ${j.templateName} | fit ${j.pick?.fit ?? '?'} (${j.pick?.reason ?? ''})\n` +
            `  joke: ${JSON.stringify(String(j.caption ?? ''))} | judge score ${j.score ?? '?'}\n` +
            `  judge reason: ${j.judgeReason ?? ''}`
        )
      }
    }
    return lines.join('\n')
  }

  const extractBlock = (reply, tag) => {
    const m = [...reply.matchAll(new RegExp('```' + tag + '\\s*\\n([\\s\\S]*?)```', 'gi'))]
    return m.length ? m[m.length - 1][1].trim() : null
  }

  const onChat = async (message) => {
    status.phase = 'chatting'
    chat.push({ role: 'user', content: message })
    try {
      const reply = await callOpenAI({
        apiKey,
        model: IMPROVER_MODEL,
        systemPrompt: chatSystem(),
        messages: chat.slice(-24).map((m) => ({ role: m.role, content: m.content })),
        maxTokens: 12000,
      })
      chat.push({ role: 'assistant', content: reply })
      const sel = extractBlock(reply, 'selection')
      const joke = extractBlock(reply, 'joke')
      if (sel) status.pendingSelection = { text: sel, diff: diffHtml(state.prompts.selection, sel) }
      if (joke) status.pendingJoke = { text: joke, diff: diffHtml(state.prompts.jokeAppend, joke) }
      save()
    } catch (err) {
      chat.push({ role: 'assistant', content: `(error talking to ${IMPROVER_MODEL}: ${err?.message ?? err})` })
    } finally {
      status.phase = 'idle'
    }
  }

  // ---- page ----
  const jokeCard = (j) => {
    if (!j) return ''
    if (j.error) return `<div class="card err">⚠ ${esc(j.error)}</div>`
    return `<div class="card">
      <div class="cardhead"><span class="template">${esc(j.templateName)}</span>
        <span class="cardtop">fit ${esc(j.pick?.fit ?? '?')}</span></div>
      <p class="muted why">${esc(j.pick?.reason ?? '')}</p>
      <img src="${esc(j.url)}" alt="" loading="lazy"/>
      <p class="joke">${esc(j.caption)}</p>
      <p class="muted">${esc(j.captionReason)}</p>
      <p><span class="score ${Number.isFinite(j.score) && j.score >= 0.85 ? 'hi' : ''}">judge ${fmt(j.score)}</span>
        <span class="muted">${esc(j.judgeReason)}</span></p>
      <details><summary>raw outputs (caption · judge)</summary>
        <pre>${esc(j.captionText ?? '')}\n\n---\n\n${esc(j.alignText ?? '')}</pre></details>
    </div>`
  }

  const attemptSection = (a) => `<section class="attempt">
    <h3>Attempt ${a.id} ${a.custom ? '<span class="tag">✍ submitted context</span>' : ''}
      <span class="muted">${esc(a.startedAt?.slice(0, 16).replace('T', ' ') ?? '')}</span></h3>
    <blockquote>${esc(a.context)}</blockquote>
    ${a.error ? `<p class="err">⚠ ${esc(a.error)} — <details><summary>raw selection output</summary><pre>${esc(a.selectionText ?? '')}</pre></details></p>` : ''}
    <div class="grid">${(a.jokes ?? []).map(jokeCard).join('')}</div>
    <details><summary>raw template-selection output</summary><pre>${esc(a.selectionText ?? '')}</pre></details>
  </section>`

  const page = () => `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Context-first meme lab — ${esc(RUN_NAME)}</title>
<style>${CSS}</style>
<h1>Context-first meme lab</h1>
<p class="meta">${templates.length} pinned templates · ${contexts.length} community contexts · jokes+judge: ${esc(CAPTION_MODEL)} · selection+chat: ${esc(IMPROVER_MODEL)}</p>

<div class="panel">
  <h2 style="margin-top:0">1 · Pick a community context</h2>
  <input id="ctx-filter" type="search" placeholder="filter contexts…"/>
  <div id="ctx-list" class="ctxlist">
    ${contexts
      .map(
        (c, i) =>
          `<label class="ctxrow"><input type="radio" name="ctx" value="${i}"/><span>${esc(c)}</span></label>`
      )
      .join('')}
  </div>
  <p class="orline">…or write your own — any moment works, it doesn't have to be from the database:</p>
  <textarea id="ctx-custom" placeholder="e.g. My roommate keeps 'borrowing' my oat milk and replacing it with almond milk like I wouldn't notice."></textarea>
  <div class="btnrow"><button id="make" class="primary">2 · Pick 3 templates &amp; make the jokes</button>
    <span class="muted">a typed-in context takes priority over the selection above</span>
    <span class="spin" id="busy" hidden></span></div>
</div>

<h2>Attempts</h2>
${[...state.attempts].reverse().map(attemptSection).join('') || '<p class="muted">none yet — pick a context above.</p>'}

<div class="panel" id="itl">
  <h2 style="margin-top:0">Improve it — chat</h2>
  <div id="itl-chat" class="chatlog"></div>
  <p class="spin" id="itl-busy" hidden></p>
  <div id="prop-selection" hidden><p><strong>Proposed SELECTION prompt</strong> — changes:</p>
    <pre class="amendment" id="diff-selection"></pre>
    <div class="btnrow"><button data-apply="selection" class="primary">Apply selection prompt</button></div></div>
  <div id="prop-joke" hidden><p><strong>Proposed JOKE guidance</strong> — changes:</p>
    <pre class="amendment" id="diff-joke"></pre>
    <div class="btnrow"><button data-apply="joke" class="primary">Apply joke guidance</button></div></div>
  <textarea id="itl-msg" placeholder="Judge the jokes above: which templates were the wrong pick? Which jokes miss the format? The prompts, library, and latest outputs are already in the conversation."></textarea>
  <div class="btnrow"><button id="itl-send" class="primary">Send</button>
    <span class="muted">applying a prompt does not rerun — pick a context and make again to test it</span></div>
</div>
<script>${CLIENT_JS}</script>`

  // ---- server ----
  const readBody = (req) =>
    new Promise((resolve) => {
      let data = ''
      req.on('data', (c) => (data += c))
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {})
        } catch {
          resolve({})
        }
      })
    })

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const json = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(page())
      return
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      json({
        phase: status.phase,
        attempts: state.attempts.length,
        chat,
        pendingSelection: status.pendingSelection ? { diff: status.pendingSelection.diff } : null,
        pendingJoke: status.pendingJoke ? { diff: status.pendingJoke.diff } : null,
      })
      return
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      if (status.phase !== 'idle') {
        json({ ok: false, error: 'busy' })
        return
      }
      if (url.pathname === '/make') {
        // A typed-in context wins over the radio selection.
        const custom = String(body.contextText ?? '').trim()
        const contextText = custom || contexts[Number(body.contextIndex)]
        if (!contextText) {
          json({ ok: false, error: 'pick a context first' })
          return
        }
        status.phase = 'running'
        void (async () => {
          try {
            const attempt = await makeAttempt(contextText)
            attempt.custom = Boolean(custom)
            attempt.promptsUsed = { ...state.prompts }
            state.attempts.push(attempt)
            save()
            fs.writeFileSync(path.join(runDir, 'report.html'), page())
          } catch (err) {
            chat.push({ role: 'assistant', content: `(attempt failed: ${err?.message ?? err})` })
          } finally {
            status.phase = 'idle'
          }
        })()
        json({ ok: true })
        return
      }
      if (url.pathname === '/chat' && String(body.message ?? '').trim()) {
        void onChat(String(body.message).trim())
        json({ ok: true })
        return
      }
      if (url.pathname === '/apply') {
        if (body.which === 'selection' && status.pendingSelection) {
          state.prompts.selection = status.pendingSelection.text
          status.pendingSelection = null
        } else if (body.which === 'joke' && status.pendingJoke) {
          state.prompts.jokeAppend = status.pendingJoke.text
          status.pendingJoke = null
        }
        save()
        json({ ok: true })
        return
      }
    }
    res.writeHead(404)
    res.end('not found')
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORT, '127.0.0.1', resolve)
  })
  console.log(`Context-first meme lab: http://localhost:${PORT}/  (run "${RUN_NAME}")`)
  if (process.platform === 'darwin') exec(`open http://localhost:${PORT}/`)
  await new Promise(() => {})
}

const CSS = `
:root{--surface:#fcfcfb;--panel:#fff;--text:#0b0b0b;--text-2:#52514e;--muted:#8a887f;--border:#e4e2da;
--accent:#2a78d6;--bad:#b0322f;--hl:#fdeeb8;--ins-bg:#dcf1dc;--del-bg:#fbe2e2}
@media (prefers-color-scheme:dark){:root{--surface:#1a1a19;--panel:#232322;--text:#fff;--text-2:#c3c2b7;
--muted:#8f8e85;--border:#3a3a37;--accent:#3987e5;--bad:#e66767;--hl:#4d4120;--ins-bg:#1f3d20;--del-bg:#4a2323}}
*{box-sizing:border-box}
body{margin:0;padding:28px;background:var(--surface);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:26px 0 10px}h3{font-size:15px;margin:0 0 6px}
.meta,.muted{color:var(--muted)}.err{color:var(--bad)}
.panel{background:var(--panel);border:2px solid var(--accent);border-radius:10px;padding:14px 16px;margin:18px 0}
input[type=search]{width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);margin-bottom:8px}
.ctxlist{max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:8px}
.ctxrow{display:flex;gap:8px;padding:7px 10px;border-bottom:1px solid var(--border);font-size:13px;cursor:pointer}
.ctxrow:hover{background:var(--surface)}
.ctxrow input{flex-shrink:0;margin-top:2px}
button{background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer}
button.primary{border-color:var(--accent);font-weight:600}
button:disabled{opacity:.5;cursor:default}
.btnrow{display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap}
.spin{color:var(--muted);font-style:italic}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--border);
  border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;
  vertical-align:-2px;margin-right:7px}
@keyframes spin{to{transform:rotate(360deg)}}
.attempt{margin:18px 0 26px}
.orline{margin:12px 0 2px;font-size:13px;color:var(--text-2)}
.tag{background:var(--surface);border:1px solid var(--accent);border-radius:99px;padding:1px 8px;font-size:11px;color:var(--text-2);font-weight:400}
blockquote{margin:6px 0 12px;padding:8px 14px;border-left:3px solid var(--accent);background:var(--panel);border-radius:0 8px 8px 0;font-size:13.5px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px}
.cardhead{display:flex;gap:8px;align-items:center}.template{font-weight:600}.cardtop{margin-left:auto;color:var(--text-2);font-size:12px}
.why{font-size:12.5px;margin:4px 0}
.card img{max-width:100%;max-height:200px;object-fit:contain;display:block;margin:8px auto;border-radius:6px}
.joke{font-size:16px;font-weight:600;background:var(--hl);border-radius:4px;padding:4px 8px;width:fit-content}
.score{font-weight:700}.score.hi{color:var(--accent)}
details{margin:6px 0}summary{cursor:pointer;color:var(--text-2);font-size:12.5px}
pre{white-space:pre-wrap;word-break:break-word;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:10px;font-size:12px;max-height:320px;overflow:auto}
.amendment{max-height:340px}
ins{background:var(--ins-bg);text-decoration:none;border-radius:2px}
del{background:var(--del-bg);text-decoration:line-through;border-radius:2px}
.chatlog{max-height:420px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin:10px 0}
.msg{white-space:pre-wrap;word-break:break-word;border-radius:10px;padding:8px 12px;font-size:13px;max-width:88%}
.msg.user{align-self:flex-end;background:var(--accent);color:#fff}
.msg.assistant{align-self:flex-start;background:var(--surface);border:1px solid var(--border)}
textarea{width:100%;min-height:70px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:8px;font:13px/1.5 inherit;margin-top:8px}
`

const CLIENT_JS =
  "(function(){" +
  "var $=function(id){return document.getElementById(id)};var initialAttempts=null;var lastChat=-1;" +
  "function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}" +
  "function post(p,b){return fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}).then(function(r){return r.json()});}" +
  "$('ctx-filter').addEventListener('input',function(){var q=this.value.toLowerCase();" +
  "document.querySelectorAll('.ctxrow').forEach(function(r){r.style.display=r.textContent.toLowerCase().indexOf(q)>=0?'':'none';});});" +
  "$('make').addEventListener('click',function(){var custom=$('ctx-custom').value.trim();" +
  "var sel=document.querySelector('input[name=ctx]:checked');" +
  "if(!custom&&!sel){alert('Pick a context or write your own first.');return;}" +
  "post('/make',custom?{contextText:custom}:{contextIndex:Number(sel.value)}).then(function(r){" +
  "if(r&&r.ok)$('ctx-custom').value='';});});" +
  "function render(s){if(initialAttempts===null)initialAttempts=s.attempts;" +
  "if(s.attempts>initialAttempts){location.reload();return;}" +
  "var busy=$('busy');busy.hidden=(s.phase!=='running');" +
  "busy.innerHTML='<span class=\"spinner\"></span>picking templates and writing jokes\\u2026';" +
  "$('make').disabled=(s.phase!=='idle');$('itl-send').disabled=(s.phase!=='idle');" +
  "var b2=$('itl-busy');b2.hidden=(s.phase!=='chatting');" +
  "b2.innerHTML='<span class=\"spinner\"></span>thinking\\u2026';" +
  "if(s.chat.length!==lastChat){lastChat=s.chat.length;var el=$('itl-chat');" +
  "el.innerHTML=s.chat.map(function(m){return '<div class=\"msg '+(m.role==='user'?'user':'assistant')+'\">'+esc(m.content)+'</div>';}).join('');" +
  "el.scrollTop=el.scrollHeight;}" +
  "$('prop-selection').hidden=!s.pendingSelection;if(s.pendingSelection)$('diff-selection').innerHTML=s.pendingSelection.diff;" +
  "$('prop-joke').hidden=!s.pendingJoke;if(s.pendingJoke)$('diff-joke').innerHTML=s.pendingJoke.diff;}" +
  "function poll(){fetch('/status').then(function(r){return r.json()}).then(render).catch(function(){});}" +
  "setInterval(poll,2000);poll();" +
  "function send(){var t=$('itl-msg').value.trim();if(!t)return;$('itl-msg').value='';post('/chat',{message:t}).then(poll);}" +
  "$('itl-send').addEventListener('click',send);" +
  "$('itl-msg').addEventListener('keydown',function(e){if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();send();}});" +
  "document.addEventListener('click',function(e){var a=e.target.closest?e.target.closest('[data-apply]'):null;" +
  "if(a){post('/apply',{which:a.getAttribute('data-apply')}).then(poll);}});" +
  "})();"

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
