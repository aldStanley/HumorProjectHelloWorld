// Builds the self-contained HTML report for a run (state.json -> report.html).
// Regenerated after every round, so you can open/refresh it while a run is
// still going. Rebuild by hand with:
//   node scripts/meme-opt/report.mjs scripts/meme-opt/runs/<name>
import fs from 'node:fs'
import path from 'node:path'

import { parseJsonLoose } from './lib.mjs'

const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—')

const scoreClass = (s) =>
  !Number.isFinite(s) ? 'r-none' : s >= 0.85 ? 'r3' : s >= 0.6 ? 'r2' : s >= 0.35 ? 'r1' : 'r0'

const scoreChip = (s) =>
  `<span class="score"><i class="${scoreClass(s)}"></i>${fmt(s, 2)}</span>`

const prettyRecognize = (img) => {
  const parsed = parseJsonLoose(img?.recognizeText)
  return parsed && typeof parsed === 'object'
    ? JSON.stringify(parsed, null, 2)
    : String(img?.recognizeText ?? '')
}

// The exact Recognize-content output, formatted: the meme verdict as a
// key/value grid up top (it drives every downstream step), then the full
// output pretty-printed (re-indented JSON when parseable, raw text otherwise).
const recognizeBlock = (img) => {
  const pretty = prettyRecognize(img)
  const meme = img.meme
  const kv = meme
    ? `<div class="kv">${[
        ['is_meme', String(meme.is_meme)],
        ['template_name', meme.template_name ?? 'null'],
        ['image_is_punchline', String(meme.image_is_punchline)],
        ['image_delivers', meme.image_delivers ?? 'null'],
        ['confidence', meme.confidence ?? '—'],
        ['meaning', meme.meaning ?? 'null'],
        ['how_a_caption_should_use_it', meme.how_a_caption_should_use_it ?? 'null'],
      ]
        .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
        .join('')}</div>`
    : '<p class="muted">⚠ no "meme" field found in the recognize output</p>'
  return `<div class="recognize">
    <h4>Recognize content — exact output <span class="muted">(the input every downstream step sees)</span></h4>
    ${kv}
    <details><summary>full output</summary><pre>${esc(pretty)}</pre></details>
  </div>`
}

// ---- score-trend chart (server-rendered SVG; two series, direct-labeled) ----
const chartSvg = (rounds) => {
  const W = 680
  const H = 240
  const padL = 42
  const padR = 96
  const padT = 14
  const padB = 30
  const iw = W - padL - padR
  const ih = H - padT - padB
  const n = rounds.length
  const x = (i) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const y = (v) => padT + (1 - v) * ih

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (v) =>
        `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" class="grid"/>` +
        `<text x="${padL - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text>`
    )
    .join('')
  const xticks = rounds
    .map(
      (r, i) =>
        `<text x="${x(i)}" y="${H - 8}" class="tick" text-anchor="middle">R${r.index}</text>`
    )
    .join('')

  const series = (key, cls, label) => {
    const pts = rounds
      .map((r, i) => ({ i, v: r.scores?.[key]?.meanAll, r }))
      .filter((p) => Number.isFinite(p.v))
    if (!pts.length) return ''
    const line =
      pts.length > 1
        ? `<polyline class="line ${cls}" points="${pts.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}"/>`
        : ''
    const dots = pts
      .map((p) => {
        const acc = p.r.accepted || p.r.index === 0
        const tip = `Round ${p.r.index} · ${label} ${fmt(p.v)} · ${
          p.r.index === 0 ? 'baseline' : p.r.accepted ? 'accepted' : 'rejected'
        }`
        return `<circle class="dot ${cls} ${acc ? '' : 'rej'}" cx="${x(p.i)}" cy="${y(p.v)}" r="4.5" data-tip="${esc(tip)}"/>`
      })
      .join('')
    const last = pts[pts.length - 1]
    const dl =
      `<circle class="dot ${cls}" cx="${W - padR + 12}" cy="${y(last.v)}" r="4"/>` +
      `<text x="${W - padR + 20}" y="${y(last.v) + 4}" class="dlabel">${label}</text>`
    return line + dots + dl
  }

  return (
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Mean alignment score by round">` +
    grid +
    xticks +
    series('train', 's1', 'train') +
    series('holdout', 's2', 'holdout') +
    '</svg>'
  )
}

const roundsTable = (rounds) => {
  const words = (r) => (r.amendment ? r.amendment.trim().split(/\s+/).length : 0)
  const rows = rounds
    .map((r, i) => {
      const prev = i > 0 ? [...rounds.slice(0, i)].filter((x) => x.accepted).pop() : null
      const d = prev ? words(r) - words(prev) : 0
      const delta = prev && !r.rerun ? ` <span class="${d > 0 ? 'grew' : 'muted'}">(${d >= 0 ? '+' : ''}${d})</span>` : ''
      return `<tr>
      <td>R${r.index}${r.index === 0 ? ' (baseline)' : ''}</td>
      <td>${fmt(r.scores?.train?.meanAll)}</td>
      <td>${fmt(r.scores?.train?.meanTop)}</td>
      <td>${fmt(r.scores?.holdout?.meanAll)}</td>
      <td>${fmt(r.scores?.holdout?.meanTop)}</td>
      <td>${r.index === 0 ? '—' : r.rerun ? '↻ rerun (same version)' : r.approvedByUser ? '✓ approved by you' : r.accepted ? '✓ accepted' : '✗ rejected'}</td>
      <td>${r.amendment ? `${words(r)} words${delta}` : 'none'}</td>
      <td class="hyp">${r.hypothesis ? esc(r.hypothesis) : '—'}</td>
    </tr>`
    })
    .join('')
  return `<div class="tablewrap"><table>
    <thead><tr><th>Round</th><th>Train mean</th><th>Train top</th><th>Holdout mean</th><th>Holdout top</th><th>Verdict</th><th>Size</th><th>Hypothesis tested</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`
}

const memeCard = (r, img, baselineImg, holdoutIds, corpus) => {
  const tops = (r) => {
    const s = (r?.branches ?? []).map((b) => b.score).filter(Number.isFinite)
    return s.length ? Math.max(...s) : null
  }
  const top = tops(img)
  const baseTop = tops(baselineImg)
  const verdicts = (img.branches ?? []).map((b) => b.score).filter(Number.isFinite)
  const meanLabel = verdicts.length
    ? `mean (${verdicts.join(' + ')})/${verdicts.length} = ${fmt(
        verdicts.reduce((a, b) => a + b, 0) / verdicts.length,
        2
      )}`
    : ''
  const delta =
    Number.isFinite(top) && Number.isFinite(baseTop) && baselineImg !== img
      ? ` <span class="delta">${top - baseTop >= 0 ? '+' : ''}${(top - baseTop).toFixed(2)} vs R0</span>`
      : ''
  const tag = holdoutIds.has(img.imageId) ? '<span class="tag holdout">holdout</span>' : '<span class="tag">train</span>'
  const template = img.meme
    ? img.meme.is_meme
      ? esc(img.meme.template_name ?? 'unnamed template')
      : 'not a meme'
    : 'no meme verdict'

  const branches = (img.branches ?? [])
    .map((b) => {
      if (b?.error) return `<div class="branch err">⚠ branch error: ${esc(b.error)}</div>`
      if (!b) return ''
      const setup =
        b.requiredSetupPresent === false
          ? ' <span class="warntag">⚠ setup missing</span>'
          : ''
      return `<div class="branch">
        <div class="caption">${scoreChip(b.score)} ${esc(b.caption)}${setup} · ${traceLink(r, img, b)}</div>
        ${branchReasoning(b, corpus)}
      </div>`
    })
    .join('')

  return `<div class="card">
    <div class="cardhead">${tag}<span class="template">${template}</span>
      <span class="cardtop">best ${fmt(top, 2)} · ${meanLabel}${delta}</span></div>
    <img src="${esc(img.url)}" alt="meme ${esc(img.imageId)}" loading="lazy"/>
    ${recognizeBlock(img)}
    ${
      img.momentsText
        ? `<details><summary>Find Meme-Relevant CU Context — raw output</summary><pre>${esc(img.momentsText)}</pre></details>`
        : ''
    }
    ${img.error ? `<div class="branch err">⚠ ${esc(img.error)}</div>` : branches}
    ${img.naiveText ? `<details><summary>naive caption (no CU context)</summary><pre>${esc(img.naiveText)}</pre></details>` : ''}
  </div>`
}

// Word-level diff (LCS over whitespace-preserving tokens). Returns HTML with
// <ins>/<del> marking what changed from `prev` to `cur`.
export const diffHtml = (prev, cur) => {
  const ta = String(prev ?? '').split(/(\s+)/)
  const tb = String(cur ?? '').split(/(\s+)/)
  const n = ta.length
  const m = tb.length
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const parts = []
  const push = (type, s) => {
    if (!s) return
    const last = parts[parts.length - 1]
    if (last && last.type === type) last.s += s
    else parts.push({ type, s })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (ta[i] === tb[j]) {
      push('eq', tb[j])
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', ta[i])
      i += 1
    } else {
      push('ins', tb[j])
      j += 1
    }
  }
  while (i < n) push('del', ta[i++])
  while (j < m) push('ins', tb[j++])
  return parts
    .map((p) =>
      p.type === 'eq'
        ? esc(p.s)
        : p.type === 'ins'
          ? `<ins>${esc(p.s)}</ins>`
          : `<del>${esc(p.s)}</del>`
    )
    .join('')
}

// Does a claimed "CU moment" actually trace back to the community-context
// corpus? Content-word overlap against every corpus row; below the threshold
// it gets flagged as possibly invented by the context-search model.
const contentWords = (s) =>
  new Set(
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3)
  )

const corpusSupport = (momentText, corpus) => {
  if (!corpus?.length) return null // unknown — old run without a saved corpus
  const words = contentWords(momentText)
  if (!words.size) return null
  let best = 0
  for (const row of corpus) {
    const rw = contentWords(row)
    let hit = 0
    for (const w of words) if (rw.has(w)) hit += 1
    best = Math.max(best, hit / words.size)
  }
  return best
}

const momentFlag = (momentText, corpus) => {
  const s = corpusSupport(momentText, corpus)
  if (s === null) return ''
  return s < 0.5
    ? ` <span class="warntag">⚠ weak corpus match (${Math.round(s * 100)}%) — possibly invented, check the raw CU search output</span>`
    : ''
}

// Full provenance for one caption branch: the CU moment that seeded it (with
// relevance score + reason from "Find Meme-Relevant CU Context"), the caption
// step's own reasoning (moment_part + reason), the judge's verdict, and the
// RAW outputs of the caption + judge steps for tracing.
const branchReasoning = (b, corpus) => {
  const m = b.moment && typeof b.moment === 'object' ? b.moment : { moment: b.moment }
  const cap = parseJsonLoose(b.captionText)
  const capObj = cap && typeof cap === 'object' && !Array.isArray(cap) ? cap : {}
  const momentMeta =
    m.score != null || m.reason
      ? ` <span class="muted">(relevance ${esc(m.score ?? '?')} — ${esc(m.reason ?? '')})</span>`
      : ''
  const capLine =
    capObj.moment_part || capObj.reason
      ? `<div><span class="provlabel">caption</span>leaned on: ${esc(capObj.moment_part ?? '—')} — ${esc(
          capObj.reason ?? ''
        )}</div>`
      : ''
  return `<div class="prov">
    <div><span class="provlabel">cu moment</span>${esc(m.moment ?? '—')}${momentMeta}${momentFlag(m.moment, corpus)}</div>
    ${capLine}
    <div><span class="provlabel">judge</span>required: ${esc(b.requiredSetup ?? '—')} · present: ${esc(
      String(b.requiredSetupPresent ?? '?')
    )} — ${esc(b.alignReason ?? '')}</div>
    <details><summary>raw step outputs (caption · judge)</summary>
      <pre>== Meme Caption (with CU context) — raw ==\n${esc(b.captionText ?? '')}\n\n== Check meme format alignment — raw ==\n${esc(
        b.alignText ?? ''
      )}</pre>
    </details>
  </div>`
}

// ---- per-joke pipeline trace (opened in a <dialog> from any caption) ----
// Renders EVERY field of a step's parsed output, keeping the model's own key
// order; keys in `primary` get the bold/highlight treatment (the main output).
const objRows = (obj, primary = []) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ''
  return `<div class="kv">${Object.entries(obj)
    .map(([k, v]) => {
      const isPrimary = primary.includes(k)
      const val =
        v == null
          ? 'null'
          : typeof v === 'object'
            ? `<pre class="kvpre">${esc(JSON.stringify(v, null, 2))}</pre>`
            : `<span class="${isPrimary ? 'pv' : ''}">${esc(String(v))}</span>`
      return `<dt class="${isPrimary ? 'pk' : ''}">${esc(k)}</dt><dd>${val}</dd>`
    })
    .join('')}</div>`
}

const traceId = (r, img, b) => `trace-${r.index}-${img.imageId}-${b.index}`

// The full story of ONE joke: recognize -> CU search -> caption -> judge.
// Key outputs rendered readably; raw model output behind a details toggle.
const traceBody = (r, img, b, corpus, pinnedMode) => {
  const rec = parseJsonLoose(img.recognizeText)
  const meme = rec && typeof rec === 'object' ? rec.meme ?? rec : {}
  const moments = parseJsonLoose(img.momentsText)
  const m = b.moment && typeof b.moment === 'object' ? b.moment : { moment: b.moment }
  const cap = parseJsonLoose(b.captionText)
  const capObj = cap && typeof cap === 'object' && !Array.isArray(cap) ? cap : {}
  const judge = parseJsonLoose(b.alignText)
  const judgeObj = judge && typeof judge === 'object' && !Array.isArray(judge) ? judge : {}

  const momentList = Array.isArray(moments)
    ? moments
        .map((mm, i) => {
          const mo = mm && typeof mm === 'object' ? mm : { moment: mm }
          const chosen = i === b.index
          return `<div class="momentrow${chosen ? ' chosen' : ''}">
            ${chosen ? '<span class="tag ok">→ this joke</span>' : `<span class="muted">moment ${i + 1}</span>`}
            ${objRows(mo, ['moment'])}
            ${chosen ? momentFlag(mo.moment, corpus) : ''}
          </div>`
        })
        .join('')
    : '<p class="muted">could not parse the moment list — see raw output</p>'

  return `<div class="trace">
    <div class="trace-head">
      <img src="${esc(img.url)}" alt=""/>
      <div>
        <div class="trace-caption">${scoreChip(b.score)} ${esc(b.caption)}</div>
        <div class="muted">round ${r.index} · joke ${b.index + 1} · image ${esc(img.imageId).slice(0, 8)}…</div>
      </div>
      <button class="trace-close" aria-label="close">✕</button>
    </div>
    <ol class="steps">
      <li>
        <h4>Recognize content ${img.recognizePinned ? '<span class="tag">pinned by you</span>' : ''}</h4>
        ${objRows(meme, ['template_name', 'how_a_caption_should_use_it'])}
        <details><summary>full output</summary><pre>${esc(prettyRecognize(img))}</pre></details>
      </li>
      <li>
        <h4>Find Meme-Relevant CU Context <span class="muted">(searches the 136-row corpus)</span></h4>
        ${momentList}
        <details><summary>raw output</summary><pre>${esc(img.momentsText ?? '')}</pre></details>
      </li>
      <li>
        <h4>Meme Caption (with CU context)</h4>
        ${objRows(capObj, ['caption']) || `<p class="trace-big">${esc(b.caption)}</p>`}
        <details><summary>raw output</summary><pre>${esc(b.captionText ?? '')}</pre></details>
      </li>
      <li>
        <h4>Check meme format alignment</h4>
        ${objRows(judgeObj, ['meme_format_alignment']) ||
          `<p class="trace-big">${scoreChip(b.score)} meme_format_alignment</p>`}
        <details><summary>raw output</summary><pre>${esc(b.alignText ?? '')}</pre></details>
      </li>
    </ol>
  </div>`
}

// Hidden trace bodies for every joke on the page + the shared dialog.
const traceStore = (state, holdoutIds) => {
  const corpus = state.corpus ?? null
  const pinnedMode = Boolean(state.config?.pinnedMode)
  const divs = []
  for (const r of state.rounds ?? []) {
    for (const img of r.perImage ?? []) {
      for (const b of img.branches ?? []) {
        if (!b || b.error) continue
        divs.push(
          `<div id="${traceId(r, img, b)}" hidden>${traceBody(r, img, b, corpus, pinnedMode)}</div>`
        )
      }
    }
  }
  return `<div hidden>${divs.join('')}</div>
<dialog id="trace-dlg"><div id="trace-slot"></div></dialog>`
}

const traceLink = (r, img, b) =>
  `<a class="tracelink" data-trace="${traceId(r, img, b)}" role="button">trace</a>`

// One wide table per meme: rounds as columns; rows = recognize output, each
// caption+verdict, and the round mean. Scrolls horizontally in its own wrap.
const comparisonSection = (state, holdoutIds) => {
  const rounds = state.rounds ?? []
  const corpus = state.corpus ?? null
  if (!rounds.length) return ''
  const tables = (state.images ?? [])
    .map((imgMeta) => {
      const perRound = rounds.map((r) => (r.perImage ?? []).find((p) => p.imageId === imgMeta.id))
      const maxBranches = Math.max(0, ...perRound.map((p) => (p?.branches ?? []).length))
      const anyImg = perRound.find(Boolean)
      if (!anyImg) return ''

      const header = rounds
        .map(
          (r) =>
            `<th>R${r.index}${r.index === 0 ? ' · base' : r.rerun ? ' ↻ rerun' : r.accepted ? ' ✓' : ' ✗'}</th>`
        )
        .join('')

      const recogRow = perRound
        .map((p, idx) => {
          const pretty = prettyRecognize(p)
          if (idx === 0 || !perRound[idx - 1]) {
            return `<td><pre class="cmp-pre">${esc(pretty)}</pre></td>`
          }
          const prev = prettyRecognize(perRound[idx - 1])
          return `<td><pre class="cmp-pre">${diffHtml(prev, pretty)}</pre></td>`
        })
        .join('')

      // Raw output of "Find Meme-Relevant CU Context" — the step to check
      // when a moment looks like it never came from the corpus.
      const momentsRow = perRound
        .map((p) =>
          p?.momentsText
            ? `<td><details><summary>raw CU search output</summary><pre class="cmp-pre">${esc(p.momentsText)}</pre></details></td>`
            : '<td class="muted">—</td>'
        )
        .join('')

      const captionRows = Array.from({ length: maxBranches }, (_, bi) =>
        `<tr><th class="rowlabel">meme ${bi + 1}</th>` +
        perRound
          .map((p, colIdx) => {
            const b = p?.branches?.[bi]
            if (!b) return '<td class="muted">—</td>'
            if (b.error) return `<td class="err">⚠ ${esc(b.error)}</td>`
            const setup = b.requiredSetupPresent === false ? ' <span class="warntag">⚠ setup missing</span>' : ''
            const flag = momentFlag(
              b.moment && typeof b.moment === 'object' ? b.moment.moment : b.moment,
              corpus
            )
            return `<td>${scoreChip(b.score)} ${esc(b.caption)}${setup}${flag ? ' <span class="warntag">⚠ moment not in corpus?</span>' : ''}
              · ${traceLink(rounds[colIdx], p, b)}</td>`
          })
          .join('') +
        '</tr>'
      ).join('')

      const meanRow = perRound
        .map((p) => {
          const v = (p?.branches ?? []).map((b) => b.score).filter(Number.isFinite)
          if (!v.length) return '<td class="muted">—</td>'
          const m = v.reduce((a, b) => a + b, 0) / v.length
          return `<td><strong>${fmt(m, 2)}</strong> <span class="muted">(${v.join(' + ')})/${v.length}</span></td>`
        })
        .join('')

      const tag = holdoutIds.has(imgMeta.id) ? ' · holdout' : ''
      return `<div class="cmp-block">
        <div class="cmp-head"><img src="${esc(imgMeta.url)}" alt="meme"/><span>${esc(
          anyImg.meme?.template_name ?? imgMeta.id
        )}${tag}</span></div>
        <div class="tablewrap"><table class="cmp">
          <thead><tr><th class="rowlabel"></th>${header}</tr></thead>
          <tbody>
            <tr><th class="rowlabel">recognize output</th>${recogRow}</tr>
            <tr><th class="rowlabel">cu search</th>${momentsRow}</tr>
            ${captionRows}
            <tr><th class="rowlabel">mean</th>${meanRow}</tr>
          </tbody>
        </table></div>
      </div>`
    })
    .join('')
  return `<h2>All rounds side by side</h2>
<p class="legendnote"><label><input type="checkbox" id="diff-toggle" checked>
highlight each round's recognize-output changes vs the round before it
(<ins>added</ins> / <del>removed</del>)</label></p>
<div id="cmp-root">${tables}</div>`
}

const roundSection = (r, baseline, holdoutIds, active, pinnedMode, corpus) => {
  const improver = r.improver
    ? `<div class="improver">
        ${r.hypothesis ? `<p><strong>Hypothesis:</strong> ${esc(r.hypothesis)}</p>` : ''}
        <p><strong>Analysis:</strong> ${esc(r.improver.analysis)}</p>
        <p><strong>What changed:</strong> ${esc(r.improver.what_changed)}</p>
      </div>`
    : ''
  const amendmentLabel = pinnedMode
    ? r.index === 0
      ? 'Your pinned recognize JSON (baseline)'
      : 'Revised recognize JSON tried this round'
    : 'Amendment tried this round'
  const amendment = r.amendment
    ? `<details ${r.index > 0 ? 'open' : ''}><summary>${amendmentLabel}</summary><pre class="amendment">${esc(r.amendment)}</pre></details>`
    : '<p class="muted">Baseline — no amendment; the prompt exactly as the ops page runs it today.</p>'
  const verdict =
    r.index === 0
      ? '<span class="tag">baseline</span>'
      : r.rerun
        ? '<span class="tag">↻ rerun — same version, new sample</span>'
        : r.approvedByUser
          ? '<span class="tag ok">✓ approved by you</span>'
          : r.accepted
            ? '<span class="tag ok">✓ accepted</span>'
            : '<span class="tag bad">✗ rejected — reverted to previous best</span>'
  const critique = r.userCritique
    ? `<p class="scores"><strong>Your critique that led here:</strong> ${esc(r.userCritique)}</p>`
    : ''
  const cards = (r.perImage ?? [])
    .map((img) =>
      memeCard(r, img, (baseline.perImage ?? []).find((b) => b.imageId === img.imageId) ?? img, holdoutIds, corpus)
    )
    .join('')
  return `<section class="round" id="round-${r.index}" ${active ? '' : 'hidden'}>
    <h3>Round ${r.index} ${verdict}</h3>
    <p class="scores">train mean ${fmt(r.scores?.train?.meanAll)} (average of all ${
      r.scores?.train?.captions ?? 0
    } caption verdicts on ${r.scores?.train?.images ?? 0} train meme${
      (r.scores?.train?.images ?? 0) === 1 ? '' : 's'
    }) · train top ${fmt(r.scores?.train?.meanTop)} · holdout mean ${fmt(r.scores?.holdout?.meanAll)}</p>
    ${critique}${improver}${amendment}
    <div class="grid">${cards}</div>
  </section>`
}

// Client-side behavior: round tabs, chart tooltip, copy button. Plain string —
// no template literals, so nothing here interpolates at build time.
const CLIENT_JS =
  "(function(){" +
  "var tabs=document.querySelectorAll('[data-round-tab]');" +
  "tabs.forEach(function(t){t.addEventListener('click',function(){" +
  "tabs.forEach(function(o){o.classList.remove('active')});t.classList.add('active');" +
  "document.querySelectorAll('.round').forEach(function(s){s.hidden=true});" +
  "var el=document.getElementById('round-'+t.getAttribute('data-round-tab'));if(el)el.hidden=false;});});" +
  "var tip=document.getElementById('tip');" +
  "document.querySelectorAll('circle[data-tip]').forEach(function(c){" +
  "c.addEventListener('mouseenter',function(e){tip.textContent=c.getAttribute('data-tip');tip.hidden=false;});" +
  "c.addEventListener('mousemove',function(e){tip.style.left=(e.pageX+14)+'px';tip.style.top=(e.pageY-10)+'px';});" +
  "c.addEventListener('mouseleave',function(){tip.hidden=true;});});" +
  "var btn=document.getElementById('copy-amendment');" +
  "if(btn){btn.addEventListener('click',function(){" +
  "navigator.clipboard.writeText(document.getElementById('best-amendment').textContent).then(function(){" +
  "btn.textContent='Copied ✓';setTimeout(function(){btn.textContent='Copy amendment'},1500);});});}" +
  "var dt=document.getElementById('diff-toggle');var cr=document.getElementById('cmp-root');" +
  "if(dt&&cr){dt.addEventListener('change',function(){cr.classList.toggle('nodiff',!dt.checked);});}" +
  "var dlg=document.getElementById('trace-dlg');var slot=document.getElementById('trace-slot');" +
  "function openTrace(id){var src=document.getElementById(id);if(!src||!dlg)return;" +
  "slot.innerHTML=src.innerHTML;dlg.showModal();}" +
  "document.addEventListener('click',function(e){var a=e.target.closest?e.target.closest('[data-trace]'):null;" +
  "if(a){e.preventDefault();openTrace(a.getAttribute('data-trace'));return;}" +
  "var c=e.target.closest?e.target.closest('.trace-close'):null;" +
  "if(c&&dlg){dlg.close();}});" +
  "if(dlg){dlg.addEventListener('click',function(e){if(e.target===dlg)dlg.close();});}" +
  "if(location.hash.indexOf('#trace-')===0)openTrace(location.hash.slice(1));" +
  "})();"

const CSS = `
:root{
  --surface:#fcfcfb;--panel:#ffffff;--text:#0b0b0b;--text-2:#52514e;--muted:#8a887f;
  --border:#e4e2da;--series-1:#2a78d6;--series-2:#1baf7a;--grid:#ecece7;
  --ok:#008300;--bad:#b0322f;--warn:#e34948;
  --r0:#cde2fb;--r1:#86b6ef;--r2:#2a78d6;--r3:#104281;
  --ins-bg:#dcf1dc;--del-bg:#fbe2e2;--hl:#fdeeb8;
}
@media (prefers-color-scheme: dark){:root{
  --surface:#1a1a19;--panel:#232322;--text:#ffffff;--text-2:#c3c2b7;--muted:#8f8e85;
  --border:#3a3a37;--series-1:#3987e5;--series-2:#199e70;--grid:#31312e;
  --ok:#4cae4c;--bad:#e66767;--warn:#e66767;
  --r0:#1c3a5e;--r1:#1c5cab;--r2:#3987e5;--r3:#86b6ef;
  --ins-bg:#1f3d20;--del-bg:#4a2323;--hl:#4d4120;
}}
*{box-sizing:border-box}
body{margin:0;padding:28px;background:var(--surface);color:var(--text);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px}h3{font-size:15px;margin:0 0 6px}
.meta{color:var(--text-2);font-size:13px;margin-bottom:18px}
svg{width:100%;max-width:680px;height:auto;display:block}
.grid{stroke:var(--grid);stroke-width:1}
.tick{font-size:10px;fill:var(--muted)}
.dlabel{font-size:11px;fill:var(--text-2)}
.line{fill:none;stroke-width:2}
.line.s1{stroke:var(--series-1)}.line.s2{stroke:var(--series-2)}
.dot.s1{fill:var(--series-1)}.dot.s2{fill:var(--series-2)}
.dot.rej{fill:var(--surface);stroke-width:2}
.dot.s1.rej{stroke:var(--series-1)}.dot.s2.rej{stroke:var(--series-2)}
#tip{position:absolute;background:var(--panel);border:1px solid var(--border);border-radius:6px;
  padding:4px 8px;font-size:12px;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.15);z-index:10}
.tablewrap{overflow-x:auto;margin-top:10px}
table{border-collapse:collapse;font-size:13px;min-width:560px}
th,td{text-align:left;padding:5px 12px 5px 0;border-bottom:1px solid var(--border)}
th{color:var(--text-2);font-weight:600}
.best{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.best pre{margin:8px 0}
button{background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:6px;
  padding:5px 12px;font-size:13px;cursor:pointer}
button:hover{border-color:var(--series-1)}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}
.tabs button.active{border-color:var(--series-1);outline:2px solid var(--series-1);outline-offset:-2px}
.grid-cards,.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px;margin-top:12px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px;overflow:hidden}
.card img{max-width:100%;max-height:220px;object-fit:contain;display:block;margin:8px auto;border-radius:6px}
.cardhead{display:flex;gap:8px;align-items:center;font-size:12px;flex-wrap:wrap}
.template{font-weight:600}
.cardtop{margin-left:auto;color:var(--text-2)}
.delta{color:var(--muted)}
.tag{background:var(--surface);border:1px solid var(--border);border-radius:99px;padding:1px 8px;font-size:11px;color:var(--text-2)}
.tag.holdout{border-color:var(--series-2)}
.tag.ok{color:var(--ok);border-color:var(--ok)}
.tag.bad{color:var(--bad);border-color:var(--bad)}
.warntag{color:var(--warn);font-size:12px}
.branch{border-top:1px solid var(--border);padding:8px 0}
.caption{font-size:14px}
.score{display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums;
  font-weight:600;margin-right:6px}
.score i{width:10px;height:10px;border-radius:2px;display:inline-block}
.score i.r0{background:var(--r0)}.score i.r1{background:var(--r1)}
.score i.r2{background:var(--r2)}.score i.r3{background:var(--r3)}
.score i.r-none{background:var(--muted)}
.reason{margin:6px 0;color:var(--text-2);font-size:13px}
.tracelink{color:var(--series-1);cursor:pointer;font-size:12px;text-decoration:underline;white-space:nowrap}
dialog#trace-dlg{width:min(780px,94vw);max-height:88vh;overflow:auto;border:1px solid var(--border);
  border-radius:12px;background:var(--panel);color:var(--text);padding:0}
dialog#trace-dlg::backdrop{background:rgba(0,0,0,.45)}
.trace{padding:0 22px 20px}
.trace-head{position:sticky;top:0;z-index:6;background:var(--panel);display:flex;gap:14px;align-items:center;
  padding:14px 22px 10px;margin:0 -22px 14px;border-bottom:1px solid var(--border)}
.trace-head img{height:56px;border-radius:8px}
.trace-close{margin-left:auto;border:none;background:none;font-size:16px;cursor:pointer;color:var(--muted);
  padding:4px 8px;align-self:flex-start}
.trace-close:hover{color:var(--text)}
.trace-caption{font-size:16px;font-weight:600}
.steps{list-style:none;margin:0;padding:0;counter-reset:step}
.steps>li{position:relative;padding:0 0 18px 40px;counter-increment:step;border-left:2px solid var(--border);margin-left:13px}
.steps>li:last-child{border-left-color:transparent}
.steps>li::before{content:counter(step);position:absolute;left:-14px;top:-2px;width:26px;height:26px;
  border-radius:50%;background:var(--series-1);color:#fff;font-size:13px;font-weight:700;
  display:flex;align-items:center;justify-content:center}
.steps h4{margin:0 0 6px;font-size:13.5px}
.trace-big{font-size:15px;font-weight:600;margin:4px 0 8px}
.momentrow{padding:6px 10px;border-radius:6px;font-size:13px;margin:4px 0;color:var(--text-2);
  border:1px solid var(--border)}
.momentrow.chosen{background:var(--surface);border-color:var(--series-1);color:var(--text)}
.pk{font-weight:700;color:var(--text)}
.pv{background:var(--hl);font-weight:600;border-radius:3px;padding:1px 4px;box-decoration-break:clone}
.kvpre{margin:2px 0;font-size:11px;max-height:220px;overflow:auto}
.prov{display:grid;gap:3px;margin-top:6px;font-size:12.5px;color:var(--text-2)}
.provlabel{font-weight:700;color:var(--muted);text-transform:uppercase;font-size:10px;
  letter-spacing:.06em;margin-right:6px}
.cmp-block{margin:14px 0 22px}
.cmp-head{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-weight:600}
.cmp-head img{height:56px;border-radius:6px}
table.cmp{table-layout:fixed}
table.cmp th,table.cmp td{min-width:300px;max-width:340px;vertical-align:top;padding:8px 12px 8px 0;font-weight:400}
table.cmp thead th{font-weight:600;color:var(--text-2)}
table.cmp th.rowlabel{min-width:110px;max-width:110px;font-weight:600;color:var(--muted);font-size:12px;
  text-align:left;position:sticky;left:0;background:var(--surface)}
.cmp-pre{font-size:11px;margin:0;max-height:none;overflow:visible}
ins{background:var(--ins-bg);color:inherit;text-decoration:none;border-radius:2px}
del{background:var(--del-bg);color:inherit;text-decoration:line-through;border-radius:2px}
#cmp-root.nodiff del{display:none}
#cmp-root.nodiff ins{background:none}
.recognize{border-top:1px solid var(--border);padding-top:8px;margin-bottom:4px}
.recognize h4{margin:0 0 8px;font-size:13px}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;font-size:12.5px;margin:0 0 6px}
.kv dt{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin:0}
.kv dd{margin:0;color:var(--text-2)}
.muted{color:var(--muted)}
.grew{color:#c0392b;font-weight:600}
td.hyp{max-width:340px;font-size:12px;color:var(--text-2)}
details{margin:6px 0}summary{cursor:pointer;color:var(--text-2);font-size:13px}
details.more{margin:34px 0 10px;border-top:1px solid var(--border);padding-top:14px}
details.more>summary{font-size:14px;color:var(--text)}
pre{white-space:pre-wrap;word-break:break-word;background:var(--surface);border:1px solid var(--border);
  border-radius:6px;padding:10px;font-size:12px;max-height:340px;overflow:auto}
.amendment{max-height:none}
.improver{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:4px 14px;margin:10px 0}
.panel{background:var(--panel);border:2px solid var(--series-1);border-radius:10px;padding:14px 16px;margin:22px 0}
.panel textarea{width:100%;min-height:76px;box-sizing:border-box;background:var(--surface);color:var(--text);
  border:1px solid var(--border);border-radius:6px;padding:8px;font:13px/1.5 inherit;margin:8px 0}
.panel .btnrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.chatlog{max-height:460px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin:10px 0}
.msg{white-space:pre-wrap;word-break:break-word;border-radius:10px;padding:8px 12px;font-size:13px;max-width:88%}
.msg.user{align-self:flex-end;background:var(--series-1);color:#fff}
.msg.assistant{align-self:flex-start;background:var(--surface);border:1px solid var(--border)}
.panel button.primary{border-color:var(--series-1);font-weight:600}
.spin{color:var(--muted);font-style:italic}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--border);
  border-top-color:var(--series-1);border-radius:50%;animation:spin .8s linear infinite;
  vertical-align:-2px;margin-right:7px}
@keyframes spin{to{transform:rotate(360deg)}}
.err{color:var(--bad)}
.scores{color:var(--text-2)}
.legendnote{font-size:12px;color:var(--muted)}
`

// extra: { panelHtml, clientJs } — used by the interactive server to inject
// the critique-and-approve panel and its behavior into the page.
export function buildHtml(state, extra = {}) {
  const rounds = state.rounds ?? []
  const holdoutIds = new Set((state.images ?? []).filter((i) => i.holdout).map((i) => i.id))
  const baseline = rounds[0] ?? { perImage: [] }
  const best = state.best ?? { roundIndex: 0, amendment: '' }
  const bestRound = rounds.find((r) => r.index === best.roundIndex)

  const tabs = rounds
    .map(
      (r, i) =>
        `<button data-round-tab="${r.index}" class="${i === rounds.length - 1 ? 'active' : ''}">R${r.index} ${
          r.index === 0 ? '· base' : r.rerun ? '↻' : r.accepted ? '✓' : '✗'
        }</button>`
    )
    .join('')

  const pinnedMode = Boolean(state.config?.pinnedMode)
  const bestBlock = pinnedMode
    ? `<div class="best">
        <h2 style="margin-top:0">Best recognize JSON so far (${best.roundIndex === 0 ? 'round 0 — your original' : `round ${best.roundIndex}`})</h2>
        <p class="muted">To adopt it: in the ops page, open <strong>Recognize content</strong> for this image,
        pin the output, and paste this JSON as the pinned value.</p>
        <pre id="best-amendment">${esc(best.amendment)}</pre>
        ${bestRound?.improver ? `<p class="muted">${esc(bestRound.improver.what_changed)}</p>` : ''}
        <button id="copy-amendment">Copy JSON</button>
      </div>`
    : best.roundIndex > 0 && best.amendment
      ? `<div class="best">
          <h2 style="margin-top:0">Best amendment so far (round ${best.roundIndex})</h2>
          <p class="muted">To adopt it: open this flavor's <strong>step 1 (Recognize content)</strong> prompt
          editor and paste this block at the END of the user prompt — it is additive, nothing above it changes.</p>
          <pre id="best-amendment">${esc(best.amendment)}</pre>
          ${bestRound?.improver ? `<p class="muted">${esc(bestRound.improver.what_changed)}</p>` : ''}
          <button id="copy-amendment">Copy amendment</button>
        </div>`
      : `<div class="best"><h2 style="margin-top:0">Best amendment so far</h2>
          <p class="muted">No amendment has beaten the baseline yet — the baseline prompt is still the best known.</p></div>`

  const holdoutCount = holdoutIds.size
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meme prompt optimization — ${esc(state.config?.runName ?? 'run')}</title>
<style>${CSS}</style>
<h1>Meme prompt optimization — ${esc(state.config?.runName ?? 'run')}</h1>
<p class="meta">flavor ${esc(state.config?.flavorId)} · image set ${esc(state.config?.setSlug)} ·
${(state.images ?? []).length} memes (${(state.images ?? []).length - holdoutCount} train / ${holdoutCount} holdout) ·
recognize model ${esc(state.config?.recognizeModel)} · judge ${esc(state.config?.captionModel)} ·
improver ${esc(state.config?.improverModel)} · started ${esc(state.config?.startedAt ?? '')}</p>

${comparisonSection(state, holdoutIds)}

${extra.panelHtml ?? ''}

<details class="more">
<summary><strong>More detail</strong> — score trend · winning prompt · per-round cards</summary>

<h2>Score trend — mean meme_format_alignment across all captions</h2>
${chartSvg(rounds)}
<p class="legendnote">Filled dot = accepted round (or baseline) · open dot = rejected. Hover a dot for details.
Scores come from the same "Check meme format alignment" judge the ops page uses — treat them as a proxy and eyeball the captions above.</p>
${roundsTable(rounds)}

<h2>Winning prompt</h2>
${bestBlock}

<h2>Rounds — inspect every meme, caption, and judge reason</h2>
<div class="tabs">${tabs}</div>
${rounds.map((r, i) => roundSection(r, baseline, holdoutIds, i === rounds.length - 1, pinnedMode, state.corpus ?? null)).join('')}
</details>

${traceStore(state, holdoutIds)}

<div id="tip" hidden></div>
<script>${CLIENT_JS}</script>
${extra.clientJs ? `<script>${extra.clientJs}</script>` : ''}`
}

export function writeReport(runDir, state) {
  fs.writeFileSync(path.join(runDir, 'report.html'), buildHtml(state))
}

// CLI: rebuild a report from an existing state.json.
if (process.argv[1] && process.argv[1].endsWith('report.mjs')) {
  const runDir = process.argv[2]
  if (!runDir) {
    console.error('usage: node scripts/meme-opt/report.mjs <run dir containing state.json>')
    process.exit(1)
  }
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'))
  writeReport(runDir, state)
  console.log(`wrote ${path.join(runDir, 'report.html')}`)
}
