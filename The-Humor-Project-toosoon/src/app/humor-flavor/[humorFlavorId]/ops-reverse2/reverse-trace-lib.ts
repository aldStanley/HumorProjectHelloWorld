/* eslint-disable @typescript-eslint/no-explicit-any */
// ops-reverse2 trace library — pure functions, no React, no Node APIs.
// The reverse (context → image) counterpart of ops2/trace-lib: instead of
// per-caption traces over one image, it builds per-CANDIDATE traces over one
// MOMENT, in pipeline order — R1 moment analysis → lens steps → the R2 pick
// that chose this image → the R3 branch that wrote this caption → the R4
// verdict. Reuses the ops2 renderers (genericView, unified template view,
// pills) and the .ops2root stylesheet.
import {
  autoGrid,
  details,
  esc,
  genericView,
  hi,
  outlineOf,
  parseLoose,
  pill,
  purposeOf,
  renderTemplateBodyLines,
  renderUnifiedTemplate,
  slotsOf,
  templateBlocksOf,
  TPL_PART_LABEL,
  type DbStep,
  type TemplateBlock,
} from '../ops2/trace-lib'

// One archived model call (ops_run_steps row) of a reverse run. position holds
// the step's orderBy; R3 fan-out rows carry which image in branchLabel.
export type RevArchStep = {
  opKey: string
  opTitle: string | null
  position: number | null
  branchLabel: string | null
  stepOrderBy: number | null
  providerModelId: string | null
  includeImage: boolean | null
  systemPrompt: string | null
  userPrompt: string | null
  priorOutputs: Record<string, string> | null
  output: string | null
  error: string | null
  durationMs: number | null
}

// The pipeline snapshot stored in ops_runs.spec.steps at archive time.
export type SpecStep = {
  id?: number
  orderBy: number
  description: string
  systemPrompt: string
  userPrompt: string
  providerModelId: string
  temperature: number | null
  includeImage: boolean
  isHidden?: boolean
}

// outputs.results rows (BatchResult shape from the reverse client).
export type RevResult = {
  imageKey: string
  imageId: string
  imageUrl: string
  caption: string
  rank: number
  entity: string
  emotionalAlignment: number
}

export type RevWorkbenchInput = {
  flavorId: number
  label: string
  // ops_run_images.outputs: momentInput, momentAnalysis, associationLenses,
  // picks (raw R2 selections), jokesByKey, results, noFit?
  outputs: Record<string, any>
  arch: RevArchStep[]
  specSteps: SpecStep[]
  dbSteps: DbStep[]
  momentStatus: string | null
  momentError: string | null
  // Baseline RUN of the same flavor (its spec snapshot) — when present,
  // template views box the blocks this run's prompts added or edited, in place.
  diffSource?: {
    label: string
    steps: { orderBy: number; description: string; systemPrompt: string; userPrompt: string }[]
  } | null
  // WHY this flavor differs from its source — the flavor's description field.
  // Shown as an INTENT banner on every diff panel so the reviewer knows what
  // the change is trying to accomplish.
  diffIntent?: string | null
  // imgN → url resolved from the run's study image set (positional, same walk
  // as the Maker's catalog). Fallback for candidates whose image never ranked;
  // URLs archived on results override these.
  setUrlByKey?: Record<string, string>
}

export type RevTrace = {
  idx: number
  caption: string
  imageKey: string
  kind: 'selected' | 'dropped'
  rank: number | null
  // table fields for the caption picker: pairing entity, its POV, whether the
  // entity string is verbatim in the moment (named) or model-derived
  // (abstracted), R2's alignment score, and the R4 judge's drop reason
  imageUrl: string | null
  entity: string | null
  alt: boolean
  anchored: boolean | null
  alignment: number | null
  reason: string | null
  railHtml: string
  chainHtml: string
}

export type RevWorkbench = {
  funnelHtml: string
  diagnosticsHtml: string
  traces: RevTrace[]
}

const isReverse = (d: string) => /^R\d/i.test(d)
const PRE_STEP_FALLBACK = 4

// ---- POV machinery (alt-POV experiment instrumentation) --------------------
// "Alt POV" = the caption speaks as a named entity instead of the default
// "Me". Authoritative signal is the pick's is_default_pov flag; captions with
// no pick fall back to the string test.
type PovStage = { total: number; alt: number }
export type PovFunnel = { entities: PovStage; picks: PovStage; captions: PovStage; ranked: PovStage }

const altOfPick = (pick: any, caption?: string | null): boolean =>
  pick && typeof pick.is_default_pov === 'boolean'
    ? !pick.is_default_pov
    : caption != null
      ? !/^me\b/i.test(caption.trim())
      : false

const analysisOf = (outputs: Record<string, any>): any =>
  typeof outputs?.momentAnalysis === 'string' ? parseLoose(outputs.momentAnalysis) : outputs?.momentAnalysis

// How many entities/pairings/captions/ranked results speak from an alt POV —
// the attrition across R1 → R2 → R3 → R4 for one archived moment.
export function povFunnelOf(outputs: Record<string, any>): PovFunnel {
  const stage = (): PovStage => ({ total: 0, alt: 0 })
  const f: PovFunnel = { entities: stage(), picks: stage(), captions: stage(), ranked: stage() }
  const ents: any[] = Array.isArray(analysisOf(outputs)?.entities) ? analysisOf(outputs).entities : []
  f.entities.total = ents.length
  // R1 sometimes OMITS is_default_pov on non-default entities instead of
  // writing false; the mechanical rule forces explicit true on defaults, so
  // a missing flag counts as non-default.
  f.entities.alt = ents.filter((e) => e && e.is_default_pov !== true).length
  const picks: any[] = Array.isArray(outputs?.picks) ? outputs.picks : []
  const byKey: Record<string, any> = {}
  for (const p of picks) if (p?.image_key) byKey[String(p.image_key)] = p
  f.picks.total = picks.length
  f.picks.alt = picks.filter((p) => altOfPick(p)).length
  const jokes = outputs?.jokesByKey
  if (jokes && typeof jokes === 'object')
    for (const [k, v] of Object.entries(jokes)) {
      if (!Array.isArray(v)) continue
      f.captions.total += v.length
      for (const j of v as any[]) if (altOfPick(byKey[k], j?.caption)) f.captions.alt += 1
    }
  const results: any[] = Array.isArray(outputs?.results) ? outputs.results : []
  f.ranked.total = results.length
  f.ranked.alt = results.filter((r) => altOfPick(byKey[String(r?.imageKey)], r?.caption)).length
  return f
}

// Per-result POV classification for one archived moment's outputs — used by
// the before/after compare board in the client.
export const isAltResult = (
  outputs: Record<string, any>,
  r: { imageKey?: string; caption?: string }
): boolean => {
  const picks: any[] = Array.isArray(outputs?.picks) ? outputs.picks : []
  const pick = picks.find((p) => String(p?.image_key) === String(r?.imageKey))
  return altOfPick(pick, r?.caption ?? null)
}

const povBadge = (alt: boolean) =>
  alt
    ? '<span class="chip" style="background:var(--accent);color:var(--bg)">ALT</span>'
    : '<span class="chip">Me</span>'

// ---- flavor-vs-source prompt diff ------------------------------------------
export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string }

// Line-level LCS diff — prompts are at most a few hundred lines.
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split('\n')
  const B = b.split('\n')
  const n = A.length
  const m = B.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ kind: 'same', text: A[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: A[i] })
      i++
    } else {
      out.push({ kind: 'add', text: B[j] })
      j++
    }
  }
  while (i < n) out.push({ kind: 'del', text: A[i++] })
  while (j < m) out.push({ kind: 'add', text: B[j++] })
  return out
}

// Traditional side-by-side (split) diff: source on the left, current on the
// right, line numbers in gutters, red deletions / green additions, changed
// runs paired row-wise, long unchanged runs collapsed. Returns null when the
// texts are identical. Styles live in SXS_CSS (append it to OPS2_CSS).
export function renderPromptDiff(
  source: string,
  current: string,
  leftLabel?: string,
  rightLabel?: string
): string | null {
  if (source === current) return null
  const lines = diffLines(source, current)
  type Cell = { no: number; text: string; kind: 'same' | 'add' | 'del' } | null
  const rows: { l: Cell; r: Cell }[] = []
  let a = 0
  let b = 0
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind === 'same') {
      a++
      b++
      rows.push({ l: { no: a, text: lines[i].text, kind: 'same' }, r: { no: b, text: lines[i].text, kind: 'same' } })
      i++
      continue
    }
    // pair a maximal run of dels/adds row-wise, GitHub split-view style
    const dels: string[] = []
    const adds: string[] = []
    while (i < lines.length && lines[i].kind !== 'same') {
      if (lines[i].kind === 'del') dels.push(lines[i].text)
      else adds.push(lines[i].text)
      i++
    }
    for (let k = 0; k < Math.max(dels.length, adds.length); k++)
      rows.push({
        l: k < dels.length ? { no: ++a, text: dels[k], kind: 'del' } : null,
        r: k < adds.length ? { no: ++b, text: adds[k], kind: 'add' } : null,
      })
  }
  const CTX = 3
  const keep = new Array(rows.length).fill(false)
  rows.forEach((r, idx) => {
    if (r.l?.kind === 'same' && r.r?.kind === 'same') return
    for (let k = Math.max(0, idx - CTX); k <= Math.min(rows.length - 1, idx + CTX); k++) keep[k] = true
  })
  const cell = (c: Cell) => {
    if (!c) return '<td class="dgut"></td><td class="dcode dempty"></td>'
    const cls = c.kind === 'del' ? ' ddel' : c.kind === 'add' ? ' dadd' : ''
    const mark = c.kind === 'del' ? '<b>− </b>' : c.kind === 'add' ? '<b>+ </b>' : ''
    return `<td class="dgut${cls}">${c.no}</td><td class="dcode${cls}">${mark}${esc(c.text) || '&nbsp;'}</td>`
  }
  const body: string[] = []
  let skippedLines: string[] = []
  const flush = () => {
    if (!skippedLines.length) return
    // collapsed but never hidden — the skipped lines are one click away
    body.push(
      `<tr><td colspan="4" class="dskip"><details><summary>··· ${skippedLines.length} unchanged line${skippedLines.length === 1 ? '' : 's'} ···</summary><div class="dskipbody">${esc(skippedLines.join('\n'))}</div></details></td></tr>`
    )
    skippedLines = []
  }
  rows.forEach((r, idx) => {
    if (!keep[idx]) {
      skippedLines.push(r.l?.text ?? r.r?.text ?? '')
      return
    }
    flush()
    body.push(`<tr>${cell(r.l)}${cell(r.r)}</tr>`)
  })
  flush()
  const head =
    leftLabel || rightLabel
      ? `<thead><tr><th colspan="2">${esc(leftLabel ?? 'source')}</th><th colspan="2">${esc(rightLabel ?? 'current')}</th></tr></thead>`
      : ''
  // explicit colgroup: with table-layout:fixed, a spanning first row (header
  // or "unchanged lines" strip) would otherwise split all 4 columns equally
  // and blow the gutters up to 25% width each
  return `<div class="sxs-diff"><table><colgroup><col class="cgut"><col><col class="cgut"><col></colgroup>${head}<tbody>${body.join('')}</tbody></table></div>`
}

// ---- structured prompt diff -------------------------------------------------
// Diff organized by the prompt template's STRUCTURE: every block of the
// current prompt is shown as a template-style row with its part label
// (PURPOSE / INPUT / CONSTRAINT / OUTPUT / CHECKLIST), and each block carries
// its own status — unchanged blocks stay as slim dimmed rows so the skeleton
// remains navigable; added blocks render green with the full template
// treatment; edited blocks embed a side-by-side diff scoped to just that
// block; removed blocks render red.

const blockText = (b: TemplateBlock) => ((b.title ? b.title + '\n' : '') + b.body).trim()

// Similarity for pairing an old block with its edited successor inside a
// changed run: shared-line ratio.
const blockSim = (a: TemplateBlock, b: TemplateBlock) => {
  const A = blockText(a).split('\n').map((l) => l.trim()).filter(Boolean)
  const B = new Set(blockText(b).split('\n').map((l) => l.trim()).filter(Boolean))
  if (!A.length || !B.size) return 0
  return A.filter((l) => B.has(l)).length / Math.max(A.length, B.size)
}

type BlockRow =
  | { status: 'same'; cur: TemplateBlock }
  | { status: 'added'; cur: TemplateBlock }
  | { status: 'removed'; src: TemplateBlock }
  | { status: 'edited'; src: TemplateBlock; cur: TemplateBlock }

const diffBlocks = (src: TemplateBlock[], cur: TemplateBlock[]): BlockRow[] => {
  // LCS over exact block text
  const n = src.length
  const m = cur.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = blockText(src[i]) === blockText(cur[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const rows: BlockRow[] = []
  let i = 0
  let j = 0
  const flushRun = (dels: TemplateBlock[], adds: TemplateBlock[]) => {
    // pair by title first, then by line-similarity — leftovers are pure adds/removes
    const usedDel = new Set<number>()
    const pairs: { d: number; a: number }[] = []
    adds.forEach((a, ai) => {
      let best = -1
      let bestSim = 0.3
      dels.forEach((d, di) => {
        if (usedDel.has(di)) return
        const sim = a.title && a.title === d.title ? 1 : blockSim(d, a)
        if (sim > bestSim) {
          bestSim = sim
          best = di
        }
      })
      if (best >= 0) {
        usedDel.add(best)
        pairs.push({ d: best, a: ai })
      }
    })
    dels.forEach((d, di) => {
      if (!usedDel.has(di)) rows.push({ status: 'removed', src: d })
    })
    adds.forEach((a, ai) => {
      const p = pairs.find((x) => x.a === ai)
      if (p) rows.push({ status: 'edited', src: dels[p.d], cur: a })
      else rows.push({ status: 'added', cur: a })
    })
  }
  while (i < n || j < m) {
    if (i < n && j < m && blockText(src[i]) === blockText(cur[j])) {
      rows.push({ status: 'same', cur: cur[j] })
      i++
      j++
      continue
    }
    const dels: TemplateBlock[] = []
    const adds: TemplateBlock[] = []
    while (i < n || j < m) {
      if (i < n && j < m && blockText(src[i]) === blockText(cur[j])) break
      if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) dels.push(src[i++])
      else adds.push(cur[j++])
    }
    flushRun(dels, adds)
  }
  return rows
}

// Intent convention: the flavor description holds the global hypothesis,
// optionally followed by per-change lines "INTENT[<key>]: <why>". A key is a
// substring matched (case-insensitively) against each changed block's text;
// the matched why-line renders inside that block's box in the diff.
export type IntentEntry = { key: string; text: string }
export function parseIntent(description: string | null | undefined): { global: string; entries: IntentEntry[] } {
  const d = (description ?? '').trim()
  const entries: IntentEntry[] = []
  for (const m of d.matchAll(/^INTENT\[(.+?)\]:\s*(.+)$/gm)) entries.push({ key: m[1].trim(), text: m[2].trim() })
  const global = d.split(/^INTENT\[/m)[0].trim()
  return { global, entries }
}

// The experiment banner — a colored callout card, deliberately NOT styled
// like the prompt-template rows. One bullet per sentence/line of the global
// intent text.
export function renderIntentCard(globalIntent: string | null | undefined): string {
  const g = (globalIntent ?? '').trim()
  if (!g) return ''
  const bullets = g
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])/))
    .map((s) => s.trim())
    .filter(Boolean)
  return `<div style="border:1px solid var(--accent);border-left:5px solid var(--accent);border-radius:8px;background:var(--panel);padding:9px 13px;margin:6px 0 12px">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;flex-wrap:wrap">
      <span style="background:var(--accent);color:var(--bg);font-size:10px;font-weight:800;padding:1px 9px;border-radius:8px;letter-spacing:.5px">INTENT</span>
      <span class="dim small">the experiment this flavor runs — from the flavor description; INTENT[key] lines there annotate individual changes</span></div>
    <ul style="margin:0;padding-left:18px">
      ${bullets.map((b) => `<li style="margin:3px 0;font-size:13px">${esc(b)}</li>`).join('')}
    </ul></div>`
}

const intentLineFor = (block: TemplateBlock, intents: IntentEntry[]) => {
  const text = blockText(block).toLowerCase()
  const hit = intents.find((e) => e.key && text.includes(e.key.toLowerCase()))
  return hit
    ? `<div class="small" style="font-style:italic;color:var(--dim);margin:1px 0 6px"><b style="color:var(--ink);font-style:normal">why:</b> ${esc(hit.text)}</div>`
    : ''
}

const statusTag = (label: string, colorVar: string) =>
  `<span style="background:var(${colorVar});color:var(--bg);font-size:10px;font-weight:700;padding:1px 8px;border-radius:8px;white-space:nowrap">${label}</span>`

export function renderStructuredPromptDiff(
  srcSys: string,
  srcUsr: string,
  curSys: string,
  curUsr: string,
  srcLabel: string,
  intents: IntentEntry[] = []
): string | null {
  if (srcSys === curSys && srcUsr === curUsr) return null
  const curPur = purposeOf(curSys, curUsr)
  const srcPur = purposeOf(srcSys, srcUsr)
  const rows = diffBlocks(
    templateBlocksOf(srcSys, srcUsr, { text: srcPur.text, persona: srcPur.persona ?? null }),
    templateBlocksOf(curSys, curUsr, { text: curPur.text, persona: curPur.persona ?? null })
  )

  // summary line: counts by status, with the parts they touch
  const touched = (want: BlockRow['status']) => {
    const parts = rows
      .filter((r) => r.status === want)
      .map((r) => TPL_PART_LABEL[(r.status === 'removed' ? r.src : r.cur).part] ?? '?')
    return parts.length ? `${parts.length} (${[...new Set(parts)].join(', ')})` : null
  }
  const summaryBits = [
    touched('added') && `<span style="color:var(--good);font-weight:700">＋ added ${touched('added')}</span>`,
    touched('edited') && `<span style="color:var(--mid);font-weight:700">± edited ${touched('edited')}</span>`,
    touched('removed') && `<span style="color:var(--bad);font-weight:700">− removed ${touched('removed')}</span>`,
    `<span class="dim">${rows.filter((r) => r.status === 'same').length} blocks unchanged</span>`,
  ].filter(Boolean)

  // purpose banner row (the template's PURPOSE lives outside the block list)
  const purposeRow =
    srcPur.text === curPur.text
      ? `<div class="tpl-row" style="opacity:.5"><div class="tpl-part tpl-part-purpose">PURPOSE</div><div class="tpl-block"><span class="dim small">“${esc(curPur.text.slice(0, 110))}${curPur.text.length > 110 ? '…' : ''}”</span></div></div>`
      : `<div class="tpl-row"><div class="tpl-part tpl-part-purpose">PURPOSE</div><div class="tpl-block" style="border-left:3px solid var(--mid);padding-left:8px">${statusTag('± edited', '--mid')}${renderPromptDiff(srcPur.text, curPur.text) ?? ''}</div></div>`

  // Consecutive added (or removed) blocks are ONE concept — merge them into a
  // single box with the paragraph spacing kept inside, one tag, one why-line.
  type Group = { status: BlockRow['status']; rows: BlockRow[] }
  const groups: Group[] = []
  for (const r of rows) {
    const last = groups[groups.length - 1]
    if ((r.status === 'added' || r.status === 'removed') && last?.status === r.status) last.rows.push(r)
    else groups.push({ status: r.status, rows: [r] })
  }

  const whysOf = (blocks: TemplateBlock[]) => {
    const lines = blocks.map((b) => intentLineFor(b, intents)).filter(Boolean)
    return [...new Set(lines)].join('')
  }

  let prev = 'purpose'
  const rowHtml = groups
    .map((g) => {
      const blocks = g.rows.map((r) => (r.status === 'removed' ? r.src : r.cur))
      const first = blocks[0]
      const label = first.part === prev ? '' : TPL_PART_LABEL[first.part] || first.part.toUpperCase()
      prev = blocks[blocks.length - 1].part
      const rail = `<div class="tpl-part tpl-part-${first.part}">${label}</div>`
      // Only a REAL section title goes in the header — a fabricated truncated
      // "title" would hide the rest of its line. Untitled blocks get the tag
      // alone and their body rendered IN FULL.
      const tagRow = (tag: string) =>
        `<div style="display:flex;justify-content:flex-end;margin-bottom:2px">${tag}</div>`
      const blockInner = (b: TemplateBlock, i: number) =>
        `<div${i ? ' style="margin-top:12px"' : ''}>${b.title ? `<div class="tpl-title">${esc(b.title)}</div>` : ''}${renderTemplateBodyLines(b.body.split('\n'), b.part === 'output')}</div>`
      if (g.status === 'same') {
        // slim but never hidden: the full block is one click away
        const block = first
        const snippet = block.title ?? block.body.trim().split('\n')[0].slice(0, 90) + '…'
        return `<div class="tpl-row" style="opacity:.55">${rail}<div class="tpl-block"><details><summary class="dim small" style="cursor:pointer" title="unchanged — click for the full block">${esc(snippet)}</summary>${renderTemplateBodyLines(block.body.split('\n'), block.part === 'output')}</details></div></div>`
      }
      if (g.status === 'added')
        return `<div class="tpl-row">${rail}<div class="tpl-block" style="border-left:3px solid var(--good);background:var(--good-bg);border-radius:0 6px 6px 0;padding:6px 10px">
          ${tagRow(statusTag(`＋ added vs ${esc(srcLabel)}`, '--good'))}${whysOf(blocks)}
          ${blocks.map(blockInner).join('')}</div></div>`
      if (g.status === 'removed')
        return `<div class="tpl-row">${rail}<div class="tpl-block" style="border-left:3px solid var(--bad);background:var(--bad-bg);border-radius:0 6px 6px 0;padding:6px 10px">
          ${tagRow(statusTag('− removed', '--bad'))}${whysOf(blocks)}
          ${blocks.map((b) => `<div class="tpl-text" style="text-decoration:line-through;opacity:.7">${esc(blockText(b))}</div>`).join('')}</div></div>`
      // edited: side-by-side diff scoped to this block (the diff carries the
      // full text of both versions, title line included)
      const r = g.rows[0] as Extract<BlockRow, { status: 'edited' }>
      return `<div class="tpl-row">${rail}<div class="tpl-block" style="border-left:3px solid var(--mid);border-radius:0 6px 6px 0;padding:6px 10px;background:var(--mid-bg)">
        ${tagRow(statusTag('± edited', '--mid'))}${whysOf([r.cur])}
        ${first.title ? `<div class="tpl-title">${esc(first.title)}</div>` : ''}
        ${renderPromptDiff(blockText(r.src), blockText(r.cur)) ?? ''}</div></div>`
    })
    .join('')

  return `<div style="display:flex;flex-wrap:wrap;gap:14px;align-items:baseline;margin:2px 0 8px">${summaryBits.join('')}</div>${purposeRow}${rowHtml}`
}

// One step's full "what changed" panel: the structured (template-part) diff,
// with the raw whole-prompt side-by-side diff nested underneath.
export function renderStepPromptChanges(
  src: { systemPrompt: string; userPrompt: string },
  cur: { systemPrompt: string; userPrompt: string },
  srcLabel: string,
  intents: IntentEntry[] = []
): string | null {
  const structured = renderStructuredPromptDiff(src.systemPrompt, src.userPrompt, cur.systemPrompt, cur.userPrompt, srcLabel, intents)
  if (!structured) return null
  const sysRaw = renderPromptDiff(src.systemPrompt, cur.systemPrompt, `${srcLabel} · system prompt`, 'this flavor · system prompt')
  const usrRaw = renderPromptDiff(src.userPrompt, cur.userPrompt, `${srcLabel} · user prompt`, 'this flavor · user prompt')
  return structured + details('raw side-by-side diff — whole prompt', (sysRaw ?? '') + (usrRaw ?? ''))
}

// Stylesheet for the side-by-side diff — the client appends this to OPS2_CSS.
export const SXS_CSS = `
/* match the app's page background (light yellow / dark) instead of the ops2 grey */
.ops2root{--bg:rgb(var(--canvas))}
.ops2root .sxs-diff{overflow-x:auto;border:1px solid var(--line);border-radius:6px;margin:8px 0;width:100%;background:var(--bg)}
.ops2root .sxs-diff table{width:100%;border-collapse:collapse;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.5;table-layout:fixed}
.ops2root .sxs-diff th{text-align:left;padding:4px 10px;background:var(--panel);border-bottom:1px solid var(--line);color:var(--dim);font-weight:600;font-size:11px}
.ops2root .sxs-diff th+th{border-left:1px solid var(--line)}
.ops2root .sxs-diff col.cgut{width:38px}
.ops2root .sxs-diff .dgut{text-align:right;padding:0 7px;color:var(--dim);user-select:none;vertical-align:top;background:var(--panel);border-right:1px solid var(--line)}
.ops2root .sxs-diff td.dcode+td.dgut{border-left:1px solid var(--line)}
.ops2root .sxs-diff .dcode{padding:0 9px;white-space:pre-wrap;word-break:break-word;vertical-align:top;color:var(--ink)}
.ops2root .sxs-diff .dgut.ddel{color:var(--bad);background:var(--bad-bg)}
.ops2root .sxs-diff .dcode.ddel{background:var(--bad-bg)}
.ops2root .sxs-diff .dcode.ddel b{color:var(--bad)}
.ops2root .sxs-diff .dgut.dadd{color:var(--good);background:var(--good-bg)}
.ops2root .sxs-diff .dcode.dadd{background:var(--good-bg)}
.ops2root .sxs-diff .dcode.dadd b{color:var(--good)}
.ops2root .sxs-diff .dempty{background:repeating-linear-gradient(45deg,transparent,transparent 5px,var(--chip-bg) 5px,var(--chip-bg) 10px)}
.ops2root .sxs-diff .dskip{text-align:center;color:var(--dim);background:var(--panel);padding:3px 0;font-size:11px;border-top:1px dashed var(--line);border-bottom:1px dashed var(--line)}
.ops2root .sxs-diff .dskip summary{cursor:pointer}
.ops2root .sxs-diff .dskipbody{text-align:left;white-space:pre-wrap;word-break:break-word;padding:4px 12px;color:var(--dim)}
.ops2root .reads-list{margin:2px 0 6px;font-size:12px}
.ops2root .reads-list .rk{margin-bottom:2px}
.ops2root .reads-item{margin:3px 0 3px 4px}
.ops2root .readlink{display:inline-block;background:var(--addr-bg);color:var(--addr-ink);border-radius:6px;padding:1px 8px;font-size:12px;font-weight:600;cursor:pointer}
.ops2root .readlink:hover{text-decoration:none;filter:brightness(1.08);outline:1px solid var(--accent)}
`

// Same partition rule as the reverse clients: analyzer first; selector,
// caption fan-out, ranker are the LAST THREE; anything between is a lens step.
export const partitionReverseSteps = <T extends { orderBy: number; description: string }>(
  steps: T[]
) => {
  const tagged = steps.filter((s) => isReverse(s.description))
  const list = (tagged.length ? tagged : steps.filter((s) => s.orderBy > PRE_STEP_FALLBACK))
    .slice()
    .sort((a, b) => a.orderBy - b.orderBy)
  return {
    r1: list[0] ?? null,
    middles: list.slice(1, Math.max(1, list.length - 3)),
    r2: list[list.length - 3] ?? null,
    r3: list[list.length - 2] ?? null,
    r4: list[list.length - 1] ?? null,
    all: list,
  }
}

export function buildReverseWorkbench(input: RevWorkbenchInput): RevWorkbench {
  const { outputs, arch, specSteps, dbSteps } = input
  const moment: string = String(outputs?.momentInput ?? '')

  // Templates: prefer the run's spec snapshot (what actually ran); the current
  // DB prompt is the drift reference.
  const tplSteps: SpecStep[] = specSteps.length
    ? specSteps
    : dbSteps.map((s) => ({
        id: s.id,
        orderBy: s.orderBy,
        description: s.description,
        systemPrompt: s.systemPrompt,
        userPrompt: s.userPrompt,
        providerModelId: s.providerModelId,
        temperature: s.temperature,
        includeImage: s.includeImage,
      }))
  const part = partitionReverseSteps(tplSteps)
  const dbByOrder: Record<number, DbStep> = {}
  const dbByDesc: Record<string, DbStep> = {}
  for (const s of dbSteps) {
    dbByOrder[s.orderBy] = s
    dbByDesc[s.description] = s
  }
  const tplByOrder: Record<number, SpecStep> = {}
  for (const s of tplSteps) tplByOrder[s.orderBy] = s
  // Resolve a node's CURRENT DB step by description first: inserting a step
  // renumbers everything after it, so an old run's order-6 R2 must link to
  // the DB's order-7 R2, not to whatever now sits at order 6.
  const dbFor = (n: number | null | undefined): DbStep | null => {
    if (n == null) return null
    const tpl = tplByOrder[n]
    return (tpl && dbByDesc[tpl.description]) ?? dbByOrder[n] ?? null
  }

  // Archived rows by step orderBy; R3 keeps every branch.
  const archRows = (n: number | undefined | null): RevArchStep[] =>
    n == null ? [] : arch.filter((a) => (a.stepOrderBy ?? a.position) === n)
  const archOne = (n: number | undefined | null): RevArchStep | null => archRows(n)[0] ?? null
  const r3Branches = archRows(part.r3?.orderBy)
  const r3ByKey: Record<string, RevArchStep> = {}
  for (const b of r3Branches) if (b.branchLabel) r3ByKey[b.branchLabel] = b

  const results: RevResult[] = Array.isArray(outputs?.results) ? outputs.results : []
  const picks: any[] = Array.isArray(outputs?.picks) ? outputs.picks : []
  const pickByKey: Record<string, any> = {}
  for (const p of picks) if (p?.image_key) pickByKey[String(p.image_key)] = p
  const jokesByKey: Record<string, { caption: string; reason?: string }[]> = {}
  const rawJokes = outputs?.jokesByKey
  if (rawJokes && typeof rawJokes === 'object') {
    for (const [k, v] of Object.entries(rawJokes)) if (Array.isArray(v)) jokesByKey[k] = v as any[]
  } else {
    // fallback: parse each archived R3 branch output
    for (const [k, row] of Object.entries(r3ByKey)) {
      const parsed = parseLoose(row.output)
      const jokes = Array.isArray(parsed?.jokes) ? parsed.jokes : Array.isArray(parsed) ? parsed : []
      jokesByKey[k] = jokes.filter((j: any) => typeof j?.caption === 'string')
    }
  }
  const urlByKey: Record<string, string> = { ...(input.setUrlByKey ?? {}) }
  for (const r of results) if (r.imageKey && r.imageUrl) urlByKey[r.imageKey] = r.imageUrl

  // Rendering context for every output grid: image_key values become
  // thumbnails, and score fields say what they are BETWEEN. The alignment
  // wording covers both reverse recipes: 1549-style (entity vs image) and
  // POV-first (reaction card vs image).
  const gridOpts = {
    imageUrlByKey: urlByKey,
    labelHints: {
      emotional_alignment:
        'fit between what this POV feels or projects in the moment and the reaction recorded on the image’s card, 0–1 (floor 0.8)',
    },
  }

  // ---- prompt column (two-column node, left side) --------------------------
  const promptCol = (n: number | null | undefined, row: RevArchStep | null) => {
    if (n == null) return '<p class="dim">step unknown</p>'
    const tpl = tplByOrder[n]
    const db = dbFor(n)
    const sys = tpl?.systemPrompt ?? db?.systemPrompt ?? ''
    const usr = tpl?.userPrompt ?? db?.userPrompt ?? ''
    const drift = tpl && db && (db.systemPrompt !== tpl.systemPrompt || db.userPrompt !== tpl.userPrompt)
    const pur = purposeOf(sys, usr)
    const outline = [...outlineOf(sys), ...outlineOf(usr)]
    const reads = Object.keys(row?.priorOutputs ?? {})
    const archResolved = row && (row.systemPrompt || row.userPrompt)
    // Chip only — the side-by-side diff itself renders full-width at the node
    // level (diffBlockFor), where it has the screen real estate it needs.
    // Baseline matched by description; compared against THIS run's prompts
    // (sys/usr above prefer the run's spec snapshot over the DB).
    const stepDesc = tpl?.description ?? db?.description ?? ''
    const srcStep = input.diffSource?.steps.find((s) => s.description === stepDesc) ?? null
    const srcLabel = input.diffSource ? 'baseline run' : ''
    const srcDiffers = !!srcStep && (srcStep.systemPrompt !== sys || srcStep.userPrompt !== usr)
    // Each read is one line and clickable: the client opens the archived
    // resolved value (priorOutputs[slot]) in a sidebar. data-step/data-branch
    // identify the arch row; data-slot the input.
    const readLine = (s: string) => {
      const v = row?.priorOutputs?.[s]
      return `<div class="reads-item"><a href="#" class="readlink mono" data-step="${n}" data-branch="${esc(row?.branchLabel ?? '')}" data-slot="${esc(s)}" title="open this input's value in the sidebar">\${${esc(s)}}</a> <span class="dim small">${v == null ? 'not archived' : `${String(v).length.toLocaleString()} ch`} →</span></div>`
    }
    return `<div class="reads-list"><span class="rk">reads</span>
      ${reads.length ? reads.map(readLine).join('') : '<span class="dim small">no recorded inputs</span>'}</div>
      <div class="inputs-strip">
      ${row?.includeImage ? '<span class="chip">+ image</span>' : ''}
      ${drift ? '<span class="chip warnchip" title="the DB prompt has been edited since this run">✎ DB prompt differs from this run</span>' : ''}
      ${srcDiffers ? `<span class="chip" style="background:var(--good-bg);color:var(--good);font-weight:600" title="see the side-by-side diff at the bottom of this node">✚ differs from ${esc(srcLabel)} — diff below</span>` : ''}
      ${row?.durationMs ? `<span class="chip">${(row.durationMs / 1000).toFixed(1)}s</span>` : ''}</div>
      <div class="kv"><span class="rk">purpose</span> <span class="purptext">${esc(pur.text)}</span> <span class="dim small">(${pur.src})</span></div>
      ${pur.persona ? `<div class="kv"><span class="rk">persona</span> <span class="dim small">${esc(pur.persona)}</span></div>` : ''}
      ${outline.length ? `<div class="outline"><span class="rk">prompt outline</span> ${outline.map((o) => `<span class="chip mono">${esc(o)}</span>`).join(' ')}</div>` : ''}
      ${archResolved
        ? details('prompt as sent — archived verbatim', `<div class="sc-label small">system</div><pre class="prompt">${esc(row!.systemPrompt || '')}</pre><div class="sc-label small">user</div><pre class="prompt">${esc(row!.userPrompt || '')}</pre>`)
        : '<div class="dim small">resolved prompt not archived for this call</div>'}
      ${details(`prompt template — ${sys.length + usr.length} ch`,
        `<div class="tpl-row"><div class="tpl-part tpl-part-purpose">PURPOSE</div><div class="tpl-block tpl-purpose">“${esc(pur.text)}”</div></div>
         ${pur.persona ? `<div class="tpl-row"><div class="tpl-part">PERSONA</div><div class="tpl-block tpl-text">${esc(pur.persona)}</div></div>` : ''}
         ${renderUnifiedTemplate(sys, usr, { text: pur.text, persona: pur.persona ?? null })}
         ${details('raw text (system / user)', `<pre class="prompt">${hi(sys)}</pre><pre class="prompt">${hi(usr)}</pre>`)}`)}`
  }

  // Full-width side-by-side diff of this step's prompts AS RUN vs the baseline
  // run's snapshot — attached below a node's two columns so it can use the
  // whole row. Open by default: it only exists on steps that differ.
  const diffBlockFor = (n: number | null | undefined) => {
    if (n == null || !input.diffSource) return ''
    const tpl = tplByOrder[n]
    const db = dbFor(n)
    if (!tpl && !db) return ''
    const cur = {
      description: tpl?.description ?? db?.description ?? '',
      systemPrompt: tpl?.systemPrompt ?? db?.systemPrompt ?? '',
      userPrompt: tpl?.userPrompt ?? db?.userPrompt ?? '',
    }
    // Match the baseline step by DESCRIPTION only — an orderBy fallback would
    // diff renumbered steps against the wrong sibling. No match = the step is
    // new in this run; diff it against nothing so it renders all-added.
    const srcStep = input.diffSource.steps.find((s) => s.description === cur.description) ?? {
      systemPrompt: '',
      userPrompt: '',
    }
    const { global: globalIntent, entries: intentEntries } = parseIntent(input.diffIntent)
    const html = renderStepPromptChanges(srcStep, cur, 'baseline run', intentEntries)
    if (!html) return ''
    return details('✚ what this run changes in this step — by template part, vs the baseline run', renderIntentCard(globalIntent) + html, true)
  }

  const titleOf = (n: number | null | undefined, row: RevArchStep | null) => {
    if (row?.opTitle) return row.opTitle
    if (n != null && tplByOrder[n]) return tplByOrder[n].description
    return n != null ? `step ${n}` : 'step'
  }
  const node = (n: number | null | undefined, row: RevArchStep | null, extra: string, body: string, cls = '') =>
    `<div class="tnode ${cls}">
      <div class="tn-head"><b>${esc(titleOf(n, row))}</b>${row?.branchLabel ? ` <span class="chip mono">${esc(row.branchLabel)}</span>` : ''}${extra ? ' — ' + extra : ''}</div>
      ${row?.error ? `<div class="flag f-missing"><b class="mono small">[error]</b> ${esc(row.error)}</div>` : ''}
      <div class="tn-cols"><div class="tn-prompt"><div class="colhead">prompt</div>${promptCol(n, row)}</div>
      <div class="tn-out"><div class="colhead">output</div>${body}</div></div>
      ${diffBlockFor(n)}</div>`

  const outBody = (row: RevArchStep | null, primary?: string | null) =>
    row
      ? genericView(parseLoose(row.output), row.output, primary ?? null, gridOpts) +
        details('raw output', `<pre class="mono small">${esc((row.output || '').slice(0, 12000))}</pre>`)
      : '<p class="dim">no archived call for this step (hidden, or run before archiving existed)</p>'

  // ---- POV funnel — where alt POVs survive or die across R1→R4, written as
  // full sentences (one per stage) rather than pills --------------------------
  const funnel = povFunnelOf(outputs)
  const stageName = (sp: { description?: string } | null | undefined, fallback: string) =>
    esc((sp?.description ?? fallback).split('\n')[0].slice(0, 60))
  const stageLine = (name: string, did: string, s: PovStage, altNoun: string) =>
    s.total
      ? `<li><b>${name}</b> ${did} <b>${s.total}</b> — <b>${s.alt}</b> ${altNoun}, ${s.total - s.alt} the default “Me”.</li>`
      : ''
  const funnelHtml = `<p>This run's chances to use an alternative point of view — a caption spoken by a
      named entity from the moment instead of the default “Me” — and where those chances survived or died:</p>
    <ul style="margin:4px 0 12px;padding-left:22px;display:flex;flex-direction:column;gap:3px">
    ${stageLine(stageName(part.r1, 'R1 (analyze the moment)'), 'extracted candidate speakers:', funnel.entities, 'a named entity')}
    ${stageLine(stageName(part.r2, 'R2 (select images)'), 'paired images with speakers:', funnel.picks, 'pairings with a named entity')}
    ${stageLine(stageName(part.r3, 'R3 (write captions)'), 'wrote candidate captions:', funnel.captions, 'spoken by a named entity')}
    ${stageLine(stageName(part.r4, 'R4 (rank captions)'), 'ranked captions into the final list:', funnel.ranked, 'spoken by a named entity')}
    </ul>`

  // Speaker anchor: is the chosen entity string literally in the moment text?
  // (surfaced per-trace as `anchored`; the client renders the named/abstracted chip)
  const momentLc = moment.toLowerCase()

  // ---- POV funnel board (the caption table itself is rendered by the client
  // from the traces' table fields) ------------------------------------------
  const funnelBoardHtml =
    funnelHtml +
    (results.length
      ? ''
      : outputs?.noFit
        ? '<p class="dim">R2 selected no images for this moment (no fit).</p>'
        : '<p class="dim">No ranked results archived for this moment.</p>')

  // ---- diagnostics (mechanical) — every flag is a plain-language category
  // label plus a full sentence; no bracket codes -------------------------------
  const flags: string[] = []
  const FLAG_LABELS: Record<string, string> = {
    missing: 'A step failed',
    mismatch: 'A rule was broken',
    saturation: 'A score is saturated',
    drift: 'The prompts have changed since this run',
    pov: 'Point of view',
  }
  const flag = (kind: string, text: string) =>
    flags.push(`<div class="flag f-${kind}"><b>${FLAG_LABELS[kind] ?? kind}:</b> ${esc(text)}</div>`)
  if (input.momentError) flag('missing', `this moment did not finish — ${input.momentError}`)
  for (const row of arch) if (row.error) flag('missing', `${row.opTitle ?? row.opKey}${row.branchLabel ? ` (${row.branchLabel})` : ''} errored: ${row.error}`)
  for (const r of results) {
    const jokes = jokesByKey[r.imageKey] ?? []
    if (jokes.length && !jokes.some((j) => j.caption === r.caption))
      flag('mismatch', `the ranked caption “${r.caption}” is not word-for-word among the captions written for ${r.imageKey} — the ranking step rewrote it instead of copying it verbatim.`)
  }
  const aligns = picks.map((p) => Number(p?.emotional_alignment)).filter((v) => Number.isFinite(v))
  if (aligns.length >= 4 && new Set(aligns.map(String)).size === 1)
    flag('saturation', `all ${aligns.length} image pairings received the same emotional_alignment score (${aligns[0]}). With zero separation, this rating cannot influence which images get selected.`)
  const pickedKeys = new Set(picks.map((p) => String(p?.image_key)))
  const rankedOutside = results.filter((r) => pickedKeys.size && !pickedKeys.has(r.imageKey))
  if (rankedOutside.length)
    flag('mismatch', `the final ranking includes image(s) ${rankedOutside.map((r) => r.imageKey).join(', ')} that the image-selection step never picked.`)
  const driftSteps = part.all.filter((s) => {
    const db = dbByOrder[s.orderBy]
    return db && (db.systemPrompt !== s.systemPrompt || db.userPrompt !== s.userPrompt)
  })
  if (driftSteps.length)
    flag('drift', `the prompts in the database have been edited since this run executed, for: ${driftSteps.map((s) => s.description.split('\n')[0].slice(0, 40)).join(' · ')}. These outputs came from the archived prompts, not the current ones.`)
  // POV flags — the alt-POV experiment's instrumentation
  if (results.length)
    flag('pov', `${funnel.ranked.alt} of the ${funnel.ranked.total} final ranked captions speak as a named entity instead of the default “Me”.`)
  const pickEntities = picks.map((p) => String(p?.entity ?? '')).filter(Boolean)
  if (pickEntities.length >= 3 && new Set(pickEntities).size === 1)
    flag('pov', `all ${pickEntities.length} image pairings chose the same speaker, “${pickEntities[0]}” — selection collapsed to a single point of view.`)
  const r1Ents: any[] = Array.isArray(analysisOf(outputs)?.entities) ? analysisOf(outputs).entities : []
  const missingFlag = r1Ents.filter((e) => e && typeof e.is_default_pov !== 'boolean')
  if (missingFlag.length)
    flag('pov', `the moment analysis omitted the is_default_pov flag on ${missingFlag.length} speaker${missingFlag.length === 1 ? '' : 's'} (${missingFlag.map((e) => String(e.entity ?? '')).join(' · ')}). They were counted as named entities here, but the image-selection step has to guess the flag it is supposed to copy verbatim.`)
  const altEntityNames: string[] = r1Ents
    .filter((e: any) => e && e.is_default_pov !== true)
    .map((e: any) => String(e.entity ?? ''))
    .filter(Boolean)
  if (altEntityNames.length && picks.length && funnel.picks.alt === 0)
    flag('pov', `named entities were extracted (${altEntityNames.join(' · ')}) but the image-selection step never paired any of them — the alt point of view died at selection, not extraction.`)
  if (!altEntityNames.length && picks.length)
    flag('pov', `the moment analysis extracted zero named entities for this moment, so the alt-POV preference had nothing to prefer. Extraction, not selection, is the bottleneck here.`)
  // entity_scores forensics (runs made after the alt-POV instrumentation):
  // did the preference ever have a chance, and was it obeyed?
  const scoredPicks = picks.filter((p) => Array.isArray(p?.entity_scores) && p.entity_scores.length)
  if (scoredPicks.length) {
    const noChance = scoredPicks.filter(
      (p) => !p.entity_scores.some((s: any) => s?.is_default_pov === false && Number(s?.emotional_alignment) >= 0.8)
    )
    if (noChance.length)
      flag('pov', `for ${noChance.length} of the ${scoredPicks.length} picked images, no named entity scored at least the 0.8 alignment floor, so the alt-POV preference never applied to them. That is an image/entity fit problem, not the model breaking the rule.`)
    for (const p of scoredPicks) {
      if (p.is_default_pov !== true) continue
      const best = p.entity_scores
        .filter((s: any) => s?.is_default_pov === false && Number(s?.emotional_alignment) >= 0.8)
        .sort((a: any, b: any) => Number(b.emotional_alignment) - Number(a.emotional_alignment))[0]
      if (best)
        flag('mismatch', `the alt-POV preference was violated on ${p.image_key}: the default “${p.entity}” was paired even though the named entity “${best.entity}” cleared the floor with ${best.emotional_alignment}. The image-selection step broke its own mechanical rule.`)
    }
  }
  for (const r of results) {
    const pick = pickByKey[r.imageKey]
    if (pick && pick.is_default_pov === false && /^me\b/i.test(r.caption.trim()))
      flag('mismatch', `the caption “${r.caption}” starts with “Me” even though its assigned speaker is the named entity “${pick.entity}” — the caption-writing step ignored the assignment.`)
  }
  const diagnosticsHtml = flags.length
    ? flags.join('')
    : '<p class="dim">No checks fired for this moment — every step completed and no rule was broken.</p>'

  // ---- traces: every candidate joke, selected first --------------------------
  type Cand = {
    caption: string
    imageKey: string
    reason: string | null
    kind: 'selected' | 'dropped'
    rank: number | null
    entity: string | null
    alignment: number | null
  }
  const cands: Cand[] = []
  for (const r of results)
    cands.push({
      caption: r.caption,
      imageKey: r.imageKey,
      reason: null,
      kind: 'selected',
      rank: r.rank,
      entity: r.entity || null,
      alignment: Number.isFinite(Number(r.emotionalAlignment)) ? Number(r.emotionalAlignment) : null,
    })
  for (const [key, jokes] of Object.entries(jokesByKey))
    for (const j of jokes)
      if (!results.some((r) => r.caption === j.caption))
        cands.push({ caption: j.caption, imageKey: key, reason: j.reason ?? null, kind: 'dropped', rank: null, entity: null, alignment: null })

  const r4Row = archOne(part.r4?.orderBy)
  const r2Row = archOne(part.r2?.orderBy)
  const r1Row = archOne(part.r1?.orderBy)

  const traces: RevTrace[] = cands.map((c, i) => {
    const pick = pickByKey[c.imageKey]
    const branch = r3ByKey[c.imageKey] ?? null
    const jokes = jokesByKey[c.imageKey] ?? []
    const nodes: string[] = []
    // chain in pipeline order: R1 (top) → lenses → R2 → R3 → R4 (bottom)
    nodes.push(node(part.r1?.orderBy, r1Row, 'the moment analysis', outBody(r1Row)))
    for (const m of part.middles) {
      const row = archOne(m.orderBy)
      if (row) nodes.push(node(m.orderBy, row, 'lens', outBody(row)))
    }
    // R2 — the pick that brought this image in, plus the entity contest when
    // the run archived entity_scores (alt-POV instrumentation)
    const contestScores: any[] = Array.isArray(pick?.entity_scores) ? pick.entity_scores : []
    const contestHtml = contestScores.length
      ? `<div class="kv"><span class="rk">the R2 contest</span> <span class="dim small">every entity vs this image · floor 0.8 (dimmed = below floor)</span></div>
        <table class="grid small"><thead><tr><th>entity</th><th>pov</th><th>alignment</th></tr></thead><tbody>
        ${contestScores
          .slice()
          .sort((a, b) => Number(b?.emotional_alignment ?? 0) - Number(a?.emotional_alignment ?? 0))
          .map((s) => {
            const win = String(s?.entity ?? '') === String(pick?.entity ?? '')
            const below = Number(s?.emotional_alignment ?? 0) < 0.8
            return `<tr${below ? ' style="opacity:.55"' : ''}><td>${win ? `<b>${esc(String(s?.entity ?? ''))}</b> <span class="chip good-chip">paired</span>` : esc(String(s?.entity ?? ''))}</td>
              <td>${povBadge(s?.is_default_pov === false)}</td><td>${pill(Number(s?.emotional_alignment))}</td></tr>`
          })
          .join('')}</tbody></table>`
      : '<div class="dim small">no entity_scores archived — this run predates the alt-POV instrumentation, so the entity contest is not visible</div>'
    const pickSansScores = pick ? Object.fromEntries(Object.entries(pick).filter(([k]) => k !== 'entity_scores')) : null
    nodes.push(node(part.r2?.orderBy, r2Row, `why ${esc(c.imageKey)} was picked`,
      (pickSansScores ? autoGrid([pickSansScores], 'entity', gridOpts) : '') + contestHtml +
        details('full selection output', genericView(parseLoose(r2Row?.output ?? null), r2Row?.output ?? null, null, gridOpts))))
    // R3 — this image's caption fan-out, with the candidate's own row emphasized
    nodes.push(node(part.r3?.orderBy, branch, 'the branch that wrote this caption',
      (jokes.length
        ? `<div class="kv primary"><span class="rk">caption</span> “${esc(c.caption)}”</div>
           ${c.reason ? `<div class="kv"><span class="rk">reason</span> ${esc(c.reason)}</div>` : ''}
           <div class="kv"><span class="rk">all jokes from ${esc(c.imageKey)}</span></div>${autoGrid(jokes, 'caption')}`
        : outBody(branch, 'caption'))))
    // R4 — the verdict, last
    nodes.push(node(part.r4?.orderBy, r4Row,
      c.kind === 'selected' ? `<b class="good">SELECTED</b> · slot ${c.rank}` : '<b class="bad">DROPPED</b> · not ranked into the top list',
      outBody(r4Row, 'caption'), `${c.kind === 'selected' ? 'ok' : 'cut'} last`))

    const railHtml = `
      ${urlByKey[c.imageKey] ? `<img src="${esc(urlByKey[c.imageKey])}" alt="${esc(c.imageKey)}">` : `<div class="mono small dim">${esc(c.imageKey)}</div>`}
      <div class="railcap">“${esc(c.caption)}”</div>
      <div class="meta-line">
        ${c.kind === 'selected' ? `<span class="chip good-chip">selected · slot ${c.rank}</span>` : '<span class="chip bad-chip">dropped</span>'}
        ${pick?.entity ? `<span class="chip">${esc(String(pick.entity))}</span>` : ''}
        ${povBadge(altOfPick(pick, c.caption))}
      </div>
      ${pick ? `<div class="meta-line">${pill(Number(pick.emotional_alignment), 'alignment')}</div>` : ''}
      ${pick?.reason ? `<div class="railwhy">pick reason: ${esc(String(pick.reason))}</div>` : ''}
      <div class="railwhy mono small">moment: ${esc(moment.slice(0, 160))}${moment.length > 160 ? '…' : ''}</div>`
    const entity = c.entity ?? (pick?.entity != null ? String(pick.entity) : null)
    const alignment =
      c.alignment ??
      (Number.isFinite(Number(pick?.emotional_alignment)) ? Number(pick.emotional_alignment) : null)
    return {
      idx: i,
      caption: c.caption,
      imageKey: c.imageKey,
      kind: c.kind,
      rank: c.rank,
      imageUrl: urlByKey[c.imageKey] ?? null,
      entity,
      alt: altOfPick(pick, c.caption),
      anchored: entity ? momentLc.includes(entity.toLowerCase()) : null,
      alignment,
      reason: c.reason,
      railHtml,
      chainHtml: `<div class="tchain">${nodes.join('')}</div>`,
    }
  })

  return { funnelHtml: funnelBoardHtml, diagnosticsHtml, traces }
}
