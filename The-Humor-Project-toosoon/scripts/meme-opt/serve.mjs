// Interactive human-in-the-loop mode: serves the live report on localhost with
// a CHAT panel — the same conversation the user used to have with ChatGPT, but
// the pipeline context (pinned JSON / amendment, captions, judge verdicts) is
// injected automatically every turn, so there is no copy-pasting. Whenever the
// model's reply contains a complete replacement in a fenced code block, an
// "Apply & run" button appears. Nothing changes without the user applying it.
import http from 'node:http'
import { exec } from 'node:child_process'

import { buildHtml, diffHtml, writeReport } from './report.mjs'
import { buildChatSystemPrompt, proposalWarnings } from './improve.mjs'
import { callOpenAI, parseJsonLoose } from './lib.mjs'

const PANEL_HTML = `
<div class="panel" id="itl">
  <h2 style="margin-top:0">Improve it — chat (full pipeline context auto-included)</h2>
  <p class="muted" id="itl-current"></p>
  <div id="itl-chat" class="chatlog"></div>
  <p class="spin" id="itl-busy" hidden></p>
  <pre id="itl-log" style="max-height:160px" hidden></pre>
  <div id="itl-prop" hidden>
    <p><strong>Complete proposal detected</strong> — changes vs the current version:</p>
    <p id="itl-hyp" style="font-style:italic"></p>
    <pre class="amendment" id="itl-diff"></pre>
    <p class="err" id="itl-warn" hidden></p>
    <div class="btnrow"><button id="itl-apply" class="primary">Apply &amp; run next round</button>
      <span class="muted">…or keep chatting; a newer proposal replaces this one.</span></div>
  </div>
  <textarea id="itl-msg" placeholder="Judge the jokes above and say what's wrong — or ask questions, push back, discuss interpretations. The current JSON/prompt, all captions, and the judge's verdicts are already in the conversation."></textarea>
  <div class="btnrow"><button id="itl-send" class="primary">Send</button>
    <button id="itl-rerun" title="No changes — run the current version again and get a fresh column of captions">↻ Rerun current version (3 more captions)</button>
    <span class="muted" id="itl-model"></span></div>
</div>`

// Plain string on purpose — nothing here may interpolate at build time.
const PANEL_JS =
  "(function(){" +
  "var $=function(id){return document.getElementById(id)};" +
  "var initialRounds=null;var lastChatLen=-1;" +
  "function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}" +
  "function post(path,body){return fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(function(r){return r.json()});}" +
  "function renderChat(chat){if(chat.length===lastChatLen)return;lastChatLen=chat.length;" +
  "var el=$('itl-chat');el.innerHTML=chat.map(function(m){" +
  "return '<div class=\"msg '+(m.role==='user'?'user':'assistant')+'\">'+esc(m.content)+'</div>';}).join('');" +
  "el.scrollTop=el.scrollHeight;}" +
  "function render(s){" +
  "if(initialRounds===null)initialRounds=s.rounds;" +
  "if(s.rounds>initialRounds){location.reload();return;}" +
  "$('itl-model').textContent='chatting with '+s.improverModel;" +
  "$('itl-current').textContent='Current version: round '+s.best+'.';" +
  "renderChat(s.chat||[]);" +
  "var busy=$('itl-busy');var SP='<span class=\"spinner\"></span>';" +
  "if(s.phase==='chatting'){busy.hidden=false;busy.innerHTML=SP+s.improverModel+' is thinking\\u2026';$('itl-log').hidden=true;}" +
  "else if(s.phase==='running'){busy.hidden=false;busy.innerHTML=SP+'Running round '+s.rounds+'\\u2026 (page reloads when done)';" +
  "$('itl-log').hidden=false;$('itl-log').textContent=(s.lines||[]).join('\\n');}" +
  "else{busy.hidden=true;$('itl-log').hidden=true;}" +
  "$('itl-send').disabled=(s.phase!=='idle');$('itl-apply').disabled=(s.phase!=='idle');$('itl-rerun').disabled=(s.phase!=='idle');" +
  "if(s.pending&&s.phase!=='running'){$('itl-prop').hidden=false;$('itl-diff').innerHTML=s.pending.diff;" +
  "$('itl-hyp').textContent=s.pending.hypothesis?('Hypothesis: '+s.pending.hypothesis):'';" +
  "$('itl-warn').hidden=!s.pending.warning;$('itl-warn').textContent=s.pending.warning||'';}" +
  "else{$('itl-prop').hidden=true;}" +
  "}" +
  "function poll(){fetch('/status').then(function(r){return r.json()}).then(render).catch(function(){});}" +
  "setInterval(poll,2000);poll();" +
  "function send(){var t=$('itl-msg').value.trim();if(!t)return;$('itl-msg').value='';" +
  "post('/chat',{message:t}).then(poll);}" +
  "$('itl-send').addEventListener('click',send);" +
  "$('itl-msg').addEventListener('keydown',function(e){if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();send();}});" +
  "$('itl-apply').addEventListener('click',function(){post('/apply').then(poll);});" +
  "$('itl-rerun').addEventListener('click',function(){post('/rerun').then(poll);});" +
  "})();"

const readBody = (req) =>
  new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => {
      data += c
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        resolve({})
      }
    })
  })

// Pull the last complete proposal out of an assistant reply: the last fenced
// code block. In JSON mode it must parse to an object that looks like a meme
// verdict; in prompt mode any non-empty block counts.
const extractProposal = (reply, jsonMode) => {
  const blocks = [...reply.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/gi)].map((m) => m[1].trim())
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]
    if (!block) continue
    if (!jsonMode) return block
    const parsed = parseJsonLoose(block)
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      ('template_name' in parsed || 'meaning' in parsed || 'is_meme' in parsed || 'meme' in parsed)
    ) {
      return JSON.stringify(parsed, null, 2)
    }
  }
  return null
}

// Same validators that hard-reject in the automated loop — here they only
// warn, because the user sees the diff and decides. Returns null or one string.
const warningText = ({ current, proposal, captions, jsonMode }) => {
  const warnings = proposalWarnings({ current, proposal, captions, jsonMode })
  if (!warnings.length) return null
  return (
    '⚠ This proposal would be auto-rejected in the automated loop: ' +
    warnings.join(' · ') +
    ' — you can still apply it, but consider asking for a version that passes.'
  )
}

export async function startInteractive(ctx) {
  const {
    state,
    save,
    runDir,
    evaluate, // async (amendment, label) => { perImage, scores }
    apiKey,
    improverModel,
    pinnedJson,
    holdoutIds,
    logLines,
    log,
    port: wantPort,
  } = ctx

  state.config.interactive = true
  if (!state.feedback) state.feedback = []
  if (!state.chatLog) state.chatLog = []

  const jsonMode = Boolean(pinnedJson)
  const status = { phase: 'idle', pending: null }
  const chat = state.chatLog // persisted transcript; also the live thread
  const bestRound = () => [...state.rounds].filter((r) => r.accepted).pop()
  // User messages sent since the last applied round — recorded as that round's critique.
  let cycleUserMsgs = []

  const systemPrompt = () =>
    buildChatSystemPrompt({
      mode: jsonMode ? 'json' : 'prompt',
      baseSystem: state.basePrompt.system,
      baseUser: state.basePrompt.user,
      currentAmendment: bestRound().amendment,
      latestRound: bestRound(),
      history: state.rounds.map((x) => ({ index: x.index, scores: x.scores, accepted: x.accepted })),
      pastFeedback: state.feedback.filter((f) => f.action === 'approved'),
    })

  const onChat = async (message) => {
    status.phase = 'chatting'
    chat.push({ role: 'user', content: message })
    cycleUserMsgs.push(message)
    try {
      const reply = await callOpenAI({
        apiKey,
        model: improverModel,
        systemPrompt: systemPrompt(),
        messages: chat.slice(-24).map((m) => ({ role: m.role, content: m.content })),
        maxTokens: 12000,
      })
      chat.push({ role: 'assistant', content: reply })
      const proposal = extractProposal(reply, jsonMode)
      if (proposal) {
        const best = bestRound()
        const captions = (best.perImage ?? [])
          .flatMap((img) => (img.branches ?? []).map((b) => String(b?.caption ?? '')))
          .filter(Boolean)
        const hypothesis = reply.match(/^HYPOTHESIS:\s*(.+)$/m)?.[1]?.trim() ?? ''
        status.pending = {
          amendment: proposal,
          hypothesis,
          diff: diffHtml(best.amendment, proposal),
          warning: warningText({ current: best.amendment, proposal, captions, jsonMode }),
        }
      }
      save()
    } catch (err) {
      chat.push({ role: 'assistant', content: `(error talking to ${improverModel}: ${err?.message ?? err})` })
      log(`chat call failed: ${err?.message ?? err}`)
    } finally {
      status.phase = 'idle'
    }
  }

  // Runs a round with `amendment`. rerun=true means "same version, new
  // sample" — no critique is recorded and no version change is implied.
  const runRound = async ({ amendment, rerun, hypothesis }) => {
    const index = state.rounds.length
    const critique = rerun ? '' : cycleUserMsgs.join('\n')
    status.phase = 'running'
    try {
      const evald = await evaluate(amendment, `round ${index} (${rerun ? 'rerun' : 'applied by you'})`)
      state.rounds.push({
        index,
        amendment,
        hypothesis: rerun ? undefined : hypothesis || undefined,
        improver: rerun
          ? null
          : { analysis: '', what_changed: '(from chat — see the conversation in state.json)', model: improverModel },
        userCritique: critique,
        accepted: true,
        approvedByUser: !rerun,
        rerun: Boolean(rerun),
        ...evald,
      })
      state.best = { roundIndex: index, amendment }
      if (critique) state.feedback.push({ round: index, critique, action: 'approved' })
      if (!rerun) cycleUserMsgs = []
      const captions = (evald.perImage ?? [])
        .flatMap((img) => img.branches ?? [])
        .map((b) => `${b.score ?? '?'} ${JSON.stringify(String(b.caption ?? ''))}`)
      chat.push({
        role: 'assistant',
        content:
          `(${rerun ? 'rerun — same version' : 'applied'} — round ${index} ran: train mean ${evald.scores.train.meanAll?.toFixed(3)})\n` +
          captions.join('\n'),
      })
      save()
      log(`round ${index} done — train mean ${evald.scores.train.meanAll?.toFixed(3)}`)
    } catch (err) {
      log(`round failed: ${err?.message ?? err}`)
      chat.push({ role: 'assistant', content: `(round failed: ${err?.message ?? err})` })
    } finally {
      status.phase = 'idle'
    }
  }

  const onApply = async () => {
    const pending = status.pending
    if (!pending) return
    status.pending = null
    await runRound({ amendment: pending.amendment, rerun: false, hypothesis: pending.hypothesis })
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const json = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(buildHtml(state, { panelHtml: PANEL_HTML, clientJs: PANEL_JS }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      json({
        phase: status.phase,
        rounds: state.rounds.length,
        best: bestRound()?.index ?? 0,
        improverModel,
        lines: logLines.slice(-14),
        chat,
        pending: status.pending
          ? { diff: status.pending.diff, warning: status.pending.warning, hypothesis: status.pending.hypothesis }
          : null,
      })
      return
    }
    if (req.method === 'POST') {
      const body = await readBody(req)
      if (status.phase !== 'idle') {
        json({ ok: false, error: 'busy' })
        return
      }
      if (url.pathname === '/chat' && String(body.message ?? '').trim()) {
        void onChat(String(body.message).trim())
        json({ ok: true })
        return
      }
      if (url.pathname === '/apply') {
        void onApply()
        json({ ok: true })
        return
      }
      if (url.pathname === '/rerun') {
        void runRound({ amendment: bestRound().amendment, rerun: true })
        json({ ok: true })
        return
      }
    }
    res.writeHead(404)
    res.end('not found')
  })

  const port = await new Promise((resolve, reject) => {
    let p = wantPort
    const tryListen = () => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && p < wantPort + 20) {
          p += 1
          tryListen()
        } else reject(err)
      })
      server.listen(p, '127.0.0.1', () => resolve(p))
    }
    tryListen()
  })

  const url = `http://localhost:${port}/`
  log(`\nInteractive mode: ${url}`)
  log('Chat on the page; Ctrl-C here when you are done (everything is saved after each round).')
  if (process.platform === 'darwin') exec(`open ${url}`)

  // Keep the static report fresh too, so the run dir stands alone afterwards.
  const refresh = setInterval(() => writeReport(runDir, state), 15000)
  refresh.unref()

  // Stay alive until the user kills the process.
  await new Promise(() => {})
}
