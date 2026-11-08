// Side-by-side comparison of two specialist-engine runs on the same moments.
//   node scripts/reaction-jokes-compare.mjs <a.json> <b.json> [--labels b,c] [--md out.md]
// Prints tier counts and flag counts for both, then per moment every joke of
// each run (rank order) with its declared premise fields, verdict, evaluator
// status_consequence when present, and flags. Schema-agnostic on premise
// fields so any two engine runs compare.
import fs from 'node:fs'
const args = process.argv.slice(2)
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined }
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
if (files.length !== 2) { console.error('usage: <a.json> <b.json> [--labels a,b] [--md out.md]'); process.exit(1) }
const labels = (opt('labels') ?? 'a,b').split(',')
const runs = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))
const out = []
const p = (s = '') => out.push(s)
const rows = (job) => (job.jokes ?? []).map((joke, k) => {
  const d = job.evals?.[k]?.status === 'done' ? job.evals[k].data : null
  const a = d?.analysis ?? {}
  return { k, joke, rank: Number(a.rank ?? 99), verdict: d?.rating ?? 'unjudged', flags: d?.failure_flags ?? [], premise: job.premises?.[k] ?? {}, sc: a.status_consequence, keep: (job.survivors ?? []).includes(k) }
}).sort((x, y) => x.rank - y.rank)
const tally = (run) => {
  const t = { generated: 0, excellent: 0, strong: 0, possible: 0, reject: 0, survivors: 0, flags: {}, sc: {} }
  for (const job of Object.values(run.jobs ?? {})) for (const r of rows(job)) {
    t.generated++; t[r.verdict] = (t[r.verdict] ?? 0) + 1; if (r.keep) t.survivors++
    for (const f of r.flags) t.flags[f] = (t.flags[f] ?? 0) + 1
    if (r.sc) t.sc[r.sc] = (t.sc[r.sc] ?? 0) + 1
  }
  return t
}
const T = runs.map(tally)
p(`# ${labels[0]} vs ${labels[1]}: ${runs[0].engine?.mechanism ?? runs[0].personaName} on ${runs[0].moments.length} moments`)
p(); p(`| | ${labels.join(' | ')} |`); p('|---|---|---|')
for (const key of ['generated', 'excellent', 'strong', 'possible', 'reject', 'survivors']) p(`| ${key} | ${T.map((t) => t[key] ?? 0).join(' | ')} |`)
const allFlags = [...new Set(T.flatMap((t) => Object.keys(t.flags)))].sort((x, y) => (T[1].flags[y] ?? 0) + (T[0].flags[y] ?? 0) - (T[1].flags[x] ?? 0) - (T[0].flags[x] ?? 0))
for (const f of allFlags) p(`| flag ${f} | ${T.map((t) => t.flags[f] ?? 0).join(' | ')} |`)
const allSc = [...new Set(T.flatMap((t) => Object.keys(t.sc)))]
for (const s of allSc) p(`| status_consequence ${s} | ${T.map((t) => t.sc[s] ?? 0).join(' | ')} |`)
p(); p(`Generators: ${runs.map((r, i) => `${labels[i]} ${r.engine?.generatorFile ?? r.jobs[0]?.generatorFile ?? '?'}`).join('; ')}`)
p(`Evaluators: ${runs.map((r, i) => `${labels[i]} ${r.engine?.evaluatorFile ?? '?'}`).join('; ')}`)
runs[0].moments.forEach((m, i) => {
  p(); p(`## Moment ${i + 1}: ${m.split(':')[0].slice(0, 80)}`)
  runs.forEach((run, j) => {
    p(); p(`### ${labels[j]}`)
    for (const r of rows(run.jobs?.[i] ?? {})) {
      p(); p(`**${r.keep ? 'KEEP · ' : ''}${r.verdict.toUpperCase()}** — ${r.joke}`)
      for (const [key, v] of Object.entries(r.premise)) p(`- ${key}: ${v}`)
      if (r.sc) p(`- status_consequence: ${r.sc}`)
      p(`- flags: ${r.flags.length ? r.flags.join(', ') : 'none'}`)
    }
  })
})
const text = out.join('\n')
if (opt('md')) { fs.writeFileSync(opt('md'), text + '\n'); console.log(`wrote ${opt('md')}`) } else console.log(text)
