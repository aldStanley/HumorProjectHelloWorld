#!/usr/bin/env node
// Prints a run file (from scripts/reaction-jokes-run.mjs) as a table per set:
// each candidate's score, semantic coherence, persona specificity, comic
// premise, event fidelity, word count, mechanism, joke, and flags, sorted by
// score, plus a mechanism histogram and the flags Lydia asked to watch.
//
//   node scripts/reaction-jokes-report.mjs scripts/runs/<run>.json [--top N]
//
// A specialist-engine run (run.engine set) prints per set: rank, verdict,
// transformation distance, relatable base, persona ownership, word count,
// the joke, the declared relationship → reversal, and flags; then the
// tally the experiment reports on: generated, excellent, strong, possible,
// reject, survivors, and the two code backstops.
import fs from 'node:fs'

const file = process.argv[2]
const topN = Number.parseInt(process.argv[process.argv.indexOf('--top') + 1] || '5', 10)
if (!file) { console.error('usage: node scripts/reaction-jokes-report.mjs <run.json> [--top N]'); process.exit(1) }
const run = JSON.parse(fs.readFileSync(file, 'utf8'))
if (run.engine) {
  // Schema-agnostic: the declared premise fields come from job.premises and
  // the judgment fields from the evaluator's analysis, whichever version
  // wrote them (relationship/reversal, or event_truth/status_axis/gigachad_flip).
  const SKIP = new Set(['rank', 'evaluator_verdict', 'score_note'])
  const tally = { generated: 0, excellent: 0, strong: 0, possible: 0, reject: 0, unjudged: 0, survivors: 0, flags: {} }
  for (const [i, job] of Object.entries(run.jobs)) {
    const rows = (job.jokes ?? []).map((joke, k) => {
      const e = job.evals?.[k]
      const d = e?.status === 'done' ? e.data : null
      const a = d?.analysis ?? {}
      const judged = Object.entries(a).filter(([key]) => !SKIP.has(key) && !key.startsWith('declared_'))
      return { k, joke, rank: Number(a.rank ?? 99), verdict: d?.rating ?? 'unjudged', judged, flags: d?.failure_flags ?? (e ? ['eval-failed'] : []), w: joke.trim().split(/\s+/).length, premise: job.premises?.[k] ?? {}, reason: d?.reason ?? '' }
    }).sort((a, b) => a.rank - b.rank)
    const survivors = new Set(job.survivors ?? [])
    console.log(`\n=== Moment ${+i + 1}, ${run.engine.mechanism} engine — ${rows.length} candidates${job.status !== 'done' ? ` (${job.status}: ${job.error ?? ''})` : ''}`)
    if (!rows.length && job.noCandidates) console.log(`    no candidates: ${job.noCandidates}`)
    for (const r of rows) {
      tally.generated++; tally[r.verdict] = (tally[r.verdict] ?? 0) + 1
      if (survivors.has(r.k)) tally.survivors++
      for (const fl of r.flags) tally.flags[fl] = (tally.flags[fl] ?? 0) + 1
      const grades = r.judged.filter(([, v]) => /^(yes|no|partly|high|medium|low|one_move|one_move_plus|invented_bridge|not_a_reversal|concrete_event_native|concrete_but_generic|abstract_value_assertion|none|native|stretched|imported|strong_two_beat|strong_single_line|flat|overwritten|event_specific|loosely_connected|generic_shell|sincere_douchey|cruel|winking)$/.test(v)).map(([key, v]) => `${key.replace(/_/g, ' ')} ${v}`).join(', ')
      console.log(`\n${survivors.has(r.k) ? 'KEEP' : '    '} #${r.rank} ${r.verdict.toUpperCase()} (${r.w} words)  ${r.joke}`)
      for (const [key, v] of Object.entries(r.premise)) console.log(`        ${key}: ${v}`)
      if (grades) console.log(`        evaluator: ${grades}`)
      for (const [key, v] of r.judged) if (!/^(yes|no|partly|high|medium|low|one_move|one_move_plus|invented_bridge|not_a_reversal|concrete_event_native|concrete_but_generic|abstract_value_assertion|none|native|stretched|imported|strong_two_beat|strong_single_line|flat|overwritten|event_specific|loosely_connected|generic_shell|sincere_douchey|cruel|winking)$/.test(v)) console.log(`        evaluator ${key.replace(/_/g, ' ')}: ${v}`)
      if (r.reason) console.log(`        evaluator reason: ${r.reason}`)
      console.log(`        flags: ${r.flags.length ? r.flags.join(', ') : 'none'}`)
    }
  }
  console.log(`\n=== ${run.engine.mechanism}: generated ${tally.generated}, excellent ${tally.excellent}, strong ${tally.strong}, possible ${tally.possible}, reject ${tally.reject}${tally.unjudged ? `, unjudged ${tally.unjudged}` : ''}; survivors ${tally.survivors} (${tally.generated ? Math.round((100 * tally.survivors) / tally.generated) : 0}% of generated)`)
  console.log(`flags: ${Object.entries(tally.flags).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`)
  process.exit(0)
}
const WATCH = ['source_detail_overfit', 'premise_overextended', 'clever_sounding_but_unclear', 'factual_narrowing', 'formulaic_training_reframe', 'event_summary_plus_punchline']
const sets = [
  ...Object.entries(run.jobs).map(([i, j]) => ({ title: `Moment ${+i + 1}, step 1 (persona alone)`, job: j })),
  ...Object.entries(run.readJobs ?? {}).map(([i, j]) => ({ title: `Moment ${+i + 1}, step 2 (with the student read)`, job: j })),
].sort((a, b) => a.title.localeCompare(b.title))
const words = (t) => t.trim().split(/\s+/).length
const totals = { n: 0, watch: {}, moves: {}, lengths: [] }
for (const { title, job } of sets) {
  const rows = (job.jokes ?? []).map((joke, k) => {
    const e = job.evals?.[k]
    const d = e?.status === 'done' ? e.data : null
    const c = d?.criteria ?? {}
    return { joke, score: d?.score ?? -1, coh: c.semantic_coherence?.score ?? '?', per: c.persona_specificity?.score ?? '?', pre: c.comic_premise?.score ?? '?', fid: c.event_fidelity?.score ?? '?', move: d?.analysis?.gigachad_move ?? '?', flags: d?.failure_flags ?? (e ? ['eval-failed'] : []), w: words(joke) }
  }).sort((a, b) => b.score - a.score)
  const hist = {}
  for (const r of rows) { hist[r.move] = (hist[r.move] ?? 0) + 1; totals.moves[r.move] = (totals.moves[r.move] ?? 0) + 1; totals.lengths.push(r.w); totals.n++; for (const f of r.flags) if (WATCH.includes(f)) totals.watch[f] = (totals.watch[f] ?? 0) + 1 }
  const scored = rows.filter((r) => r.score >= 0)
  console.log(`\n=== ${title} — ${rows.length} candidates, mean ${Math.round(scored.reduce((n, r) => n + r.score, 0) / scored.length)}, median words ${[...rows.map((r) => r.w)].sort((a, b) => a - b)[Math.floor(rows.length / 2)]}, moves: ${Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  console.log('     score coh per pre fid  w  mechanism                  joke')
  rows.forEach((r, i) => {
    console.log(`${i < topN ? 'KEEP' : '    '} ${String(r.score).padStart(5)}  ${r.coh}   ${r.per}   ${r.pre}   ${r.fid}  ${String(r.w).padStart(2)}  ${String(r.move).padEnd(26)} ${r.joke}`)
    if (r.flags.length) console.log(`${' '.repeat(38)}flags: ${r.flags.join(', ')}`)
  })
}
const L = totals.lengths.sort((a, b) => a - b)
console.log(`\n=== Across ${totals.n} candidates: median ${L[Math.floor(L.length / 2)]} words, ${L.filter((w) => w > 20).length} over 20 words, ${L.filter((w) => w >= 7 && w <= 16).length} in the 7–16 target`)
console.log(`mechanisms: ${Object.entries(totals.moves).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`)
console.log(`watched flags: ${WATCH.map((f) => `${f} ${totals.watch[f] ?? 0}`).join(', ')}`)
