#!/usr/bin/env node
// Mechanical validator for the EDGE-SCORED caption card (flavor 1544 S13, and
// any caption step ported to the same schema).
//
// Every score on a caption card is a match between two named artifacts. The
// model will happily rationalize a 1 by leaning on an artifact the viewer
// never sees (the context, the element_map) or on the figure itself ("that
// collapsed posture is unmistakably her self respect" — the pose supplies no
// NAME). Prose rules drift; these checks don't:
//
//   1. cast[].caption_span must be a literal substring of the caption
//      (an "…"-elided span whose fragments all appear in order is a citation-
//      FORMAT slip, not an evidence failure — it is repaired to its longest
//      verbatim run and reported as a repair, not a violation)
//   2. empty caption_span + score > 0            → the figure has no name
//   3. allusion evidence "caption" needs a real span
//   4. allusion evidence "neither" + allusion > 0
//   5. allusion evidence "image" on a played_by that is ALSO a cast figure
//      → circular: naming a figure is the caption's job
//   6. physical_fit > min(analog_to_image, analog_to_caption)
//   7. physical_fit > weakest cast score
//   8. allusion > role_fit + 0.2 — the element_map score from the step upstream,
//      carried onto the row by edges-report.mjs. The allusion score only asks
//      whether the caption NAMES the party in the slot; role_fit asks whether
//      that party actually FILLS it. Naming a party that was cast backwards is
//      not recovery, so the row is bounded by the fit. (Skipped when the row
//      carries no role_fit — running this file on raw step output still works.)
//
//   node scripts/context-recovery-harness/validate-edges.mjs card.json
//   node scripts/context-recovery-harness/validate-edges.mjs --self-test
//   cat s13-output.json | node scripts/context-recovery-harness/validate-edges.mjs
import fs from 'node:fs'

// Loose text match: casing, smart quotes and possessive/plural tails vary
// between how the caption says it and how played_by names it.
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// exported so the report page colours a span exactly the way this file judges
// it — a green chip on the page and a violation in the CLI would be a lie
export const isSpanOf = (span, caption) => {
  const s = norm(span)
  return s.length > 0 && norm(caption).includes(s)
}

// The one citation-format failure the model keeps making even with the
// contiguous-run rule in the prompt (verified live 2026-07-31: rule in the S13
// prompt at 13:59, elided spans in the 14:00 response anyway): it stitches two
// verbatim runs with "..." to skip the middle of the caption. The EVIDENCE is
// fine — only the citation format is wrong — so repair it mechanically: if
// every fragment appears in the caption, in order, substitute the longest
// fragment (verbatim by construction). Anything else stays a violation.
export const repairSpan = (span, caption) => {
  const frags = String(span ?? '').split(/\.{3}|…/).map((s) => s.trim()).filter((s) => norm(s).length > 0)
  if (frags.length < 2) return null
  const cap = norm(caption)
  let at = 0
  for (const f of frags) {
    const i = cap.indexOf(norm(f), at)
    if (i < 0) return null
    at = i + norm(f).length
  }
  return frags.reduce((a, b) => (norm(b).length > norm(a).length ? b : a))
}

const num = (v) => (typeof v === 'number' ? v : null)

// How far the naming score may sit above the upstream role fit before it counts
// as a disagreement. The other cascade rules (physical_fit) compare numbers from
// ONE step, where any gap is a real contradiction. role_fit comes from a
// different step answering a different question, so a 0.1 gap is two hedges, not
// a claim — 0.9-over-0.8 means "good fit, minor reservation" both times. Only a
// gap this size means the steps actually disagree about whether the party
// belongs in the slot (the inverted chill-girl mapping: 1.0 over 0.7).
const FIT_SLACK = 0.2 - 1e-9

export function validateCard(card) {
  const v = []
  const repairs = []
  const bad = (code, msg) => v.push({ code, msg })
  const fixed = (code, msg, from, to) => repairs.push({ code, msg, from, to })
  const caption = card?.caption ?? ''
  if (!caption) bad('no-caption', 'card has no caption')

  const cast = Array.isArray(card?.image_configuration?.cast) ? card.image_configuration.cast : []
  const castNames = new Set(cast.map((c) => norm(c.played_by)).filter(Boolean))

  cast.forEach((c, i) => {
    const span = c.caption_span
    const score = num(c.score) ?? 0
    const where = `cast[${i}] "${c.image_party ?? '?'}" ← "${c.played_by ?? 'null'}"`
    if (span == null) {
      bad('cast-span-missing', `${where}: no caption_span field — the schema requires it`)
    } else if (span === '' && score > 0) {
      bad('cast-unnamed', `${where}: caption never names this entity (empty span) but scored ${score} — must be 0`)
    } else if (span !== '' && !isSpanOf(span, caption)) {
      const fix = repairSpan(span, caption)
      if (fix) fixed('cast-span-elided', `${where}: caption_span ${JSON.stringify(span)} stitches runs with "…" — repaired to the longest verbatim run ${JSON.stringify(fix)}`, span, fix)
      else bad('cast-span-fabricated', `${where}: caption_span ${JSON.stringify(span)} is not in the caption`)
    }
  })

  const als = Array.isArray(card?.element_allusions) ? card.element_allusions : []
  als.forEach((a, i) => {
    const score = num(a.allusion) ?? 0
    const where = `element_allusions[${i}] "${a.element ?? '?'}" ← "${a.played_by ?? '?'}"`
    const ev = a.evidence
    if (!['caption', 'image', 'neither'].includes(ev)) {
      bad('allusion-evidence-missing', `${where}: evidence must be caption|image|neither, got ${JSON.stringify(ev)}`)
      return
    }
    if (ev === 'neither' && score > 0) bad('allusion-neither', `${where}: evidence "neither" but scored ${score} — must be 0`)
    if (ev === 'caption' && !isSpanOf(a.caption_span, caption)) {
      const fix = repairSpan(a.caption_span, caption)
      if (fix) fixed('allusion-span-elided', `${where}: caption_span ${JSON.stringify(a.caption_span ?? '')} stitches runs with "…" — repaired to the longest verbatim run ${JSON.stringify(fix)}`, a.caption_span, fix)
      else bad('allusion-span', `${where}: evidence "caption" but caption_span ${JSON.stringify(a.caption_span ?? '')} is not in the caption`)
    }
    if (ev === 'image' && castNames.has(norm(a.played_by))) {
      bad('allusion-circular', `${where}: evidence "image" on an entity also cast onto a figure — the pose gives the viewer no NAME`)
    }
    const fit = num(a.role_fit)
    if (fit != null && score > fit + FIT_SLACK) {
      const why = a.role_fit_reason ? ` — element_map said: "${a.role_fit_reason}"` : ''
      bad('allusion-over-fit', `${where}: scored ${score} but the upstream element_map fit is ${fit}${why}. Naming the party is not fitting it into the slot — the row is capped by the fit.`)
    }
  })

  const ai = num(card?.analog_to_image)
  const ac = num(card?.analog_to_caption)
  const pf = num(card?.physical_fit)
  if (ai == null) bad('missing-analog_to_image', 'analog_to_image is missing')
  if (ac == null) bad('missing-analog_to_caption', 'analog_to_caption is missing')
  if (pf != null && ai != null && ac != null && pf > Math.min(ai, ac) + 1e-9) {
    bad('physical_fit-too-high', `physical_fit ${pf} exceeds min(analog_to_image ${ai}, analog_to_caption ${ac})`)
  }
  if (pf != null && cast.length) {
    // Check against the CORRECTED cast score, not the reported one: a cast
    // entry the caption never names is 0 whatever the model claimed, so the
    // physical_fit cascade surfaces in the same pass instead of a round later.
    const effective = cast.map((c) => (isSpanOf(c.caption_span, caption) || repairSpan(c.caption_span, caption) ? (num(c.score) ?? 0) : 0))
    const weakest = Math.min(...effective)
    if (pf > weakest + 1e-9) bad('physical_fit-over-cast', `physical_fit ${pf} exceeds weakest corrected cast score ${weakest}`)
  }
  if (num(card?.context_to_caption) == null) bad('missing-context_to_caption', 'context_to_caption is missing')

  return { ok: v.length === 0, violations: v, repairs }
}

export const validateOutput = (json) =>
  (Array.isArray(json?.captions) ? json.captions : [json]).map((c) => ({ caption: c?.caption ?? '', ...validateCard(c) }))

// ---- golden tests: the real bad card from ops, and its repaired twin ----
// The bad card is the one Lydia caught: two figures in the image, ONE entity in
// the caption, every score a 1. Every check below must fire on it.
const GOLDEN_BAD = {
  caption: "Me calmly searching for his new follow's finsta after he left me on read.",
  image_configuration: {
    cast: [
      { image_party: 'one person looking down into a glass they are holding', played_by: 'Me', caption_span: 'Me', score: 1 },
      { image_party: 'the other hides their face in their arms', played_by: 'my self respect', caption_span: '', score: 1 },
    ],
  },
  analog_to_image: 1,
  analog_to_caption: 1,
  physical_fit: 1,
  context_to_caption: 1,
  element_allusions: [
    { element: 'the person hyper-fixating', played_by: 'Me', evidence: 'caption', caption_span: 'Me', allusion: 1 },
    { element: 'the minor detail', played_by: "the girl he just followed's finsta", evidence: 'caption', caption_span: "the girl he just followed's finsta", allusion: 1 },
    { element: 'the overwhelming big picture', played_by: 'him leaving her message on read for six hours', evidence: 'caption', caption_span: 'he left me on read', allusion: 1 },
    { element: 'the other person who cannot face it', played_by: 'my self respect', evidence: 'image', caption_span: '', allusion: 1 },
  ],
}
const GOLDEN_GOOD = {
  caption: 'Me searching his new follow’s finsta while my self respect fully checks out.',
  image_configuration: {
    cast: [
      { image_party: 'one person looking down into a glass they are holding', played_by: 'Me', caption_span: 'Me', score: 1 },
      { image_party: 'the other hides their face in their arms', played_by: 'my self respect', caption_span: 'my self respect', score: 1 },
    ],
  },
  analog_to_image: 1,
  analog_to_caption: 1,
  physical_fit: 1,
  context_to_caption: 1,
  element_allusions: [
    { element: 'the person hyper-fixating', played_by: 'Me', evidence: 'caption', caption_span: 'Me', allusion: 1 },
    { element: 'the minor detail', played_by: "his new follow's finsta", evidence: 'caption', caption_span: 'his new follow’s finsta', allusion: 1 },
    { element: 'the overwhelming big picture', played_by: 'him leaving her on read', evidence: 'image', caption_span: '', allusion: 0.6 },
    { element: 'the other person who cannot face it', played_by: 'my self respect', evidence: 'caption', caption_span: 'my self respect', allusion: 1 },
  ],
}

// The real elided card from the 2026-07-31 S13 run: the model stitched
// "Me...after he replied 'lol' to my essay" with the prompt's contiguous-run
// rule already live. Evidence is fine, format is wrong → repair, don't flag.
const GOLDEN_ELIDED = {
  caption: "Me and my delusion rereading our one good chat after he replied 'lol' to my essay.",
  image_configuration: {
    cast: [
      { image_party: 'the person staring at their phone', played_by: 'Me', caption_span: 'Me', score: 1 },
      { image_party: 'the companion', played_by: 'my delusion', caption_span: 'my delusion', score: 1 },
    ],
  },
  analog_to_image: 1,
  analog_to_caption: 1,
  physical_fit: 1,
  context_to_caption: 1,
  element_allusions: [
    { element: 'someone going through sadness or failure', played_by: 'Me', evidence: 'caption', caption_span: "Me...after he replied 'lol' to my essay", allusion: 1 },
    // fragments NOT all in the caption → the repair must refuse and the
    // violation must stay
    { element: 'a fabricated one', played_by: 'Me', evidence: 'caption', caption_span: 'Me...zooming in on nothing', allusion: 1 },
  ],
}

// The real inverted card from the 2026-07-31 S13 run, the one Lydia caught by
// reading the row out loud: "how is the chill girl delusion like your current,
// wiser self?" It isn't — S12 already scored that pairing 0.7 and called it
// inverted, and S13 scored the SAME pairing 1.0 because the caption does name
// the delusion. Naming is not fitting. Row 1 (fit 1.0) must stay clean.
const GOLDEN_INVERTED = {
  caption: "Me at 2am and the chill girl delusion drafting a 'hey stranger' reply.",
  image_configuration: {
    cast: [
      { image_party: 'an alien with a slumped, downcast posture', played_by: 'me at 2am', caption_span: 'Me at 2am', score: 1 },
      { image_party: 'an alien figure with a caring and supportive demeanor', played_by: 'the delusion of being the chill girl', caption_span: 'the chill girl delusion', score: 1 },
    ],
  },
  analog_to_image: 1,
  analog_to_caption: 1,
  physical_fit: 1,
  context_to_caption: 1,
  element_allusions: [
    {
      element: 'a younger, more wounded part of yourself',
      played_by: 'me at 2am',
      evidence: 'caption',
      caption_span: 'Me at 2am',
      allusion: 1,
      role_fit: 1,
      role_fit_reason: 'This version of her is acting on the wound of loneliness and the need for validation, making her vulnerable.',
    },
    {
      element: 'your current, wiser self',
      played_by: 'the delusion of being the chill girl',
      evidence: 'caption',
      caption_span: 'the chill girl delusion',
      allusion: 1,
      role_fit: 0.7,
      role_fit_reason: "This is an inverted fit; the comforting 'wiser' self is actually a delusion enabling a bad decision, not true wisdom.",
    },
    // The near-miss Lydia rejected: 0.9 over 0.8 is two hedges about the same
    // fit, not two steps disagreeing. Under FIT_SLACK this must stay clean.
    {
      element: 'the thing being reread',
      played_by: 'the one good chat',
      evidence: 'image',
      caption_span: '',
      allusion: 0.9,
      role_fit: 0.8,
      role_fit_reason: 'The old conversation stands in for the version of him she wants back.',
    },
  ],
}

const selfTest = () => {
  let failed = 0
  const badRes = validateCard(GOLDEN_BAD)
  const want = ['cast-unnamed', 'allusion-circular', 'physical_fit-over-cast']
  const got = badRes.violations.map((x) => x.code)
  for (const w of want) {
    if (!got.includes(w)) { console.error(`GOLDEN BAD: expected violation ${w}, not raised`); failed += 1 }
  }
  console.log(`GOLDEN BAD  → ${badRes.violations.length} violation(s): ${got.join(', ')}`)
  for (const x of badRes.violations) console.log(`   · ${x.msg}`)

  const goodRes = validateCard(GOLDEN_GOOD)
  console.log(`\nGOLDEN GOOD → ${goodRes.ok ? 'clean ✓' : `${goodRes.violations.length} violation(s)`}`)
  if (!goodRes.ok) { goodRes.violations.forEach((x) => console.error(`   · [${x.code}] ${x.msg}`)); failed += 1 }

  const elRes = validateCard(GOLDEN_ELIDED)
  const elCodes = elRes.violations.map((x) => x.code)
  const elFix = elRes.repairs.find((r) => r.code === 'allusion-span-elided')
  if (!elFix) { console.error('GOLDEN ELIDED: expected an allusion-span-elided repair, not raised'); failed += 1 }
  if (elFix && elFix.to !== "after he replied 'lol' to my essay") { console.error(`GOLDEN ELIDED: repaired to ${JSON.stringify(elFix.to)}, wanted the longest verbatim run`); failed += 1 }
  if (!elCodes.includes('allusion-span')) { console.error('GOLDEN ELIDED: the unrepairable stitched span must STAY a violation'); failed += 1 }
  console.log(`\nGOLDEN ELIDED → ${elRes.repairs.length} repair(s), ${elRes.violations.length} violation(s): ${elCodes.join(', ') || '(none)'}`)
  for (const r of elRes.repairs) console.log(`   ~ ${r.msg}`)

  const invRes = validateCard(GOLDEN_INVERTED)
  const invFits = invRes.violations.filter((x) => x.code === 'allusion-over-fit')
  if (invFits.length !== 1) { console.error(`GOLDEN INVERTED: expected exactly 1 allusion-over-fit, got ${invFits.length}`); failed += 1 }
  if (invFits[0] && !invFits[0].msg.includes('wiser')) { console.error('GOLDEN INVERTED: the violation fired on the wrong row'); failed += 1 }
  console.log(`\nGOLDEN INVERTED → ${invRes.violations.length} violation(s): ${invRes.violations.map((x) => x.code).join(', ') || '(none)'}`)
  for (const x of invRes.violations) console.log(`   · ${x.msg}`)

  console.log(failed ? `\n${failed} self-test failure(s)` : '\nself-test passed')
  process.exit(failed ? 1 : 0)
}

const readStdin = async () => {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  if (argv.includes('--self-test')) selfTest()
  const raw = argv[0] ? fs.readFileSync(argv[0], 'utf8') : await readStdin()
  const strip = (t) => t.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')
  const results = validateOutput(JSON.parse(strip(raw)))
  let n = 0
  for (const r of results) {
    console.log(`\n"${r.caption}"`)
    for (const x of r.repairs ?? []) console.log(`  ~ [${x.code}] ${x.msg}`)
    if (r.ok) { console.log(`  clean ✓${r.repairs?.length ? ' (span repaired)' : ''}`); continue }
    for (const x of r.violations) { console.log(`  ✗ [${x.code}] ${x.msg}`); n += 1 }
  }
  console.log(`\n${n} violation(s) across ${results.length} caption(s)`)
  process.exit(n ? 1 : 0)
}
