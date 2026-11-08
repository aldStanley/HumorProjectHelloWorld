/* eslint-disable @typescript-eslint/no-explicit-any */
// ops2 trace library — pure functions, no React, no Node APIs.
// Ports the trace-workbench design: per-caption traces (gate → ground) with
// two-column nodes (prompt | output), parallel cast-grids, mechanical
// diagnostics, contract dye. Shape-tolerant: enrichment activates when a
// step's parsed output matches a known schema; otherwise falls back to a
// generic view. HTML strings are rendered by the client via innerHTML.

export type DbStep = {
  id: number
  orderBy: number
  description: string
  systemPrompt: string
  userPrompt: string
  providerModelId: string
  isTemperatureSupported: boolean
  temperature: number | null
  includeImage: boolean
}

export type ArchStep = {
  opKey: string
  opTitle: string | null
  stepOrderBy: number | null
  providerModelId: string | null
  includeImage: boolean | null
  systemPrompt: string | null
  userPrompt: string | null
  priorOutputs: Record<string, string> | null
  output: string | null
  error: string | null
}

export type WorkbenchInput = {
  flavorId: number
  steps: DbStep[] // current DB prompts (for drift badges + editing)
  arch: ArchStep[] // archived per-step rows for the selected image (the run being viewed)
  imageUrl: string | null
  additionalContext: string | null
  label: string // e.g. "run 3f2a · image 2ce0e700"
}

// ---------- html helpers ----------
export const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const hi = (s: string) =>
  esc(s).replace(/\$\{([a-zA-Z0-9_]+)\}/g, '<span class="ph">${$1}</span>')
const SCORE_KEY = /score|fit|clarity|resonance|overall|allusion|recovery|confidence|mean/i
export const pill = (v: any, label?: string) => {
  if (v === null || v === undefined || Number.isNaN(v)) return '<span class="pill sc-none">—</span>'
  const cls = v >= 0.7 ? 'sc-hi' : v >= 0.4 ? 'sc-mid' : 'sc-lo'
  const num = typeof v === 'number' ? Math.round(v * 100) / 100 : v
  return `<span class="pill ${cls}">${label ? esc(label) + ' ' : ''}${num}</span>`
}
const addr = (a: string) => `<span class="addr">${esc(a)}</span>`
export const details = (summary: string, body: string, open = false) =>
  `<details${open ? ' open' : ''}><summary>${summary}</summary><div class="dbody">${body}</div></details>`

export const parseLoose = (s: unknown): any => {
  if (typeof s !== 'string') return s ?? null
  let t = s.trim()
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (m) t = m[1].trim()
  try { return JSON.parse(t) } catch { /* fall through */ }
  const starts = [t.indexOf('{'), t.indexOf('[')].filter((x) => x >= 0)
  if (starts.length) {
    const i = Math.min(...starts)
    const j = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
    if (j > i) { try { return JSON.parse(t.slice(i, j + 1)) } catch { /* not json */ } }
  }
  return null
}

const r2 = (x: number) => Math.round(x * 1000) / 1000

// ---------- cast-grid: fields as rows, one numbered column per item ----------
// A row marked primary is the step's MAIN output (declared by the step's
// output contract) — rendered emphasized by one CSS rule, everywhere.
// Optional per-grid rendering context: imageUrlByKey renders image_key-ish
// values as thumbnails; labelHints puts a one-line explanation under a row's
// field-name label (what a score is BETWEEN, units, ...).
export type GridOpts = {
  imageUrlByKey?: Record<string, string>
  labelHints?: Record<string, string>
}

const castGrid = (
  items: any[],
  rows: { label: string; key?: string; get?: (it: any) => any; type?: string; primary?: boolean }[],
  opts?: GridOpts
) => {
  if (!items?.length) return ''
  return `<div class="gridwrap"><table class="grid castgrid"><tbody>
    <tr><th class="rowh"></th>${items.map((_, i) => `<th class="colnum">${i + 1}</th>`).join('')}</tr>
    ${rows.map((r) => {
      const hint = opts?.labelHints?.[r.label]
      return `<tr${r.primary ? ' class="primary"' : ''}><th class="rowh">${esc(r.label)}${hint ? `<div class="rowhint">${esc(hint)}</div>` : ''}</th>${items.map((it) => {
        const v = r.get ? r.get(it) : it[r.key as string]
        if (v === undefined || v === null || v === '') return '<td class="dim">—</td>'
        if (r.type === 'image') {
          const url = opts?.imageUrlByKey?.[String(v)]
          return `<td>${url ? `<img src="${esc(url)}" alt="${esc(v)}" style="width:72px;border-radius:6px;display:block;margin-bottom:2px">` : ''}<span class="mono small">${esc(v)}</span></td>`
        }
        if (r.type === 'score') return `<td>${pill(v)}</td>`
        if (r.type === 'strong') return `<td><b>${esc(v)}</b></td>`
        if (r.type === 'mono') return `<td class="mono small">${esc(v)}</td>`
        return `<td class="${r.type === 'reason' ? 'reason' : ''}">${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td>`
      }).join('')}</tr>`
    }).join('')}
  </tbody></table></div>`
}

// generic: array of shallow objects → cast-grid over the union of keys;
// primaryKey (from the output contract) marks the main row.
export const autoGrid = (
  items: any[],
  primaryKey?: string | null,
  opts?: GridOpts
) => {
  const keys: string[] = []
  for (const it of items) for (const k of Object.keys(it || {})) if (!keys.includes(k)) keys.push(k)
  return castGrid(items, keys.map((k) => ({
    label: k, key: k,
    primary: k === primaryKey,
    type: opts?.imageUrlByKey && /^image_?key$/i.test(k) ? 'image'
      : SCORE_KEY.test(k) && items.some((it) => typeof it?.[k] === 'number') ? 'score'
        : /reason|why/i.test(k) ? 'reason' : undefined,
  })), opts)
}

export const genericView = (parsed: any, raw: string | null, primaryKey?: string | null, opts?: GridOpts): string => {
  if (parsed === null || parsed === undefined)
    return `<div class="prose">${esc((raw || '').slice(0, 4000))}</div>`
  if (Array.isArray(parsed)) {
    if (parsed.every((x) => typeof x === 'string')) return `<ul>${parsed.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    return autoGrid(parsed, primaryKey, opts)
  }
  if (typeof parsed === 'object') {
    return Object.entries(parsed).map(([k, v]) => {
      const isPrimary = k === primaryKey
      if (Array.isArray(v) && v.length && typeof v[0] === 'object')
        return `<div class="kv"><span class="rk">${esc(k)}</span></div>${autoGrid(v, primaryKey, opts)}`
      if (Array.isArray(v)) return `<div class="kv${isPrimary ? ' primary' : ''}"><span class="rk">${esc(k)}</span> ${esc(v.join(' · '))}</div>`
      if (v && typeof v === 'object') {
        const o = v as any
        if (o.score !== undefined) return `<div class="kv"><span class="rk">${esc(k)}</span> ${pill(o.score)} ${esc(o.reason || '')}</div>`
        return `<div class="kv"><span class="rk">${esc(k)}</span> ${esc(JSON.stringify(v))}</div>`
      }
      if (typeof v === 'number' && SCORE_KEY.test(k)) return `<div class="kv"><span class="rk">${esc(k)}</span> ${pill(v)}</div>`
      return `<div class="kv${isPrimary ? ' primary' : ''}"><span class="rk">${esc(k)}</span> ${esc(String(v))}</div>`
    }).join('')
  }
  return `<div class="prose">${esc(String(parsed))}</div>`
}

// ---------- prompt-side helpers ----------
// The purpose is the TASK statement, not the persona. Rule: the first
// user-prompt paragraph that is a real statement — no ${...} placeholders and
// not a data header (ends with ':') — is the purpose; otherwise the system
// opener is. When the purpose comes from the user prompt, the system opener
// is still surfaced separately as the persona.
export const purposeOf = (sys: string, usr: string) => {
  const firstPara = (t: string) => t.trim().split(/\n\s*\n/)[0]?.trim() ?? ''
  const sysPara = firstPara(sys)
  const usrPara = firstPara(usr)
  const usrIsTask = usrPara.length >= 60 && !/\$\{/.test(usrPara) && !/:\s*$/.test(usrPara)
  if (usrIsTask) return { text: usrPara, src: 'user prompt', persona: sysPara.length > 20 ? sysPara : null }
  if (sysPara.length > 20) return { text: sysPara, src: 'system prompt', persona: null }
  return { text: usrPara, src: 'user prompt', persona: null }
}
export const outlineOf = (text: string) => {
  const out: string[] = []
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim().replace(/^-+\s*|\s*-+$/g, '').trim()
    if (line.length >= 6 && line.length <= 80 && /[A-Z]/.test(line) && !/[a-z]/.test(line) &&
      !/^[{["'`]/.test(line) && !/^[-=]+$/.test(line) && !/^\$\{/.test(line)) out.push(line)
  }
  return [...new Set(out)]
}
export const slotsOf = (text: string) =>
  [...new Set([...String(text || '').matchAll(/\$\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]))]

// ---------- structured prompt-template renderer (the step-card treatment) ----
// Parses a prompt into template parts and renders them like the Step Template
// wireframe: purpose banner, sections split on their ALL-CAPS headers, with
// WRONG/RIGHT pairs, mechanical caps, checklist FAIL lines, and the output
// contract each visually typed. Raw text stays available underneath.
const isHeaderLine = (raw: string) => {
  const line = raw.trim().replace(/^-+\s*|\s*-+$/g, '').trim()
  return line.length >= 6 && line.length <= 80 && /[A-Z]/.test(line) && !/[a-z]/.test(line) &&
    !/^[{["'`]/.test(line) && !/^[-=]+$/.test(line) && !/^\$\{/.test(line)
}
// Her prompts pack several named rules into one paragraph ("MINIMAL means…",
// "THE STRENGTH TEST…"). Long plain blocks get broken at sentences that open
// with an ALL-CAPS marker, so each rule reads as its own line.
const breakLongRules = (t: string): string => {
  if (t.length < 260 || t.includes('\n')) return hi(t)
  const sentences = t.split(/(?<=[.?!])\s+(?=[A-Z“"(])/)
  const items: string[][] = []
  let cur: string[] = []
  for (const s of sentences) {
    if (cur.length && /^[“"'(]?[A-Z]{2,}[)\s,:—'-]/.test(s)) { items.push(cur); cur = [s] }
    else cur.push(s)
  }
  if (cur.length) items.push(cur)
  if (items.length < 2) return hi(t)
  return items.map((i) => `<div class="tpl-li">${hi(i.join(' '))}</div>`).join('')
}

export const renderTemplateBodyLines = (body: string[], mono: boolean) => {
    const out: string[] = []
    let buf: string[] = []
    let bufKind: 'plain' | 'wrong' | 'right' = 'plain'
    const flush = () => {
      const t = buf.join('\n').replace(/^\n+|\n+$/g, '')
      if (!t) { buf = []; return }
      if (bufKind === 'wrong') out.push(`<div class="tpl-wrong"><span class="tpl-tag">WRONG</span>${hi(t.replace(/^WRONG[:\s]*/i, ''))}</div>`)
      else if (bufKind === 'right') out.push(`<div class="tpl-right"><span class="tpl-tag">RIGHT</span>${hi(t.replace(/^RIGHT[:\s]*/i, ''))}</div>`)
      else out.push(`<div class="tpl-text${mono ? ' mono' : ''}">${mono ? hi(t) : breakLongRules(t)}</div>`)
      buf = []
    }
    for (const ln of body) {
      const trimmed = ln.trim()
      if (/^WRONG[:\s]/i.test(trimmed)) { flush(); bufKind = 'wrong'; buf.push(trimmed) }
      else if (/^RIGHT[:\s]/i.test(trimmed)) { flush(); bufKind = 'right'; buf.push(trimmed) }
      else if (/^[•·]\s/.test(trimmed) && /(FAIL|rescore|discard)/i.test(trimmed)) {
        flush(); bufKind = 'plain'
        out.push(`<div class="tpl-check">☐ ${hi(trimmed.replace(/^[•·]\s*/, ''))}</div>`)
      } else if (trimmed === '' && bufKind !== 'plain') { flush(); bufKind = 'plain' }
      else buf.push(ln)
    }
    flush()
    // pair adjacent WRONG/RIGHT boxes side by side
    return out.join('').replace(/(<div class="tpl-wrong">[\s\S]*?<\/div>)(<div class="tpl-right">[\s\S]*?<\/div>)/g, '<div class="tpl-pair">$1$2</div>')
      .replace(/(<div class="tpl-right">[\s\S]*?<\/div>)(<div class="tpl-wrong">[\s\S]*?<\/div>)/g, '<div class="tpl-pair">$1$2</div>')
}

// The unified template view: NO system/user split — the merged prompt is
// classified into template parts (INPUT / CONSTRAINT / PROCEDURE / RATINGS /
// OUTPUT / CHECKLIST), each block labeled with its part in a left rail.
// The purpose (and persona) live in the banner and are removed from the body.
const partOfTitle = (title: string) => {
  if (/SCORING|RATING/i.test(title)) return 'ratings'
  if (/PASS|IN ORDER|^STEP\b/i.test(title)) return 'procedure'
  if (/ANTI-FAILURE|CHECKLIST|BEFORE YOU OUTPUT|FAIL/i.test(title)) return 'checklist'
  if (/OUTPUT|FORMAT|JSON|SCHEMA/i.test(title)) return 'output'
  if (/VOICE|PERSONA/i.test(title)) return 'persona'
  return 'constraints'
}
const partOfPara = (t: string) => {
  if (/\$\{/.test(t)) return 'input'
  if (/^Output\b|Output ONLY|Return ONLY|respond in JSON/i.test(t) || (/<[^>]{3,}>/.test(t) && /label|exactly|format|output|json/i.test(t))) return 'output'
  return 'constraints'
}
// The template's block structure, exported so other views (e.g. the reverse
// inspector's structured prompt diff) can classify blocks EXACTLY the way the
// template view renders them.
export type TemplateBlock = { part: string; title: string | null; body: string }
export const templateBlocksOf = (
  sys: string,
  usr: string,
  pur: { text: string; persona: string | null }
): TemplateBlock[] => {
  const full = (String(sys || '').trim() + '\n\n' + String(usr || '').trim()).trim()
  // strip banner content from the body stream
  const paras = full.split(/\n\s*\n/).filter((p) => {
    const t = p.trim()
    return t && t !== pur.text.trim() && t !== (pur.persona ?? '').trim()
  })
  // regroup: paragraphs are units, but a paragraph that opens an ALL-CAPS
  // section keeps its section title for the sub-heading
  const blocks: TemplateBlock[] = []
  for (const p of paras) {
    const lines = p.split('\n')
    if (isHeaderLine(lines[0])) {
      const title = lines[0].trim().replace(/^-+\s*|\s*-+$/g, '').trim()
      blocks.push({ part: partOfTitle(title), title, body: lines.slice(1).join('\n') })
    } else {
      blocks.push({ part: partOfPara(p), title: null, body: p })
    }
  }
  return blocks
}
export const TPL_PART_LABEL: Record<string, string> = {
  input: 'INPUT', constraints: 'CONSTRAINT', procedure: 'PROCEDURE',
  ratings: 'RATINGS', output: 'OUTPUT', checklist: 'CHECKLIST', persona: 'PERSONA',
}
export const renderUnifiedTemplate = (sys: string, usr: string, pur: { text: string; persona: string | null }): string => {
  const blocks = templateBlocksOf(sys, usr, pur)
  const PART_LABEL = TPL_PART_LABEL
  let prev = ''
  return blocks.map((b) => {
    const mono = b.part === 'output'
    const mech = b.title ? /MECHANICAL|CAP|FLOOR/i.test(b.title) : false
    const label = b.part === prev ? '' : PART_LABEL[b.part] || b.part.toUpperCase()
    prev = b.part
    const bodyHtml = renderTemplateBodyLines(b.body.split('\n'), mono)
    return `<div class="tpl-row"><div class="tpl-part tpl-part-${b.part}">${label}</div><div class="tpl-block">
      ${b.title ? `<div class="tpl-title">${esc(b.title)}${mech ? ' <span class="tpl-mech">MECHANICAL</span>' : ''}</div>` : ''}
      ${bodyHtml}</div></div>`
  }).join('')
}

// fill a prompt from the archived priorOutputs (+ image fields when known)
const fillPrompt = (text: string, priors: Record<string, string>, extras: Record<string, string>) =>
  String(text || '').split(/(\$\{[a-zA-Z0-9_]+\})/g).map((part) => {
    const m = part.match(/^\$\{([a-zA-Z0-9_]+)\}$/)
    if (!m) return esc(part)
    const stepM = m[1].match(/^step(\d+)Output$/)
    const v = stepM ? priors[stepM[1]] : extras[m[1]]
    if (v === undefined)
      return `<span class="ph" title="resolved server-side at run time (image field / sampler / builtin)">${esc(part)}</span>`
    return `<span class="filled"><span class="filled-tag">⤷ ${esc(m[1])}</span>${esc(v)}</span>`
  }).join('')

// ---------- workbench ----------
export type TraceView = {
  idx: number
  caption: string
  register: string | null
  kind: 'selected' | 'dropped' | 'unseen'
  railHtml: string // pinned left rail: image + caption + verdict + flags + dye
  chainHtml: string // the node chain
}

export type Workbench = {
  headerHtml: string
  verdictHtml: string
  diagnosticsHtml: string
  traces: TraceView[]
  stepsHtml: string
  captionCount: number
}

export function buildWorkbench(input: WorkbenchInput): Workbench {
  const { steps, arch } = input
  const byOrder: Record<number, DbStep> = {}
  for (const s of steps) byOrder[s.orderBy] = s

  // archived row per step number (prefer stepOrderBy; fall back to op_key digits)
  const archByN: Record<number, ArchStep> = {}
  for (const a of arch) {
    const n = a.stepOrderBy ?? Number((a.opKey.match(/\d+/) || [])[0])
    if (Number.isFinite(n)) archByN[n] = a
  }
  const ns = Object.keys(archByN).map(Number).sort((a, b) => a - b)
  const outputs: Record<number, string> = {}
  const P: Record<number, any> = {}
  for (const n of ns) { outputs[n] = archByN[n].output || ''; P[n] = parseLoose(outputs[n]) }

  // ---- family detection (shape-driven, no flavor hardcoding) ----
  const capSteps = ns.filter((n) => Array.isArray(P[n]?.captions) && P[n].captions.some((c: any) => c?.caption))
  const matchSteps = ns.filter((n) => Array.isArray(P[n]?.matches))
  const readSteps = ns.filter((n) => Array.isArray(P[n]?.ensemble))
  const verdictStep = [...ns].reverse().find((n) => Array.isArray(P[n]) && P[n].some((r: any) => r?.caption && Object.keys(r).some((k) => typeof r[k] === 'number' && SCORE_KEY.test(k))))
  const gateStep = [...ns].reverse().find((n) => Array.isArray(P[n]?.selected) && Array.isArray(P[n]?.dropped))
  const bindingStep = ns.find((n) => typeof P[n]?.core === 'string' && typeof P[n]?.secondary === 'string')
  const CLAUSE = /different-kind|same-kind|same kind/i
  const dyeOn = bindingStep !== undefined && CLAUSE.test(String(P[bindingStep!].core))

  // The batch runner archives RESOLVED prompts (placeholders substituted), so
  // template structure (slots, outline) comes from whichever source still has
  // ${...} placeholders — the archived text if raw, else the DB step.
  const hasPh = (t: string | null | undefined) => /\$\{[a-zA-Z0-9_]+\}/.test(t || '')
  const templateOf = (n: number) => {
    const a = archByN[n]
    const db = byOrder[n]
    if (a && (hasPh(a.systemPrompt) || hasPh(a.userPrompt))) return { sys: a.systemPrompt ?? '', usr: a.userPrompt ?? '', src: 'run' as const }
    if (db) return { sys: db.systemPrompt, usr: db.userPrompt, src: 'db' as const }
    return { sys: a?.systemPrompt ?? '', usr: a?.userPrompt ?? '', src: 'run' as const }
  }
  const promptOf = templateOf
  const parentsOf = (n: number) => {
    const p = templateOf(n)
    return slotsOf(p.sys + '\n' + p.usr)
      .map((s) => { const m = s.match(/^step(\d+)Output$/); return m ? Number(m[1]) : null })
      .filter((x): x is number => x !== null && archByN[x] !== undefined)
  }

  const titleOf = (n: number) => archByN[n]?.opTitle || `S${n} · ${byOrder[n]?.description ?? ''}`

  // ---- the output contract: each step's declared MAIN output field ----
  // Derived from shape (overridable later, per step, in a stored template).
  const outputContractOf = (n: number): { kind: string; primary: string | null } => {
    if (capSteps.includes(n)) return { kind: 'captions', primary: 'caption' }
    if (matchSteps.includes(n)) return { kind: 'matches', primary: 'context' }
    if (readSteps.includes(n)) {
      // the MAIN output of a read is the ensemble itself — bold the ensemble's
      // own field (usually "figure"), never a secondary row that happens to
      // share a name with the contract
      const first = (P[n].ensemble as any[]).find((x) => x && typeof x === 'object')
      const key = first ? ('figure' in first ? 'figure' : Object.keys(first)[0] ?? null) : null
      return { kind: 'read', primary: key }
    }
    if (n === bindingStep) return { kind: 'contract', primary: 'core' }
    if (n === gateStep) return { kind: 'gate', primary: 'caption' }
    if (n === verdictStep) return { kind: 'verdict-list', primary: 'caption' }
    const p = P[n]
    if (Array.isArray(p) && p.some((s: any) => typeof s?.situation === 'string')) return { kind: 'situations', primary: 'situation' }
    if (Array.isArray(p) && p.some((s: any) => typeof s?.caption === 'string')) return { kind: 'export', primary: 'caption' }
    return { kind: 'generic', primary: null }
  }
  const contractChip = (n: number) => {
    const c = outputContractOf(n)
    return c.primary ? `<span class="chip">${addr(`S${n}.output.primary`)} <b>${esc(c.primary)}</b></span>` : ''
  }

  // ---- verdict board ----
  const vRows: any[] = verdictStep !== undefined ? P[verdictStep] : []
  const gate = gateStep !== undefined ? P[gateStep] : { selected: [], dropped: [] }
  const verdictOf = (cap: string) => {
    const si = (gate.selected || []).findIndex((x: any) => x.caption === cap)
    if (si >= 0) return { kind: 'selected' as const, rank: si + 1, ...gate.selected[si] }
    const d = (gate.dropped || []).find((x: any) => x.was === cap)
    if (d) return { kind: 'dropped' as const, ...d }
    return { kind: 'unseen' as const }
  }
  const traceId = (cap: string) => 'trace-' + vRows.findIndex((r) => r.caption === cap)
  const numKeys = vRows.length ? Object.keys(vRows[0]).filter((k) => typeof vRows[0][k] === 'number' && SCORE_KEY.test(k)) : []
  const verdictHtml = vRows.length ? `<table class="grid vboard"><thead><tr><th>#</th><th class="cap-col">caption</th><th>register</th>${numKeys.map((k) => `<th>${esc(k)}</th>`).join('')}<th class="verdict-col">verdict</th><th>trace</th></tr></thead><tbody>
    ${vRows.map((r, i) => { const v = verdictOf(r.caption)
      return `<tr class="${v.kind === 'selected' ? 'row-sel' : 'row-cut'}"><td>${i + 1}</td><td>“${esc(r.caption)}”</td>
      <td>${r.register ? `<span class="chip reg-${esc(r.register)}">${esc(r.register)}</span>` : '—'}</td>
      ${numKeys.map((k) => `<td>${pill(r[k])}</td>`).join('')}
      <td>${v.kind === 'selected' ? `<span class="good">✔ slot ${v.rank}</span> <span class="dim small">${esc((v as any).picked_by || '')}</span>` : v.kind === 'dropped' ? `<span class="bad">✘</span> <span class="dim small">${esc((v as any).why || '')}</span>` : '—'}</td>
      <td><a class="tracelink" href="#${traceId(r.caption)}">trace →</a></td></tr>` }).join('')}</tbody></table>`
    : '<p class="dim">No scored caption list found in this run’s outputs.</p>'

  // ---- diagnostics (mechanical) ----
  // Global flags carry the step numbers they portray, so each flag also
  // renders ON those steps' cards and trace nodes.
  const flags: { kind: string; text: string; steps: number[] }[] = []
  const capFlags: Record<string, { kind: string; text: string }[]> = {}
  const flag = (cap: string | null, kind: string, text: string, atSteps: number[] = []) => {
    if (cap) (capFlags[cap] ||= []).push({ kind, text })
    else flags.push({ kind, text, steps: atSteps })
  }
  const capEntry = (cap: string) => {
    for (const n of capSteps) { const e = (P[n].captions as any[]).find((c) => c.caption === cap); if (e) return { n, e } }
    return null
  }
  for (const r of vRows) {
    if (typeof r.physical_fit === 'number' && typeof r.allusion_mean === 'number' && typeof r.selection_score === 'number') {
      const prod = r2(r.physical_fit * r.allusion_mean)
      if (Math.abs(prod - r.selection_score) > 0.005)
        flag(r.caption, 'mismatch', `selection_score ${r.selection_score} ≠ physical_fit × allusion_mean = ${prod}`)
    }
    const ce = capEntry(r.caption)
    if (!ce) { flag(r.caption, 'missing', 'caption not found in any writer step output — no provenance'); continue }
    const led: any[] = ce.e.element_allusions || []
    if (led.length && typeof r.allusion_mean === 'number') {
      const mean = r2(led.reduce((a, x) => a + (x.allusion ?? 0), 0) / led.length)
      if (Math.abs(mean - r.allusion_mean) > 0.02) flag(r.caption, 'mismatch', `allusion_mean ${r.allusion_mean} ≠ ledger mean ${mean} (S${ce.n})`)
    }
    const cast: any[] = ce.e.image_configuration?.cast || []
    if (cast.length && typeof ce.e.physical_fit === 'number') {
      const mn = Math.min(...cast.map((c) => c.score ?? 1))
      if (ce.e.physical_fit - mn > 0.005 && ce.e.analog_to_caption === undefined)
        flag(r.caption, 'cap-violation', `S${ce.n} physical_fit ${ce.e.physical_fit} exceeds min(cast) ${mn} — the mechanical cap did not bind`)
    }
    for (const e of led) {
      if (e.caption_span && e.evidence === 'caption') {
        const segs = String(e.caption_span).split(/\s*\.\.\.\s*|…/).map((x: string) => x.trim()).filter(Boolean)
        const bad = segs.filter((seg: string) => !r.caption.includes(seg))
        if (bad.length) flag(r.caption, 'span', `caption_span "${e.caption_span}" not a substring of the caption`)
      }
    }
  }
  for (const k of numKeys) {
    const vals = vRows.map((r) => r[k]).filter((v) => typeof v === 'number')
    if (vals.length >= 4 && new Set(vals.map(String)).size === 1)
      flag(null, 'saturation', `column ${k}: all ${vals.length} values = ${vals[0]} — zero separation; this rating cannot influence selection`, verdictStep !== undefined ? [verdictStep] : [])
  }
  if (bindingStep !== undefined) {
    const contentSteps = ns.filter((n) => n > bindingStep! && (capSteps.includes(n) || matchSteps.includes(n) || readSteps.includes(n) || (verdictStep !== undefined && n < verdictStep)))
    const blind = contentSteps.filter((n) => !parentsOf(n).includes(bindingStep!))
    if (blind.length)
      flag(null, 'contract-gap', `the S${bindingStep} contract is NOT an input to S${blind.join(', S')} — those steps cannot honor constraints they never see`, [bindingStep, ...blind])
    if (dyeOn) for (const n of capSteps) {
      const laneCore = P[n]?.captions?.[0]?.image_configuration?.physical_analog?.core
      if (laneCore && !CLAUSE.test(laneCore))
        flag(null, 'contract-drift', `S${n} re-derived the core as "${laneCore}" — the kind clause of S${bindingStep}'s core vanished in transmission`, [n])
    }
  }
  for (const n of ns) {
    const p = promptOf(n)
    const known = new Set([...parentsOf(n).map((x) => `step${x}Output`), 'imageAdditionalContext', 'imageDescription', 'celebrityRecognition', 'recognizedContent', 'allCommunityContexts', 'studentBrainOutput', 'topByVelocity', 'topByVolume', 'recentlyAdded', 'activeMemories', 'persistentMemories', 'dormantMemories', 'imageUrl', 'imageId', 'flavorId', 'flavorName', 'userId'])
    const unknown = slotsOf(p.sys + '\n' + p.usr).filter((s) => !known.has(s) && !/^step\d+Output$/.test(s))
    if (unknown.length) flag(null, 'unbound', `S${n} placeholder(s) \${${unknown.join('}, ${')}} match no known slot — check they resolve, or they reach the model literally`, [n])
  }
  const stepFlags: Record<number, { kind: string; text: string }[]> = {}
  for (const f of flags) for (const n of f.steps) (stepFlags[n] ||= []).push(f)
  const diagnosticsHtml = (flags.length
    ? flags.map((f) => `<div class="flag f-${f.kind}"><b class="mono small">[${f.kind}]</b>${f.steps.length ? ' ' + f.steps.map((n) => `<a class="flagstep" href="#step-${n}">S${n}</a>`).join(' ') + ' ·' : ''} ${esc(f.text)}</div>`).join('')
    : '<p class="dim">No global flags.</p>')
  const stepFlagBanner = (n: number) => (stepFlags[n] || []).map((f) =>
    `<div class="flag f-${f.kind}"><b class="mono small">[${f.kind}]</b> ${esc(f.text)}</div>`).join('')

  // ---- dye ----
  const clauseStatus = (n: number) => {
    if (dyeOn && CLAUSE.test(outputs[n] || '')) return 'states'
    if (dyeOn && parentsOf(n).some((x) => CLAUSE.test(outputs[x] || ''))) return 'carries'
    return 'blind'
  }
  const dyeRow = (lineage: number[]) => !dyeOn ? '' : `<div class="dyerow"><span class="rk">kind-clause flow</span> ${lineage.map((n) =>
    `<span class="dye dye-${clauseStatus(n)}">${({ states: '●', carries: '◐', blind: '○' } as any)[clauseStatus(n)]} S${n}</span>`).join('<span class="pm-arrow">→</span>')}
    <span class="dim small">— ● output states the S${bindingStep} kind clause · ◐ an input carries it · ○ it never arrives</span></div>`

  // ---- node rendering ----
  const extras: Record<string, string> = {}
  if (input.additionalContext) extras.imageAdditionalContext = input.additionalContext
  const promptCol = (n: number) => {
    const p = templateOf(n)
    const a = archByN[n]
    const db = byOrder[n]
    const drift = db && p.src === 'run' && (db.systemPrompt !== p.sys || db.userPrompt !== p.usr)
    const pur = purposeOf(p.sys, p.usr)
    const outline = [...outlineOf(p.sys), ...outlineOf(p.usr)]
    const parents = parentsOf(n)
    const others = slotsOf(p.sys + '\n' + p.usr).filter((s) => !/^step\d+Output$/.test(s))
    const contractWarn = bindingStep !== undefined && n > bindingStep && (capSteps.includes(n) || matchSteps.includes(n) || n === (verdictStep ?? -1) - 0) && !parents.includes(bindingStep)
    const priors = a?.priorOutputs || {}
    // "as sent": the archived text if it is already resolved, else the template filled from priors
    const archResolved = a && !hasPh(a.systemPrompt) && !hasPh(a.userPrompt) && (a.systemPrompt || a.userPrompt)
    const sentSys = archResolved ? esc(a!.systemPrompt || '') : fillPrompt(p.sys, priors, extras)
    const sentUsr = archResolved ? esc(a!.userPrompt || '') : fillPrompt(p.usr, priors, extras)
    const stepName = (x: number) => {
      const d = (archByN[x]?.opTitle || byOrder[x]?.description || '').replace(/^S\d+ · /, '')
      return d.length > 44 ? d.slice(0, 43) + '…' : d
    }
    return `<div class="inputs-strip"><span class="rk">reads</span>
      ${parents.map((x) => `<span class="chip mono">\${step${x}Output} ⇐ S${x} · <span class="chip-name">${esc(stepName(x))}</span></span>`).join(' ')}
      ${others.map((s) => `<span class="chip mono">\${${esc(s)}}</span>`).join(' ')}
      ${a?.includeImage ? '<span class="chip">+ image</span>' : ''}
      ${contractWarn ? `<span class="chip warnchip">⚠ does not read the S${bindingStep} contract</span>` : ''}
      ${drift ? `<span class="chip warnchip" title="the DB prompt has been edited since this run">✎ DB prompt differs from this run</span>` : ''}</div>
      <div class="kv"><span class="rk">purpose</span> <span class="purptext">${esc(pur.text)}</span> <span class="dim small">(${pur.src})</span></div>
      ${pur.persona ? `<div class="kv"><span class="rk">persona</span> <span class="dim small">${esc(pur.persona)}</span></div>` : ''}
      ${outline.length ? `<div class="outline"><span class="rk">prompt outline</span> ${outline.map((o) => `<span class="chip mono">${esc(o)}</span>`).join(' ')}</div>` : ''}
      ${details(`prompt as sent${archResolved ? ' — archived verbatim' : ' — filled from priors'}`, `<div class="sc-label small">system</div><pre class="prompt">${sentSys}</pre><div class="sc-label small">user</div><pre class="prompt">${sentUsr}</pre>`)}
      ${details(`prompt template — ${p.sys.length + p.usr.length} ch`,
        `<div class="tpl-row"><div class="tpl-part tpl-part-purpose">PURPOSE</div><div class="tpl-block tpl-purpose">“${esc(pur.text)}”</div></div>
         ${pur.persona ? `<div class="tpl-row"><div class="tpl-part">PERSONA</div><div class="tpl-block tpl-text">${esc(pur.persona)}</div></div>` : ''}
         ${renderUnifiedTemplate(p.sys, p.usr, { text: pur.text, persona: pur.persona ?? null })}
         ${details('raw text (system / user)', `<pre class="prompt">${hi(p.sys)}</pre><pre class="prompt">${hi(p.usr)}</pre>`)}`)}`
  }
  const node = (n: number, extra: string, body: string, cls = '') => `<div class="tnode ${cls}">
    <div class="tn-head"><b>${esc(titleOf(n))}</b>${extra ? ' — ' + extra : ''}</div>
    ${stepFlagBanner(n)}
    <div class="tn-cols"><div class="tn-prompt"><div class="colhead">prompt</div>${promptCol(n)}</div>
    <div class="tn-out"><div class="colhead">output</div>${body}</div></div></div>`

  const CAST_ROWS = [
    { label: 'image party', key: 'image_party' }, { label: 'played by', key: 'played_by', type: 'strong' },
    { label: 'score', key: 'score', type: 'score' }, { label: 'reason', key: 'reason', type: 'reason' },
  ]
  const entryBody = (e: any, n: number) => {
    const primaryLine = typeof e.caption === 'string'
      ? `<div class="kv primary"><span class="rk">caption</span> “${esc(e.caption)}”</div>` : ''
    const led: any[] = e.element_allusions || []
    const hasEv = led.some((x) => x.evidence !== undefined)
    const scoreKeys = Object.keys(e).filter((k) => typeof e[k] === 'number')
    const reasons = Object.keys(e).filter((k) => /_reason$/.test(k) && e[k])
    const cfg = e.image_configuration || {}
    return `${primaryLine}<div class="meta-line">${scoreKeys.map((k) => pill(e[k], k)).join(' ')}</div>
      ${e.context ? `<div class="kv"><span class="rk">context</span> ${esc(e.context)}</div>` : ''}
      ${e.metaphor ? `<div class="kv"><span class="rk">metaphor</span> ${esc(e.metaphor)}</div>` : ''}
      ${reasons.length ? `<div class="kv"><span class="rk">score reasons</span></div>` + reasons.map((k) => `<div class="rline"><span class="rk">${esc(k.replace(/_reason$/, ''))}</span> ${esc(e[k])}</div>`).join('') : ''}
      ${cfg.physical_analog ? `<div class="kv"><span class="rk">physical_analog.core</span> ${esc(cfg.physical_analog.core)}</div>` : ''}
      ${cfg.cast?.length ? `<div class="kv"><span class="rk">cast</span> ${addr(`S${n}.cast`)}</div>${castGrid(cfg.cast, CAST_ROWS)}` : ''}
      ${led.length ? `<div class="kv"><span class="rk">allusion ledger</span> ${addr(`S${n}.ledger`)}</div>${castGrid(led, [
        { label: 'element', key: 'element' }, { label: 'played by', key: 'played_by', type: 'strong' },
        ...(hasEv ? [{ label: 'evidence', key: 'evidence', type: 'mono' }, { label: 'caption_span', key: 'caption_span', type: 'mono' }] : []),
        { label: 'allusion', key: 'allusion', type: 'score' }, { label: 'reason', key: 'reason', type: 'reason' },
      ])}` : ''}`
  }

  const traceFor = (row: any, i: number) => {
    const cap = row.caption
    const v = verdictOf(cap)
    const ce = capEntry(cap)
    const nodes: string[] = []
    if (gateStep !== undefined) {
      nodes.push(node(gateStep, v.kind === 'selected'
        ? `<b class="good">SELECTED</b> · slot ${(v as any).rank} · ${esc((v as any).picked_by || '')}`
        : v.kind === 'dropped' ? `<b class="bad">DROPPED</b> · ${esc((v as any).why || '')}` : '',
        genericView(P[gateStep], outputs[gateStep], outputContractOf(gateStep).primary), v.kind === 'selected' ? 'ok' : 'cut'))
    }
    if (verdictStep !== undefined)
      nodes.push(node(verdictStep, 'this caption’s row',
        `<div class="meta-line">${Object.keys(row).filter((k) => typeof row[k] === 'number' && SCORE_KEY.test(k)).map((k) => pill(row[k], k)).join(' ')}</div>`))
    const included = new Set<number>([gateStep ?? -1, verdictStep ?? -1])
    if (ce) {
      nodes.push(node(ce.n, 'the caption’s own entry', entryBody(ce.e, ce.n)))
      included.add(ce.n)
      const parents = parentsOf(ce.n)
      const mStep = parents.find((x) => matchSteps.includes(x))
      if (mStep !== undefined) {
        const matches: any[] = P[mStep].matches
        let best = matches[0]; let bestHit = -1
        for (const m of matches) {
          if (m.context === ce.e.context) { best = m; break }
          const words = new Set(String(m.context || '').toLowerCase().split(/\W+/))
          const hit = String(ce.e.context || '').toLowerCase().split(/\W+/).filter((w) => w.length > 3 && words.has(w)).length
          if (hit > bestHit) { bestHit = hit; best = m }
        }
        nodes.push(node(mStep, 'the match this caption was written from', genericView(best, null, 'context')))
        included.add(mStep)
      }
      const rStep = parents.find((x) => readSteps.includes(x)) ?? (mStep !== undefined ? parentsOf(mStep).find((x) => readSteps.includes(x)) : undefined)
      if (rStep !== undefined) { nodes.push(node(rStep, 'the lens read', genericView(P[rStep], outputs[rStep], outputContractOf(rStep).primary))); included.add(rStep) }
      // remaining ancestry, deepest first
      const queue = [...parents, ...(mStep !== undefined ? parentsOf(mStep) : []), ...(rStep !== undefined ? parentsOf(rStep) : [])]
      const anc = new Set<number>()
      while (queue.length) {
        const x = queue.shift()!
        if (anc.has(x)) continue
        anc.add(x); queue.push(...parentsOf(x))
      }
      // A brainstorm ancestor (array of situations) shows ONLY the item this
      // caption's metaphor drew from — not the whole list.
      const usedMetaphor = typeof ce.e.metaphor === 'string' ? ce.e.metaphor.trim() : null
      const focusOf = (x: number) => {
        const arr: any[] | null = Array.isArray(P[x]) ? P[x] : Array.isArray(P[x]?.situations) ? P[x].situations : null
        if (!arr || !usedMetaphor || !arr.some((s) => typeof s?.situation === 'string')) return null
        const exact = arr.find((s) => s?.situation?.trim() === usedMetaphor)
        if (exact) return exact
        const uw = new Set(usedMetaphor.toLowerCase().split(/\W+/).filter((w) => w.length > 3))
        let best: any = null; let bestHit = 2
        for (const s of arr) {
          const hit = String(s?.situation || '').toLowerCase().split(/\W+/).filter((w) => uw.has(w)).length
          if (hit > bestHit) { bestHit = hit; best = s }
        }
        return best
      }
      for (const x of [...anc].sort((a, b) => b - a)) {
        if (included.has(x)) continue
        included.add(x)
        const focus = focusOf(x)
        nodes.push(node(x,
          focus ? 'the metaphor this caption drew from' : '',
          focus ? autoGrid([focus], outputContractOf(x).primary) : genericView(P[x], outputs[x], outputContractOf(x).primary),
          x === Math.min(...anc) ? 'last' : ''))
      }
    } else {
      nodes.push('<div class="tnode warn"><div class="tn-head">caption not found in any writer step — no lineage</div></div>')
    }
    const fl = capFlags[cap] || []
    const lineage = ns.filter((x) => included.has(x))
    const railHtml = `
      ${input.imageUrl ? `<img src="${esc(input.imageUrl)}" alt="run image">` : ''}
      <div class="railcap">“${esc(cap)}”</div>
      <div class="meta-line">
        ${row.register ? `<span class="chip reg-${esc(row.register)}">${esc(row.register)}</span>` : ''}
        ${v.kind === 'selected' ? `<span class="chip good-chip">selected · slot ${(v as any).rank}</span>` : v.kind === 'dropped' ? '<span class="chip bad-chip">dropped</span>' : ''}
      </div>
      ${v.kind === 'dropped' && (v as any).why ? `<div class="railwhy">why: ${esc((v as any).why)}</div>` : ''}
      ${v.kind === 'selected' && (v as any).picked_by ? `<div class="railwhy">picked_by: ${esc((v as any).picked_by)}</div>` : ''}
      <div class="meta-line">${Object.keys(row).filter((k) => typeof row[k] === 'number' && SCORE_KEY.test(k)).map((k) => pill(row[k], k)).join(' ')}</div>
      ${fl.length ? `<div class="flagbox">${fl.map((f) => `<div class="flag f-${f.kind}">▲ ${esc(f.text)}</div>`).join('')}</div>` : ''}
      ${dyeRow(lineage)}`
    const view: TraceView = {
      idx: i,
      caption: cap,
      register: row.register ?? null,
      kind: v.kind,
      railHtml,
      // pipeline order: ground first (S1), gate last
      chainHtml: `<div class="tchain">${nodes.reverse().join('')}</div>`,
    }
    return view
  }
  const traces = vRows.map((r, i) => traceFor(r, i))

  // ---- step cards ----
  const stepsHtml = ns.map((n) => `<section class="stepcard" id="step-${n}">
    <div class="sc-head"><span class="addr big">${input.flavorId}.S${n}</span><h3>${esc(titleOf(n).replace(/^S\d+ · /, ''))}</h3>
      <span class="dim small">${esc(archByN[n].providerModelId || '')}</span> ${contractChip(n)}</div>
    ${stepFlagBanner(n)}
    <div class="tn-cols"><div class="tn-prompt"><div class="colhead">prompt</div>${promptCol(n)}</div>
    <div class="tn-out"><div class="colhead">output</div>${genericView(P[n], outputs[n], outputContractOf(n).primary)}
      ${details('raw output', `<pre class="mono small">${esc((outputs[n] || '').slice(0, 12000))}</pre>`)}</div></div>
  </section>`).join('')

  const headerHtml = `${input.imageUrl ? `<img src="${esc(input.imageUrl)}" alt="run image">` : ''}
    <div><div class="dim">${esc(input.label)}</div>
    ${input.additionalContext ? `<div class="small"><span class="rk">additional_context</span> ${esc(input.additionalContext)}</div>` : ''}</div>`

  return { headerHtml, verdictHtml, diagnosticsHtml, traces, stepsHtml, captionCount: vRows.length }
}

// the workbench stylesheet, scoped under .ops2root (both themes)
export const OPS2_CSS = `
.ops2root{--bg:#f7f6f3;--panel:#fff;--ink:#22242a;--dim:#6b6e78;--line:#e3e1da;--accent:#46608c;--accent-ink:#2f4368;--good:#2e7d4f;--good-bg:#e8f3ec;--bad:#b3423a;--bad-bg:#f9ebe9;--mid:#a07416;--mid-bg:#f7efdc;--chip-bg:#eceae4;--addr-bg:#e9edf4;--addr-ink:#3d5680;--prompt-bg:#f2f1ed;
  background:var(--bg);color:var(--ink);font-size:15px;line-height:1.55}
@media (prefers-color-scheme: dark){.ops2root{--bg:#17181c;--panel:#1f2127;--ink:#e6e4de;--dim:#9a9da8;--line:#33363e;--accent:#8ba7d4;--accent-ink:#a9c0e4;--good:#6fbf8f;--good-bg:#1d2b23;--bad:#e08a80;--bad-bg:#332220;--mid:#d1a94f;--mid-bg:#2e2817;--chip-bg:#2a2d34;--addr-bg:#252b38;--addr-ink:#9db4dc;--prompt-bg:#191b20}}
.ops2root a{color:var(--accent);text-decoration:none}.ops2root a:hover{text-decoration:underline}
.ops2root h2{font-size:19px;margin:2.2em 0 .6em;padding-bottom:6px;border-bottom:1px solid var(--line)}
.ops2root h3{font-size:16px;margin:.2em 0 .5em}
.ops2root .small{font-size:12px}.ops2root .dim{color:var(--dim)}.ops2root .mono{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
.ops2root .good{color:var(--good);font-weight:600}.ops2root .bad{color:var(--bad);font-weight:600}
.ops2root .pill{display:inline-block;font-family:ui-monospace,Menlo,monospace;font-size:11.5px;padding:1px 7px;border-radius:9px;margin:1px;white-space:nowrap}
.ops2root .sc-hi{background:var(--good-bg);color:var(--good)}.ops2root .sc-mid{background:var(--mid-bg);color:var(--mid)}.ops2root .sc-lo{background:var(--bad-bg);color:var(--bad)}.ops2root .sc-none{background:var(--chip-bg);color:var(--dim)}
.ops2root .chip{display:inline-block;font-size:11px;padding:1px 8px;border-radius:9px;background:var(--chip-bg);color:var(--dim);white-space:nowrap}
.ops2root .good-chip{background:var(--good-bg);color:var(--good)}.ops2root .bad-chip{background:var(--bad-bg);color:var(--bad)}.ops2root .warnchip{background:var(--mid-bg);color:var(--mid);font-weight:600}
.ops2root .reg-in_scene{background:#dcebe2;color:#1e6b45}.ops2root .reg-watched_scene{background:#e3e6f2;color:#3b4d8f}.ops2root .reg-internal{background:#f2e3ee;color:#8f3b78}
@media (prefers-color-scheme: dark){.ops2root .reg-in_scene{background:#20362a;color:#7fc9a0}.ops2root .reg-watched_scene{background:#242a3f;color:#9fb0e8}.ops2root .reg-internal{background:#392434;color:#d795c4}}
.ops2root .addr{font-family:ui-monospace,Menlo,monospace;font-size:11px;background:var(--addr-bg);color:var(--addr-ink);padding:1px 6px;border-radius:5px;white-space:nowrap}
.ops2root .addr.big{font-size:13px;font-weight:700;padding:2px 8px}
.ops2root table.grid{display:table;border-collapse:collapse;width:100%;font-size:13.5px;margin:4px 0}
.ops2root table.grid th,.ops2root table.grid td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
.ops2root table.grid th{background:var(--chip-bg);font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--dim)}
.ops2root .gridwrap{overflow-x:auto}
.ops2root .castgrid th.rowh{width:96px;font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:600;text-transform:none;letter-spacing:0;background:transparent;color:var(--dim);border:none;text-align:right;padding-right:10px;vertical-align:top}
.ops2root .castgrid th.rowh .rowhint{font-family:system-ui,sans-serif;font-weight:400;font-size:10px;line-height:1.35;color:var(--dim);opacity:.85;margin-top:2px}
.ops2root .castgrid th.rowh:has(.rowhint){width:180px}
.ops2root .castgrid th.colnum{background:transparent;border:none;color:var(--bad);font-family:ui-monospace,Menlo,monospace;font-size:11px;text-align:left;padding:2px 8px}
.ops2root table.grid.castgrid{width:max-content;max-width:none}
.ops2root .castgrid td{border:none;border-top:1px solid var(--line);min-width:300px;max-width:460px}
.ops2root .reason{font-size:12.5px;color:var(--dim)}
.ops2root .vboard .row-sel td{background:color-mix(in srgb,var(--good-bg) 45%,transparent)}
.ops2root .vboard th{white-space:nowrap}
.ops2root .vboard th.cap-col{width:38%}
.ops2root .vboard th.verdict-col{width:26%}
.ops2root .vboard td{font-variant-numeric:tabular-nums}
.ops2root .tracelink{font-weight:600;white-space:nowrap}
.ops2root .flag{padding:6px 10px;border-left:3px solid var(--mid);background:var(--mid-bg);margin:5px 0;font-size:13.5px;border-radius:0 6px 6px 0}
.ops2root .flag.f-mismatch,.ops2root .flag.f-cap-violation,.ops2root .flag.f-span,.ops2root .flag.f-missing,.ops2root .flag.f-unbound{border-color:var(--bad);background:var(--bad-bg)}
.ops2root .trace,.ops2root .stepcard{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:32px 0}
.ops2root .tno{display:inline-block;background:var(--accent);color:var(--bg);border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-size:12px;margin-right:4px}
.ops2root .tnode{border-left:2px solid var(--line);margin-left:10px;padding:14px 0 34px 16px;position:relative}
.ops2root .tnode:before{content:"";position:absolute;left:-5px;top:20px;width:8px;height:8px;border-radius:50%;background:var(--accent)}
.ops2root .tnode.ok:before{background:var(--good)}.ops2root .tnode.cut:before{background:var(--bad)}.ops2root .tnode.warn:before{background:var(--mid)}
.ops2root .tnode.last{border-left-color:transparent}
.ops2root .tchain .tnode:last-child{border-left-color:transparent}
.ops2root .tchain .tnode.last{border-left-color:var(--line)}
.ops2root .tn-head{font-size:13.5px;margin-bottom:3px}
.ops2root .tn-cols{display:grid;grid-template-columns:minmax(280px,2fr) 3fr;gap:16px;margin-top:4px}
@media(max-width:900px){.ops2root .tn-cols{grid-template-columns:1fr}}
.ops2root .tn-prompt{border-right:1px solid var(--line);padding-right:14px;font-size:13px;min-width:0}
@media(max-width:900px){.ops2root .tn-prompt{border-right:none;padding-right:0;border-bottom:1px solid var(--line);padding-bottom:8px}}
.ops2root .tn-out{min-width:0;overflow-x:auto}
.ops2root .colhead{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin-bottom:5px}
.ops2root .purptext{font-size:12.5px}
.ops2root .kv{margin:3px 0;font-size:13.5px}
.ops2root .kv.primary{font-weight:650;font-size:14.5px}
.ops2root .castgrid tr.primary td{font-weight:650;font-size:14.5px}
.ops2root .castgrid tr.primary th.rowh{color:var(--accent-ink);font-weight:700}
.ops2root .rk{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--dim);background:var(--chip-bg);padding:0 5px;border-radius:4px;margin-right:4px}
.ops2root .rline{margin:3px 0;font-size:12.5px;color:var(--dim)}
.ops2root .meta-line{margin:4px 0}
.ops2root .sc-head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.ops2root .sc-head h3{margin:0}
.ops2root .sc-label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--dim);margin-bottom:4px}
.ops2root pre.prompt{background:var(--prompt-bg);border:1px solid var(--line);border-radius:6px;padding:10px;font-size:12px;line-height:1.45;overflow-x:auto;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace}
.ops2root .ph{background:var(--addr-bg);color:var(--addr-ink);border-radius:3px;padding:0 2px;font-weight:600}
.ops2root .filled{display:block;background:var(--addr-bg);border-left:3px solid var(--accent);border-radius:0 6px 6px 0;padding:4px 8px;margin:4px 0;white-space:pre-wrap}
.ops2root .filled-tag{display:block;font-size:10.5px;font-weight:700;color:var(--accent-ink);letter-spacing:.03em;margin-bottom:2px;font-family:ui-monospace,Menlo,monospace}
.ops2root pre.mono{overflow-x:auto;background:var(--prompt-bg);padding:8px;border-radius:6px;white-space:pre-wrap}
.ops2root details{margin:6px 0}
.ops2root details summary{cursor:pointer;font-size:13px;color:var(--accent)}
.ops2root .dbody{margin:6px 0 4px;overflow-x:auto}
.ops2root .inputs-strip{margin:2px 0 6px;font-size:12px;display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.ops2root .inputs-strip .chip-name{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;font-style:italic;color:var(--ink)}
.ops2root .outline{margin:5px 0}.ops2root .outline .chip{margin:1px}
.ops2root .tpl-banner{border-left:3px solid var(--accent);background:var(--prompt-bg);border-radius:0 8px 8px 0;padding:8px 12px;margin:6px 0;font-size:13.5px}
.ops2root .tpl-banner-label{font-size:10.5px;font-weight:700;letter-spacing:.06em;color:var(--accent-ink);margin-bottom:3px}
.ops2root .tpl-persona{font-size:12px;color:var(--dim);margin-top:4px}
.ops2root .tpl-row{display:grid;grid-template-columns:86px minmax(0,1fr);gap:10px;margin:7px 0;border-top:1px dashed var(--line);padding-top:6px}
.ops2root .tpl-row:first-of-type{border-top:none;padding-top:0}
.ops2root .tpl-part{font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:700;letter-spacing:.05em;color:var(--dim);text-align:right;padding-top:3px}
.ops2root .tpl-part-purpose{color:var(--accent-ink)}
.ops2root .tpl-purpose{font-size:12.5px}
.ops2root .tpl-part-input{color:#77522c}
.ops2root .tpl-part-output{color:#38617e}
.ops2root .tpl-part-checklist{color:var(--bad)}
.ops2root .tpl-part-procedure{color:#5c4482}
.ops2root .tpl-part-ratings{color:#6d6a2a}
.ops2root .tpl-block{min-width:0}
.ops2root .tpl-title{font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--accent-ink);margin-bottom:4px}
.ops2root .tpl-mech{background:var(--addr-bg);color:var(--addr-ink);font-size:10px;padding:1px 6px;border-radius:5px;margin-left:6px}
.ops2root .tpl-text{font-size:12.5px;white-space:pre-wrap;margin:3px 0}
.ops2root .tpl-text.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;background:var(--prompt-bg);border:1px solid var(--line);border-radius:6px;padding:8px}
.ops2root .tpl-wrong,.ops2root .tpl-right{font-size:12.5px;white-space:pre-wrap;border-radius:6px;padding:6px 9px;margin:4px 0}
.ops2root .tpl-wrong{background:var(--bad-bg)}
.ops2root .tpl-right{background:var(--good-bg)}
.ops2root .tpl-tag{display:block;font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:700;letter-spacing:.06em;margin-bottom:2px}
.ops2root .tpl-wrong .tpl-tag{color:var(--bad)}
.ops2root .tpl-right .tpl-tag{color:var(--good)}
.ops2root .tpl-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media(max-width:1100px){.ops2root .tpl-pair{grid-template-columns:1fr}}
.ops2root .tpl-check{font-size:12.5px;background:var(--chip-bg);border-radius:6px;padding:4px 9px;margin:3px 0}
.ops2root .tpl-li{margin:5px 0}
.ops2root .tpl-li+.tpl-li{border-top:1px dotted var(--line);padding-top:5px}
.ops2root .dyerow{display:flex;gap:4px;align-items:center;flex-wrap:wrap;font-size:12.5px;margin:8px 0;padding:7px 10px;background:var(--prompt-bg);border-radius:8px}
.ops2root .dye{font-family:ui-monospace,Menlo,monospace;font-size:12px;padding:1px 6px;border-radius:6px;white-space:nowrap}
.ops2root .dye-states{background:var(--good-bg);color:var(--good)}.ops2root .dye-carries{background:var(--addr-bg);color:var(--addr-ink)}.ops2root .dye-blind{background:var(--bad-bg);color:var(--bad)}
.ops2root .pm-arrow{color:var(--dim)}
.ops2root .flagbox{margin:6px 0}
.ops2root .prose{font-size:13.5px;white-space:pre-wrap}
.ops2root header.wb{display:flex;gap:20px;align-items:flex-start;padding:10px 0;flex-wrap:wrap}
.ops2root header.wb img{width:200px;border-radius:8px;border:1px solid var(--line)}
.ops2root .capstrip{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.ops2root .capbtn{display:flex;align-items:center;gap:5px;font-size:13px;padding:4px 9px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer}
.ops2root .capbtn[data-active="true"]{border-color:var(--accent);box-shadow:inset 0 -3px 0 var(--accent)}
.ops2root .capbtn .tno{flex:none}
.ops2root .capbtn[data-kind="dropped"] .tno{background:var(--bad)}
.ops2root .capbtn .mark{font-weight:700}
.ops2root .tracepage{display:grid;grid-template-columns:250px minmax(0,1fr);gap:18px;margin:10px 0}
@media(max-width:900px){.ops2root .tracepage{grid-template-columns:1fr}}
.ops2root .tracerail{position:sticky;top:52px;align-self:start;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;max-height:calc(100vh - 70px);overflow-y:auto}
.ops2root .tracerail img{width:100%;border-radius:8px;border:1px solid var(--line)}
.ops2root .railcap{font-weight:600;font-size:14px;margin:8px 0 4px}
.ops2root .railwhy{font-size:12.5px;color:var(--dim);margin:2px 0}
.ops2root .tracerail .dyerow{padding:5px 8px;font-size:11.5px}
.ops2root .tracerail .flag{font-size:12px}
`
