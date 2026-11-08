// The "ChatGPT step", automated: given the latest batch results, propose ONE
// minimal edit operation to the Recognize-content prompt amendment (or to the
// pinned recognize JSON). The anti-overfit rules are enforced MECHANICALLY
// here — n-gram overlap with batch captions, growth caps, list-field guards —
// not merely stated in the meta-prompt. Two repair retries, then the round is
// skipped.
import { callOpenAI, parseJsonLoose } from './lib.mjs'

// ---- caps (stated in the rules AND enforced in code — keep them in sync) ----
const WORD_CAP = 120 // total amendment length, prompt mode
const OP_WORD_CAP = 40 // new words allowed per round, prompt mode
const JSON_GROWTH_CAP = 2500 // chars the JSON may grow per round
const JSON_TOTAL_CAP = 10000 // absolute JSON size ceiling
const JSON_VALUE_CAP = 3000 // serialized chars for a single set value
const JSON_OPS_CAP = 4 // coupled operations allowed per round (one hypothesis)
const NGRAM = 5 // copying this many consecutive caption words = reject

const truncate = (s, n) => {
  const str = String(s ?? '')
  return str.length > n ? `${str.slice(0, n)}…` : str
}

export const countWords = (s) => {
  const t = String(s ?? '').trim()
  return t ? t.split(/\s+/).length : 0
}

// ---- mechanical validators (shared by automated mode and chat warnings) ----

const normWords = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

// Does `text` contain any run of NGRAM consecutive words copied from a batch
// caption? Returns the copied run, or null. This is the machine check behind
// "never copy examples from the results".
export const findCopiedRun = (text, captions, n = NGRAM) => {
  const hay = ` ${normWords(text).join(' ')} `
  for (const cap of captions ?? []) {
    const words = normWords(cap)
    for (let i = 0; i + n <= words.length; i += 1) {
      const run = words.slice(i, i + n).join(' ')
      if (hay.includes(` ${run} `)) return run
    }
  }
  return null
}

// First field anywhere in the object whose KEY names topics → its path.
// Topic steering belongs to the community-context step, never the recognize
// JSON — this was the failure behind the old "preferred_topics" menu.
const findTopicsField = (value, path = '') => {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findTopicsField(value[i], `${path}[${i}]`)
      if (hit) return hit
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k
      if (/topics?/i.test(k)) return p
      const hit = findTopicsField(v, p)
      if (hit) return hit
    }
  }
  return null
}

// Everything wrong with a proposed full text vs the current one. Hard
// rejections in automated mode; shown as warnings next to the Apply button in
// chat mode. `captions` are the latest batch's generated captions.
export const proposalWarnings = ({ current, proposal, captions, jsonMode }) => {
  const warnings = []
  if (!proposal || !String(proposal).trim()) return ['the proposal is empty']
  if (/columbia|barnard/i.test(proposal) || /\bCU\b/.test(proposal)) {
    warnings.push('mentions Columbia/Barnard/CU — the recognize step must stay community-agnostic')
  }
  const run = findCopiedRun(proposal, captions)
  if (run) {
    warnings.push(`copies a phrase from this batch's captions ("…${run}…") — that is overfitting; state the structural rule instead`)
  }
  if (jsonMode) {
    const parsed = parseJsonLoose(proposal)
    if (!parsed || typeof parsed !== 'object') {
      warnings.push('the proposal is not valid JSON')
      return warnings
    }
    const growth = String(proposal).length - String(current ?? '').length
    if (growth > JSON_GROWTH_CAP) {
      warnings.push(`grows the JSON by ${growth} chars (cap +${JSON_GROWTH_CAP} per round) — build richness over rounds, each earning its keep`)
    }
    if (String(proposal).length > JSON_TOTAL_CAP) {
      warnings.push(`the JSON is ${String(proposal).length} chars (cap ${JSON_TOTAL_CAP}) — tighten or delete before adding`)
    }
    const topicsField = findTopicsField(parsed)
    if (topicsField) {
      warnings.push(`field "${topicsField}" steers topics — topics come from the community-context step, never this JSON; demonstrate the FORM with generic examples instead`)
    }
  } else {
    const words = countWords(proposal)
    if (words > WORD_CAP) warnings.push(`amendment is ${words} words — over the ${WORD_CAP}-word cap`)
    const growth = words - countWords(current)
    if (growth > OP_WORD_CAP) {
      warnings.push(`adds ${growth} words in one round (cap +${OP_WORD_CAP}) — one small change at a time`)
    }
  }
  return warnings
}

// ---- edit operations: the improver outputs ONE op, code applies it ----

// Applies the improver's operation(s) to the current text and returns
// { result } or { error }. The op format makes broad rewrites structurally
// impossible: there is no way to express "replace everything". In JSON mode
// `op` may be an array of up to JSON_OPS_CAP coupled operations — one
// hypothesis sometimes spans a rule field AND the examples that demonstrate
// it, and those must move together or the examples go stale.
export const applyOperation = (current, op, jsonMode) => {
  if (!op || typeof op !== 'object') return { error: 'no operation object in the response' }

  if (jsonMode) {
    const ops = Array.isArray(op) ? op : [op]
    if (!ops.length) return { error: 'the operations list is empty' }
    if (ops.length > JSON_OPS_CAP) {
      return { error: `${ops.length} operations — at most ${JSON_OPS_CAP} coupled operations (serving ONE hypothesis) per round` }
    }
    const obj = parseJsonLoose(current)
    if (!obj || typeof obj !== 'object') return { error: 'the current pinned JSON failed to parse' }
    for (const one of ops) {
      if (!one || typeof one !== 'object') return { error: 'an operation entry is not an object' }
      const type = String(one.type ?? '').toLowerCase()
      const field = String(one.field ?? '').trim()
      if (!field) return { error: 'operation.field is missing' }
      const path = field.split('.')
      let parent = obj
      for (const key of path.slice(0, -1)) {
        if (!parent[key] || typeof parent[key] !== 'object') {
          return { error: `field path "${field}" does not exist in the current JSON` }
        }
        parent = parent[key]
      }
      const leaf = path[path.length - 1]
      if (type === 'set') {
        if (one.value === undefined) return { error: `set operation for "${field}" has no value` }
        if (JSON.stringify(one.value).length > JSON_VALUE_CAP) {
          return { error: `the value for "${field}" is over ${JSON_VALUE_CAP} chars — split it or tighten it` }
        }
        parent[leaf] = one.value
      } else if (type === 'delete') {
        if (!(leaf in parent)) return { error: `field "${field}" does not exist, so it cannot be deleted` }
        delete parent[leaf]
      } else {
        return { error: `unknown operation type "${one.type}" (json mode allows: set, delete)` }
      }
    }
    return { result: JSON.stringify(obj, null, 2) }
  }

  const type = String(op.type ?? '').toLowerCase()
  // prompt mode: the amendment is a short text block
  const cur = String(current ?? '').trim()
  const oldText = String(op.old_text ?? '').trim()
  const newText = String(op.new_text ?? '').trim()
  if (type === 'add') {
    if (!newText) return { error: 'add operation has no new_text' }
    if (countWords(newText) > OP_WORD_CAP) {
      return { error: `new_text is ${countWords(newText)} words — over the ${OP_WORD_CAP}-word per-round cap` }
    }
    return { result: cur ? `${cur}\n${newText}` : newText }
  }
  if (!cur) return { error: 'the amendment is empty (baseline) — only an add operation is possible' }
  if (!oldText) return { error: `${type} operation has no old_text` }
  const count = cur.split(oldText).length - 1
  if (count === 0) return { error: `old_text was not found in the current amendment — quote it EXACTLY as it appears` }
  if (count > 1) return { error: 'old_text appears more than once — quote a longer, unique span' }
  if (type === 'edit') {
    if (!newText) return { error: 'edit operation has no new_text' }
    if (countWords(newText) > OP_WORD_CAP) {
      return { error: `new_text is ${countWords(newText)} words — over the ${OP_WORD_CAP}-word per-round cap` }
    }
    return { result: cur.replace(oldText, newText) }
  }
  if (type === 'delete') {
    return { result: cur.replace(oldText, '').replace(/\n{3,}/g, '\n\n').trim() }
  }
  return { error: `unknown operation type "${op.type}" (prompt mode allows: add, edit, delete)` }
}

// ---- rules (one source of truth; no rule may contradict another) ----

const CORE_RULES_PROMPT =
  'HARD RULES — every one of these is checked by code and violations are auto-rejected:\n' +
  `1. ONE change per round: add one short rule, tighten one existing line, or delete one. ` +
  'Prefer edit/delete over add — growing the prompt is a cost, not a virtue.\n' +
  `2. Length: the whole amendment stays under ${WORD_CAP} words; your new text under ${OP_WORD_CAP} words.\n` +
  '3. GENERAL — the change must help UNSEEN memes:\n' +
  '   - never mention Columbia, Barnard, CU, or any community-specific content;\n' +
  `   - never copy or paraphrase captions from the results (${NGRAM} consecutive shared words = auto-reject);\n` +
  '   - never hardcode a specific meme/template from this batch.\n' +
  '4. Only fix failures that trace back to RECOGNITION: wrong/vague template_name, mushy ' +
  'how_a_caption_should_use_it, snowclones not spelled out as fill-in-the-blank patterns, wrong ' +
  'image_is_punchline calls, inconsistent is_meme verdicts. Downstream steps are fixed.\n' +
  '5. Encode the STRUCTURAL pattern of a failure ("vary sentence openings; do not reuse one ' +
  'syntactic frame"), never a blocklist of the literal offending strings.\n' +
  '6. Write rules that STICK: a concrete test the model can run (not an adjective), plus a ' +
  'wrong/right example pair when one fits in the word budget. Prose-only guidance drifts.'

const CORE_RULES_JSON =
  'HARD RULES — every one of these is checked by code and violations are auto-rejected:\n' +
  `1. ONE HYPOTHESIS per round, expressed as up to ${JSON_OPS_CAP} coupled operations. Rules and ` +
  'the examples that demonstrate them are ONE unit: whenever you change a rule field, regenerate ' +
  'the example/pattern fields in the same round so every example demonstrates the current rules — ' +
  'stale examples that contradict a rule are worse than no examples, because caption writers ' +
  'imitate examples over rules. But NEVER install the full reference shape at once: add a field ' +
  'only when an observed failure or user critique demands exactly that field. Richness is EARNED ' +
  'over rounds — an unattributable change is an untestable change.\n' +
  '2. The JSON describes the MEME TEMPLATE, nothing else:\n' +
  '   - never mention Columbia, Barnard, CU, or any community-specific content (community ' +
  'grounding is a later pipeline step’s job);\n' +
  `   - never copy or paraphrase the generated captions from the results (${NGRAM} consecutive ` +
  'shared words = auto-reject);\n' +
  '   - never a topics field: topics come from the community-context step (any field steering ' +
  'topics = auto-reject).\n' +
  '3. Richness in FORM is encouraged; richness in CONTENT is banned. The fields that make a ' +
  'great template JSON: a one-line "caption_rule" COMPLETION TEST the writer can self-check ' +
  'against ("a good caption completes: \'…\'"); "good_setups" as fill-in-the-blank syntactic ' +
  'frames ("X after getting caught…"); "avoid_patterns" as syntactic anti-frames ("X ' +
  'explaining…"), never literal captions; "do_not_match" negative conditions; "matching_requirements"; ' +
  'and "example_captions" categorized by GENERIC domain (work, school, tech, pets, relationships, ' +
  'organizations, absurd) that all demonstrate the same form — breadth across domains is what ' +
  'keeps examples illustrative instead of a menu.\n' +
  '4. Diagnose before prescribing: trace each recurring caption failure to what the current JSON ' +
  'told (or failed to tell) the caption writer, then encode the structural rule behind it — ' +
  'e.g. if captions keep producing generic "explaining" instead of the required "apology after ' +
  'wrongdoing", state the required element and forbid the near-miss as an anti-frame.\n' +
  '5. Encode feedback as the structural rule, never the literal instances.\n' +
  '6. Write rules that STICK: a concrete test the caption writer can run (a completion test, a ' +
  'could-the-poster-be-this-person test), plus a wrong/right example pair — prose-only guidance ' +
  'drifts, and vivid schema placeholders get copied as answers.\n' +
  `7. Budget: the JSON may grow at most ${JSON_GROWTH_CAP} chars per round and ${JSON_TOTAL_CAP} ` +
  'total — richness must earn its keep round by round.'

// Guidance for turning the user's feedback into the right kind of change —
// the classification step that prevents "everything becomes more prompt text".
const TRIAGE_RULES =
  'TRIAGE the user’s feedback BEFORE proposing anything. Classify it as one of:\n' +
  '- ONE-OFF: a single bad caption that the current instructions would usually avoid (sampling ' +
  'luck). Say so and recommend a rerun — do NOT propose a revision.\n' +
  '- STRUCTURAL: a recurring pattern. Propose the minimal revision that encodes the structural ' +
  'rule behind the feedback.\n' +
  '- LOOP CONSTRAINT: guidance about how you should revise (e.g. "stop adding examples", "only ' +
  'fix X"). Acknowledge it and honor it in every future proposal — it does NOT go into the ' +
  'prompt/JSON text itself.\n' +
  'State your classification in one line before the rest of your reply.'

// System prompt for the interactive CHAT mode — modeled on how the user works
// with ChatGPT: diagnose the captions against the current instructions, explain
// why the failure happens, be direct and prescriptive. The live pipeline
// context is appended by the server on every turn.
export function buildChatSystemPrompt({ mode, baseSystem, baseUser, currentAmendment, latestRound, history, pastFeedback }) {
  const jsonMode = mode === 'json'
  const lines = []
  lines.push(
    'You are an expert meme-prompt engineer helping the user tune a meme-captioning pipeline. ' +
      'Work the way a great collaborator does in chat: DIAGNOSE first (trace each bad caption to ' +
      'what the current instructions said or failed to say), EXPLAIN why the model produced it, ' +
      'then be prescriptive. Be direct and opinionated; disagree with the user when they are wrong. ' +
      'Answer questions conversationally — not every reply needs a proposal.'
  )
  lines.push(
    '\nPIPELINE: ' +
      (jsonMode
        ? 'a PINNED recognize-content JSON (the artifact you and the user are revising; no recognition model runs)'
        : 'a recognize step whose prompt ends with an amendment (the text you and the user are revising)') +
      ' -> find community moments -> write 3 meme captions -> an LLM judge scores each 0-1 on ' +
      'meme_format_alignment. The judge is a proxy; THE USER is the real judge.'
  )
  lines.push('\n' + TRIAGE_RULES)
  lines.push(
    '\nWHEN YOU PROPOSE A REVISION: output the COMPLETE replacement ' +
      (jsonMode ? 'JSON object' : 'amendment text') +
      ' in exactly ONE fenced code block (```' + (jsonMode ? 'json' : '') + ' ... ```) so the tool ' +
      'can offer the user an Apply button. Partial snippets cannot be applied — but the ' +
      'replacement must differ from the current version by ONE hypothesis only. When the user\'s ' +
      'critique raises SEVERAL distinct problems, do NOT fix them all in one proposal: pick the ' +
      'highest-impact one, propose its minimal fix, and list the others under "NEXT UP:" — you ' +
      'will address them one per cycle after each round runs. One hypothesis per applied round is ' +
      'what lets the user attribute a result to a change; a proposal that fixes everything at ' +
      'once is untestable and will be rejected by the user.\n' +
      'Directly ABOVE the fenced block, always write:\n' +
      'HYPOTHESIS: <one sentence: what failure this targets and why this change should fix it>\n' +
      'CHANGES: <one line per touched field: which part of the user\'s critique it addresses>\n' +
      '(The user reads your proposal as a diff, and the same validators that gate the automated ' +
      'loop will flag oversized growth, copied captions, topic fields, and community mentions ' +
      'next to the Apply button.) Broad rewrites only when the user explicitly asks.\n' +
      (jsonMode ? CORE_RULES_JSON : CORE_RULES_PROMPT)
  )
  if (!jsonMode) {
    lines.push('\n=== FIXED BASE PROMPT (system) ===\n' + baseSystem)
    lines.push('\n=== FIXED BASE PROMPT (user) ===\n' + baseUser)
  }
  lines.push(
    (jsonMode ? '\n=== CURRENT PINNED RECOGNIZE JSON ===\n' : '\n=== CURRENT AMENDMENT ===\n') +
      (currentAmendment || '(none yet — baseline)')
  )
  lines.push('\n=== LATEST ROUND RESULTS (auto-included; the user is looking at these) ===')
  for (const img of latestRound.perImage) {
    lines.push(`--- image ${img.imageId} ---`)
    if (img.error) {
      lines.push(`PIPELINE ERROR: ${img.error}`)
      continue
    }
    if (!jsonMode) lines.push('meme verdict: ' + truncate(JSON.stringify(img.meme ?? null), 900))
    for (const b of img.branches ?? []) {
      if (!b || b.error) continue
      lines.push(
        `caption ${b.index + 1}: ${JSON.stringify(String(b.caption ?? ''))} | judge score ${b.score ?? '?'}\n` +
          `  required_setup: ${truncate(b.requiredSetup, 200)} | present: ${b.requiredSetupPresent}\n` +
          `  judge reason: ${truncate(b.alignReason, 300)}`
      )
    }
  }
  if (pastFeedback?.length) {
    lines.push(
      '\n=== THE USER\'S STANDING GUIDANCE (from earlier rounds — keep honoring it) ===\n' +
        pastFeedback.map((f) => `- ${f.critique}`).join('\n')
    )
  }
  if (history?.length > 1) {
    lines.push(
      '\n=== SCORE HISTORY ===\n' +
        history
          .map((r) => `round ${r.index}: train mean ${r.scores?.train?.meanAll?.toFixed?.(3) ?? '—'} ${r.accepted ? '(adopted)' : '(not adopted)'}`)
          .join('\n')
    )
  }
  return lines.join('\n')
}

const IMPROVER_SYSTEM =
  'You are a careful prompt engineer optimizing ONE step ("Recognize content") of a ' +
  'meme-captioning pipeline. You only respond in strict JSON.'

export function buildImproverPrompt({
  mode,
  baseSystem,
  baseUser,
  currentAmendment,
  latestRound,
  history,
  holdoutIds,
  userCritique,
  pastFeedback,
  rejectedDrafts,
}) {
  const jsonMode = mode === 'json'
  const lines = []
  lines.push(
    jsonMode
      ? 'PIPELINE: a PINNED recognize-content JSON (the thing you revise — no recognition model runs) ' +
          '-> find community moments -> write 3 meme captions -> an LLM judge scores each caption 0-1 on ' +
          'meme_format_alignment (does the caption fit the template\'s required format/setup?). Higher is better.'
      : 'PIPELINE: recognize (the step you tune) -> find community moments -> write 3 meme captions ' +
          '-> an LLM judge scores each caption 0-1 on meme_format_alignment (does the caption fit the ' +
          "template's required format/snowclone/setup?). Higher is better."
  )
  if (!jsonMode) {
    lines.push('\n=== FIXED BASE PROMPT (system) ===\n' + baseSystem)
    lines.push('\n=== FIXED BASE PROMPT (user, incl. meme-verdict instructions) ===\n' + baseUser)
  }
  lines.push(
    (jsonMode
      ? '\n=== CURRENT PINNED RECOGNIZE JSON (your operation edits this in place) ===\n'
      : '\n=== CURRENT AMENDMENT (your operation edits this in place) ===\n') +
      (currentAmendment ? currentAmendment : '(none yet — baseline, so your operation must be an add)')
  )

  lines.push('\n=== LATEST RESULTS (with the current version) ===')
  for (const img of latestRound.perImage) {
    const tag = holdoutIds.has(img.imageId) ? ' [HOLDOUT — do not tune to these]' : ''
    lines.push(`\n--- image ${img.imageId}${tag} ---`)
    if (img.error) {
      lines.push(`PIPELINE ERROR: ${img.error}`)
      continue
    }
    lines.push('meme verdict: ' + truncate(JSON.stringify(img.meme ?? null), 700))
    for (const b of img.branches ?? []) {
      if (b.error) {
        lines.push(`  caption ${b.index + 1}: ERROR ${truncate(b.error, 200)}`)
        continue
      }
      const low = Number.isFinite(b.score) && b.score < 0.8 ? '  <-- LOW' : ''
      lines.push(
        `  caption ${b.index + 1}: ${JSON.stringify(truncate(b.caption, 120))} | score ${b.score ?? '?'}${low}\n` +
          `    required_setup: ${truncate(b.requiredSetup, 160)} | present: ${b.requiredSetupPresent}\n` +
          `    judge reason: ${truncate(b.alignReason, 240)}`
      )
    }
  }

  if (userCritique) {
    lines.push(
      '\n=== THE USER\'S CRITIQUE OF THE LATEST JOKES (HIGHEST PRIORITY) ===\n' +
        'The user is the real judge — the scores above are only a proxy. Address this critique ' +
        'directly, even where it goes beyond what the judge penalized:\n' +
        userCritique
    )
  }
  if (pastFeedback?.length) {
    lines.push(
      '\n=== THE USER\'S EARLIER CRITIQUES (standing guidance — keep honoring these) ===\n' +
        pastFeedback.map((f) => `- (before round ${f.round}) ${f.critique}`).join('\n')
    )
  }
  if (rejectedDrafts?.length) {
    lines.push(
      '\n=== YOUR DRAFTS THE USER DID NOT APPROVE THIS CYCLE (with their response) ===\n' +
        rejectedDrafts
          .map((d) => `DRAFT:\n${d.amendment}\nUSER RESPONSE: ${d.critique}`)
          .join('\n---\n')
    )
  }

  lines.push('\n=== HYPOTHESIS LEDGER (already tested — do not re-test a failed hypothesis) ===')
  for (const r of history) {
    const size = jsonMode
      ? `${String(r.amendment ?? '').length} chars`
      : `${countWords(r.amendment)} words`
    const verdict = r.accepted ? 'ACCEPTED' : r.index === 0 ? 'BASELINE' : 'REJECTED'
    lines.push(
      `round ${r.index} [${verdict}] train=${fmt(r.scores?.train?.meanAll)} holdout=${fmt(r.scores?.holdout?.meanAll)} · ${size}` +
        (r.hypothesis ? `\n  hypothesis: ${truncate(r.hypothesis, 240)}` : '') +
        (r.whatChanged ? `\n  change: ${truncate(r.whatChanged, 200)}` : '')
    )
  }

  const opSchema = jsonMode
    ? '  "operations": [ // 1-' + JSON_OPS_CAP + ' coupled operations, ALL serving the one hypothesis above\n' +
      '    {\n' +
      '      "type": "set" | "delete",\n' +
      '      "field": "<field name, dot-path for nested (e.g. \\"meme.how_a_caption_should_use_it\\")>",\n' +
      '      "value": <for set: the new value for that field>\n' +
      '    }\n' +
      '  ],\n'
    : '  "operation": {\n' +
      '    "type": "add" | "edit" | "delete",\n' +
      '    "old_text": "<for edit/delete: the text to change, quoted EXACTLY as it appears in the current amendment>",\n' +
      `    "new_text": "<for add/edit: the new text, under ${OP_WORD_CAP} words>"\n` +
      '  },\n'

  lines.push(
    '\n=== YOUR TASK ===\n' +
      'Diagnose the recurring failure pattern in the LOW-scoring captions that traces back to ' +
      (jsonMode ? 'the pinned recognize JSON' : 'the recognition output') +
      ', pick the ONE hypothesis most likely to fix it, and express it as ' +
      (jsonMode
        ? `1-${JSON_OPS_CAP} coupled field operations (a rule change and its regenerated examples move together). `
        : 'a single edit operation. ') +
      'The code applies your operations to the current version — you cannot rewrite it wholesale.\n\n' +
      (jsonMode ? CORE_RULES_JSON : CORE_RULES_PROMPT) +
      '\n\nOutput ONLY strict JSON:\n' +
      '{\n' +
      '  "analysis": "<2-4 sentences: the failure patterns you found and their root cause>",\n' +
      '  "hypothesis": "<ONE sentence: captions fail because X; this change should fix it by Y>",\n' +
      opSchema +
      '  "what_changed": "<1-2 sentences: what the operation does and why it should generalize>"\n' +
      '}'
  )
  return lines.join('\n')
}

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(3) : '—')

// Returns { analysis, hypothesis, operation, amendment, what_changed, raw, model }
// or null on failure. `amendment` is the full text AFTER applying the operation
// (in json mode: the revised recognize-content JSON as a string).
export async function proposeAmendment({ apiKey, model, fallbackModel, promptInputs, log }) {
  const jsonMode = promptInputs.mode === 'json'
  const current = promptInputs.currentAmendment ?? ''
  const captions = (promptInputs.latestRound?.perImage ?? [])
    .flatMap((img) => (img.branches ?? []).map((b) => String(b?.caption ?? '')))
    .filter(Boolean)
  const userPrompt = buildImproverPrompt(promptInputs)

  const callOnce = async (m, extra) =>
    callOpenAI({
      apiKey,
      model: m,
      systemPrompt: IMPROVER_SYSTEM,
      userPrompt: extra ? userPrompt + '\n\n' + extra : userPrompt,
      temperature: 0.7,
      maxTokens: 8000,
    })

  const attemptOnce = (raw) => {
    const parsed = parseJsonLoose(raw)
    if (!parsed || typeof parsed !== 'object') return { problem: 'the response was not parseable JSON' }
    const op = parsed.operations ?? parsed.operation
    const applied = applyOperation(current, op, jsonMode)
    if (applied.error) return { parsed, problem: applied.error }
    const warnings = proposalWarnings({ current, proposal: applied.result, captions, jsonMode })
    if (warnings.length) return { parsed, problem: warnings.join('; ') }
    return { parsed, amendment: applied.result }
  }

  let usedModel = model
  let raw
  try {
    raw = await callOnce(model)
  } catch (err) {
    if (fallbackModel && fallbackModel !== model) {
      log(`  improver model ${model} failed (${err?.message}); falling back to ${fallbackModel}`)
      usedModel = fallbackModel
      raw = await callOnce(fallbackModel)
    } else {
      throw err
    }
  }

  let attempt = attemptOnce(raw)
  for (let repair = 0; repair < 2 && attempt.problem; repair += 1) {
    log(`  improver output rejected (${attempt.problem}); asking for a repair`)
    raw = await callOnce(
      usedModel,
      `YOUR PREVIOUS ATTEMPT WAS REJECTED: ${attempt.problem}. ` +
        'Produce a corrected JSON response — one operation that follows every hard rule.'
    )
    attempt = attemptOnce(raw)
  }
  if (attempt.problem || !attempt.amendment) {
    log(`  improver failed to produce a valid operation (${attempt.problem ?? 'no result'}) — skipping round`)
    return null
  }
  const parsed = attempt.parsed
  return {
    analysis: String(parsed.analysis ?? ''),
    hypothesis: String(parsed.hypothesis ?? ''),
    operation: parsed.operations ?? parsed.operation,
    amendment: attempt.amendment,
    what_changed: String(parsed.what_changed ?? ''),
    raw,
    model: usedModel,
  }
}
