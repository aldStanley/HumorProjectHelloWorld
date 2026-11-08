// Run several specialist engines on the same moments, independently, and
// pool their survivors.
//
//   node scripts/reaction-jokes-engines.mjs --engines gigachad-power-reversal,gigachad-latent-irony \
//     --moments scripts/runs/x.json [--count 6] [--effort medium] [--prefix scripts/runs/<name>]
//
// Each engine runs in its own reaction-jokes-run.mjs process (same moments,
// count, effort, --evaluate), never seeing another engine's prompt or
// candidates, and writes its own importable run file
// <prefix>-<engine>.json. Then this script pools: per moment, every survivor
// from every engine with its provenance, no per-engine quota (an engine
// that abstained or whose evaluator rejected everything contributes
// nothing), plus a per-engine table (generated, verdicts, abstained,
// survivors). The pool is printed and written to <prefix>-pool.md. Hearts:
// import each engine file on the past-runs page, heart, copy the bundles,
// then scripts/reaction-jokes-hearts.mjs --runs <the engine files> --hearts <bundles>.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const engines = (opt('engines') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const momentsFile = opt('moments')
if (engines.length < 1 || !momentsFile) { console.error('usage: --engines a,b,c --moments <json> [--count N] [--effort low|medium|high] [--prefix scripts/runs/<name>]'); process.exit(1) }
const count = opt('count', '6'), effort = opt('effort', 'medium')
const prefix = opt('prefix', path.join('scripts/runs', `engines-${new Date().toISOString().slice(0, 10)}`))
const mechOf = (folder) => { const f = fs.readdirSync(path.join('docs/prompts/engines', folder, 'generator')).filter((x) => x.endsWith('.md')).sort().pop(); const m = fs.readFileSync(path.join('docs/prompts/engines', folder, 'generator', f), 'utf8').match(/^Mechanism:\s*(\S+)/m); return m?.[1] ?? folder }

const t0 = Date.now()
const runs = await Promise.all(engines.map((folder) => new Promise((resolve) => {
  const out = `${prefix}-${folder}.json`
  if (fs.existsSync(out)) fs.unlinkSync(out)
  const child = spawn(process.execPath, ['scripts/reaction-jokes-run.mjs', '--engine', folder, '--moments', momentsFile, '--count', count, '--evaluate', '--effort', effort, '--out', out], { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  child.on('close', (code) => {
    for (const line of log.trim().split('\n')) console.log(`[${folder}] ${line}`)
    resolve({ folder, code, out, run: code === 0 && fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null })
  })
})))
console.log(`\nall engines finished in ${Math.round((Date.now() - t0) / 1000)}s`)

const lines = []
const p = (s = '') => lines.push(s)
const moments = runs.find((r) => r.run)?.run.moments ?? []
p(`# Survivor pool: ${engines.map(mechOf).join(', ')} on ${moments.length} moments (up to ${count} candidates per engine, ${effort} effort)`)
p()
p('| engine | generated | excellent | strong | possible | reject | abstained | survivors | survivors/generated |')
p('|---|---|---|---|---|---|---|---|---|')
for (const r of runs) {
  if (!r.run) { p(`| ${mechOf(r.folder)} | failed (exit ${r.code}) | | | | | | | |`); continue }
  const t = { generated: 0, excellent: 0, strong: 0, possible: 0, reject: 0, abstained: 0, survivors: 0 }
  for (const job of Object.values(r.run.jobs)) {
    if (job.noCandidates) t.abstained++
    for (const [k] of (job.jokes ?? []).entries()) { t.generated++; const v = job.evals?.[k]?.data?.rating; if (v in t) t[v]++ }
    t.survivors += job.survivors?.length ?? 0
  }
  p(`| ${mechOf(r.folder)} | ${t.generated} | ${t.excellent} | ${t.strong} | ${t.possible} | ${t.reject} | ${t.abstained} | ${t.survivors} | ${t.generated ? Math.round((100 * t.survivors) / t.generated) : 0}% |`)
}
moments.forEach((m, i) => {
  p(); p(`## Moment ${i + 1}: ${m.split(':')[0].slice(0, 80)}`); p()
  let any = false
  for (const r of runs) {
    if (!r.run) continue
    const job = r.run.jobs[i]
    const mech = mechOf(r.folder)
    if (!job || job.status !== 'done') { p(`- ${mech}: ${job?.status ?? 'missing'}${job?.error ? `, ${job.error}` : ''}`); continue }
    if (!job.jokes?.length) { p(`- ${mech}: abstained${job.noCandidates ? `. ${job.noCandidates}` : ''}`); continue }
    const surv = (job.survivors ?? []).map((k) => ({ k, joke: job.jokes[k], v: job.evals?.[k]?.data?.rating ?? '?', premise: job.premises?.[k] ?? {} }))
    if (!surv.length) { p(`- ${mech}: ${job.jokes.length} candidates, none survived`); continue }
    any = true
    for (const s of surv) { p(`- **${s.v.toUpperCase()}** (${mech}) ${s.joke}`); const pv = Object.values(s.premise); if (pv.length) p(`  - premise: ${pv[pv.length - 1]}`) }
  }
  if (!any) p('- no survivors from any engine')
})
const text = lines.join('\n') + '\n'
fs.writeFileSync(`${prefix}-pool.md`, text)
console.log('\n' + text)
console.log(`wrote ${prefix}-pool.md and ${runs.map((r) => r.out).join(', ')}`)
