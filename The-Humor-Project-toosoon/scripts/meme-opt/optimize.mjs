#!/usr/bin/env node
// Automated improvement loop for the flavor-1513 "Recognize content" prompt.
//
//   node scripts/meme-opt/optimize.mjs --set <slug-or-id> [options]
//
// Each round: run the full ops pipeline headlessly for every meme in the set,
// score the captions with the same "Check meme format alignment" judge the ops
// page uses, have an improver model propose a short ADDITIVE amendment to the
// recognize prompt, and accept it only if the train score improves without the
// holdout memes getting worse. Everything is written to
// scripts/meme-opt/runs/<name>/{state.json,report.html} after every round.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv, makeDb, pLimit } from './lib.mjs'
import {
  runPipelineForImage,
  imageScores,
  buildRecognizeUserPrompt,
  CAPTION_MODEL,
} from './pipeline.mjs'
import { proposeAmendment, countWords } from './improve.mjs'
import { writeReport } from './report.mjs'
import { startInteractive } from './serve.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

// ---- args ----
const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (!a.startsWith('--')) continue
  const key = a.slice(2)
  const flag = ['include-naive', 'dry-run', 'help', 'interactive', 'resume'].includes(key)
  args[key] = flag ? true : argv[++i]
}

if (args.help) {
  console.log(`usage: node scripts/meme-opt/optimize.mjs --set <slug-or-id> [options]

options:
  --set <slug|id>        image set to run on (omit to list available sets)
  --images <id,id,...>   only these image ids from the set
  --flavor <id>          humor flavor (default 1513)
  --rounds <n>           improvement rounds after the baseline (default 4; 0 = QA-only run)
  --holdout <0..0.9>     fraction of memes held out of tuning (default 0.3; needs >=4 memes)
  --interactive          human-in-the-loop: after the baseline, serves the live
                         report on localhost; you critique the jokes, GPT-5.5
                         proposes a revision (highlighted diff), and nothing
                         runs until you approve. --rounds is ignored.
  --port <n>             port for --interactive (default 5099)
  --improver-model <id>  model that proposes amendments (default gpt-5.5)
  --concurrency <n>      max simultaneous OpenAI calls (default 6)
  --include-naive        also generate the "Naive meme Caption" baseline per meme
  --pin-recognize <file> pin Recognize content to this file's JSON (no recognize
                         call); rounds then revise the JSON itself, not the prompt.
                         Meant for a single image (like pinning in the ops page).
  --name <run-name>      run directory name (default opt-<n>)
  --resume               continue an existing --name run: loads its state.json
                         (rounds, chat, feedback) instead of re-running the
                         baseline. Pass the same --set/--images/--pin flags.
  --dry-run              print the plan + API-call estimate and exit`)
  process.exit(0)
}

const logLines = []
const log = (msg) => {
  console.log(msg)
  logLines.push(String(msg))
  if (logLines.length > 400) logLines.splice(0, 200)
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

const summarize = (perImage, holdoutIds) => {
  const agg = (imgs) => {
    const all = []
    const tops = []
    for (const img of imgs) {
      if (img.error) continue
      const s = imageScores(img)
      all.push(...s.scores)
      if (s.top != null) tops.push(s.top)
    }
    return { meanAll: mean(all), meanTop: mean(tops), images: imgs.length, captions: all.length }
  }
  return {
    train: agg(perImage.filter((i) => !holdoutIds.has(i.imageId))),
    holdout: agg(perImage.filter((i) => holdoutIds.has(i.imageId))),
  }
}

const EPS_GAIN = 0.005 // train must improve by at least this
const EPS_HOLD = 0.03 // holdout may drop at most this

const isAccepted = (candidate, best) => {
  const t = candidate.train
  const bt = best.train
  if (!Number.isFinite(t.meanAll) || !Number.isFinite(bt.meanAll)) return false
  if (t.meanAll <= bt.meanAll + EPS_GAIN) return false
  const h = candidate.holdout
  const bh = best.holdout
  if (h.captions > 0 && bh.captions > 0 && h.meanAll < bh.meanAll - EPS_HOLD) return false
  return true
}

async function main() {
  const env = loadEnv(ROOT)
  const apiKey = env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY
  const sbUrl = env.NEXT_PUBLIC_SUPABASE_URL
  const sbKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!apiKey || !sbUrl || !sbKey) {
    console.error('Missing OPENAI_API_KEY / NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env')
    process.exit(1)
  }
  const db = makeDb(sbUrl, sbKey)

  const flavorId = Number(args.flavor ?? 1513)
  const rounds = Number(args.rounds ?? 4)
  const holdoutFrac = Math.min(0.9, Math.max(0, Number(args.holdout ?? 0.3)))
  const improverModel = args['improver-model'] ?? 'gpt-5.5'
  const concurrency = Number(args.concurrency ?? 6)
  const includeNaive = Boolean(args['include-naive'])
  const pinFile = args['pin-recognize']
  let pinnedJson = null
  if (pinFile) {
    const pinPath = path.isAbsolute(pinFile) ? pinFile : path.resolve(process.cwd(), pinFile)
    pinnedJson = fs.readFileSync(pinPath, 'utf8').trim()
  }

  // ---- load prompts + models from the DB (same rows the ops page loads) ----
  const [stepRows, modelRows, setRows] = await Promise.all([
    db(
      `humor_flavor_steps?humor_flavor_id=eq.${flavorId}&select=order_by,llm_system_prompt,llm_user_prompt,llm_temperature,llm_input_type_id,llm_model_id&order=order_by`
    ),
    db('llm_models?select=id,provider_model_id,is_temperature_supported'),
    db('study_image_sets?select=id,slug&order=id'),
  ])
  const modelsById = new Map(modelRows.map((m) => [m.id, m]))
  const steps = {}
  for (const s of stepRows) {
    const model = s.llm_model_id ? modelsById.get(s.llm_model_id) : null
    steps[s.order_by] = {
      systemPrompt: s.llm_system_prompt ?? '',
      userPrompt: s.llm_user_prompt ?? '',
      providerModelId: model?.provider_model_id ?? '',
      isTemperatureSupported: model?.is_temperature_supported ?? false,
      temperature: s.llm_temperature,
      includeImage: s.llm_input_type_id === 1,
    }
  }
  if (!steps[1]?.providerModelId) {
    console.error(`Flavor ${flavorId} has no step 1 (Recognize content) with a model configured.`)
    process.exit(1)
  }
  if (!steps[1].providerModelId.startsWith('gpt') && !/^o\d/.test(steps[1].providerModelId)) {
    console.error(
      `Step 1 uses model "${steps[1].providerModelId}" — this script only speaks OpenAI. Aborting.`
    )
    process.exit(1)
  }

  // ---- resolve the image set ----
  if (!args.set) {
    log('No --set given. Available image sets:')
    for (const s of setRows) log(`  ${String(s.id).padStart(3)}  ${s.slug}`)
    log('\nRe-run with --set <slug-or-id> (use the id if a slug appears more than once).')
    process.exit(0)
  }
  const byId = setRows.find((s) => String(s.id) === String(args.set))
  const bySlug = setRows.filter((s) => s.slug === args.set)
  if (!byId && bySlug.length > 1) {
    console.error(`Slug "${args.set}" is ambiguous (ids: ${bySlug.map((s) => s.id).join(', ')}). Use --set <id>.`)
    process.exit(1)
  }
  const set = byId ?? bySlug[0]
  if (!set) {
    console.error(`No image set named "${args.set}". Run without --set to list them.`)
    process.exit(1)
  }

  const mappings = await db(
    `study_image_set_image_mappings?study_image_set_id=eq.${set.id}&select=image:images(id,url,additional_context,image_description)&order=id`
  )
  let images = []
  const seen = new Set()
  for (const m of mappings) {
    const img = Array.isArray(m.image) ? m.image[0] : m.image
    if (!img?.url || seen.has(img.id)) continue
    seen.add(img.id)
    images.push(img)
  }
  if (args.images) {
    const want = new Set(String(args.images).split(',').map((s) => s.trim()))
    images = images.filter((i) => want.has(String(i.id)))
  }
  if (!images.length) {
    console.error(`Image set "${set.slug}" has no usable images${args.images ? ' matching --images' : ''}.`)
    process.exit(1)
  }

  // ---- deterministic holdout split (evenly spaced over sorted ids) ----
  const sorted = [...images].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  const holdoutIds = new Set()
  if (images.length >= 4 && holdoutFrac > 0) {
    const count = Math.max(1, Math.round(images.length * holdoutFrac))
    const step = sorted.length / count
    for (let k = 0; k < count; k += 1) holdoutIds.add(sorted[Math.floor(k * step)].id)
  }

  const contexts = await db('community_contexts?select=content&order=id')
  const corpusRows = contexts.map((c) => c.content).filter(Boolean)
  const contextsText = corpusRows.join('\n')

  if (pinnedJson && images.length > 1) {
    log(`⚠ --pin-recognize applies ONE fixed recognize output to all ${images.length} images — ` +
      'a pinned verdict is usually about one specific meme. Consider --images <id>.')
  }

  const callsPerImage = (pinnedJson ? 1 : 2) + 3 + 3 + (includeNaive ? 1 : 0)
  const estCalls = images.length * callsPerImage * (rounds + 1) + rounds
  log(`Plan: flavor ${flavorId}, set "${set.slug}" (#${set.id}), ${images.length} memes ` +
    `(${images.length - holdoutIds.size} train / ${holdoutIds.size} holdout), baseline + ${rounds} rounds.`)
  log(`Models: recognize=${steps[1].providerModelId}, pipeline+judge=${CAPTION_MODEL}, improver=${improverModel}.`)
  log(`Estimated OpenAI calls: ~${estCalls} (${callsPerImage}/meme/round).`)
  if (args['dry-run']) return

  // ---- run dir + state ----
  const runsDir = path.join(HERE, 'runs')
  fs.mkdirSync(runsDir, { recursive: true })
  let runName = args.name
  if (!runName) {
    let n = 1
    while (fs.existsSync(path.join(runsDir, `opt-${n}`))) n += 1
    runName = `opt-${n}`
  }
  const runDir = path.join(runsDir, runName)
  fs.mkdirSync(runDir, { recursive: true })

  // --resume: reload a previous run's state (rounds, chat, feedback) rather
  // than starting over. The DB-derived context (steps, images, corpus) was
  // rebuilt above from the same flags.
  const statePath = path.join(runDir, 'state.json')
  const resuming = Boolean(args.resume && fs.existsSync(statePath))
  if (args.resume && !resuming) {
    log(`⚠ --resume: no state.json in ${runDir}; starting a fresh run instead.`)
  }

  const state = resuming ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {
    corpus: corpusRows,
    config: {
      runName,
      flavorId,
      setSlug: set.slug,
      setId: set.id,
      rounds,
      holdoutFrac,
      recognizeModel: steps[1].providerModelId,
      captionModel: CAPTION_MODEL,
      improverModel,
      includeNaive,
      pinnedMode: Boolean(pinnedJson),
      startedAt: new Date().toISOString(),
    },
    images: images.map((i) => ({ id: i.id, url: i.url, holdout: holdoutIds.has(i.id) })),
    basePrompt: {
      system: steps[1].systemPrompt,
      user: buildRecognizeUserPrompt(steps[1].userPrompt, ''),
    },
    rounds: [],
    best: { roundIndex: 0, amendment: '' },
  }
  const save = () => {
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(state, null, 2))
    writeReport(runDir, state)
  }

  const limit = pLimit(concurrency)
  const ctx = { apiKey, steps, contextsText, includeNaive, limit, pinRecognize: Boolean(pinnedJson) }

  const evaluate = async (amendment, label) => {
    log(`  running pipeline on ${images.length} memes (${label})…`)
    const perImage = await Promise.all(
      images.map(async (img) => {
        try {
          const r = await runPipelineForImage(ctx, img, amendment)
          const s = imageScores(r)
          log(`    image ${img.id}: ${s.scores.length} verdicts, top ${s.top ?? '—'} mean ${s.mean?.toFixed(2) ?? '—'}${r.error ? ` (⚠ ${r.error})` : ''}`)
          for (const b of r.branches ?? []) {
            if (!b) continue
            if (b.error) log(`      ⚠ branch ${b.index + 1}: ${b.error}`)
            else log(`      ${(b.score ?? '?')} ${JSON.stringify(String(b.caption ?? '').slice(0, 80))}`)
          }
          return r
        } catch (err) {
          log(`    image ${img.id}: ⚠ ${err?.message ?? err}`)
          return { imageId: img.id, url: img.url, error: String(err?.message ?? err), branches: [] }
        }
      })
    )
    return { perImage, scores: summarize(perImage, holdoutIds) }
  }

  let best
  if (resuming) {
    // Keep the saved corpus in sync with the DB (older runs may lack it).
    state.corpus = corpusRows
    // Trust the saved run: its holdout split and accepted rounds carry over.
    holdoutIds.clear()
    for (const i of state.images) if (i.holdout) holdoutIds.add(i.id)
    best = [...state.rounds].filter((r) => r.accepted).pop()
    log(`\nResumed run "${runName}": ${state.rounds.length} round(s), current best round ${best?.index ?? 0}.`)
  } else {
    // ---- round 0: baseline ----
    log(
      pinnedJson
        ? '\nRound 0 (baseline — YOUR pinned recognize JSON, downstream steps as the ops page runs them):'
        : '\nRound 0 (baseline — the prompt exactly as the ops page runs it):'
    )
    const base = await evaluate(pinnedJson ?? '', 'baseline')
    state.rounds.push({ index: 0, amendment: pinnedJson ?? '', improver: null, accepted: true, ...base })
    if (pinnedJson) state.best = { roundIndex: 0, amendment: pinnedJson }
    best = state.rounds[0]
    log(`  baseline: train meanAll ${best.scores.train.meanAll?.toFixed(3)} · holdout ${best.scores.holdout.meanAll?.toFixed(3) ?? '—'}`)
    save()
  }

  // ---- interactive mode: hand control to the local web server ----
  if (args.interactive) {
    await startInteractive({
      state,
      save,
      runDir,
      evaluate,
      apiKey,
      improverModel,
      pinnedJson,
      holdoutIds,
      logLines,
      log,
      port: Number(args.port ?? 5099),
    })
    return
  }

  // ---- improvement rounds (indices continue from any resumed state) ----
  for (let step = 0; step < rounds; step += 1) {
    const r = state.rounds.length
    log(`\nRound ${r}: asking ${improverModel} for a prompt amendment…`)
    let proposal
    try {
      proposal = await proposeAmendment({
        apiKey,
        model: improverModel,
        fallbackModel: 'gpt-4.1-2025-04-14',
        log,
        promptInputs: {
          mode: pinnedJson ? 'json' : 'prompt',
          baseSystem: state.basePrompt.system,
          baseUser: state.basePrompt.user,
          currentAmendment: best.amendment,
          latestRound: best,
          history: state.rounds.map((x) => ({
            index: x.index,
            amendment: x.amendment,
            scores: x.scores,
            accepted: x.accepted,
            hypothesis: x.hypothesis,
            whatChanged: x.improver?.what_changed,
          })),
          holdoutIds,
        },
      })
    } catch (err) {
      log(`  improver call failed: ${err?.message ?? err} — stopping.`)
      break
    }
    if (!proposal) continue
    const sizeNow = pinnedJson ? proposal.amendment.length : countWords(proposal.amendment)
    const sizeBest = pinnedJson ? String(best.amendment ?? '').length : countWords(best.amendment)
    const delta = sizeNow - sizeBest
    const unit = pinnedJson ? 'chars' : 'words'
    log(`  hypothesis: ${proposal.hypothesis || '(none given)'}`)
    log(`  operation: ${JSON.stringify(proposal.operation).replace(/\s+/g, ' ').slice(0, 160)}`)
    log(`  size: ${sizeNow} ${unit} (${delta >= 0 ? '+' : ''}${delta} vs best)`)

    const evald = await evaluate(proposal.amendment, `round ${r}`)
    const accepted = isAccepted(evald.scores, best.scores)
    const round = {
      index: r,
      amendment: proposal.amendment,
      hypothesis: proposal.hypothesis,
      improver: {
        analysis: proposal.analysis,
        what_changed: proposal.what_changed,
        operation: proposal.operation,
        model: proposal.model,
      },
      accepted,
      ...evald,
    }
    state.rounds.push(round)
    if (accepted) {
      best = round
      state.best = { roundIndex: r, amendment: round.amendment }
      log(`  ✓ ACCEPTED — train ${round.scores.train.meanAll?.toFixed(3)} (holdout ${round.scores.holdout.meanAll?.toFixed(3) ?? '—'})`)
    } else {
      log(`  ✗ rejected — train ${round.scores.train.meanAll?.toFixed(3)} vs best ${best.scores.train.meanAll?.toFixed(3)} (holdout guard ±${EPS_HOLD})`)
    }
    save()
  }

  const bestIsBaseline = state.best.roundIndex === 0
  log(`\nDone. Best: round ${state.best.roundIndex}${bestIsBaseline ? ' (baseline — nothing beat it)' : ''}.`)
  const tested = state.rounds.filter((r) => r.hypothesis)
  if (tested.length) {
    log('\nHypothesis ledger:')
    for (const r of tested) {
      log(`  R${r.index} ${r.accepted ? '✓' : '✗'} ${r.hypothesis}`)
    }
  }
  if (state.best.amendment && !(bestIsBaseline && !pinnedJson)) {
    log(
      pinnedJson
        ? `\n--- winning recognize JSON (${bestIsBaseline ? 'your original — ' : ''}pin it as the Recognize content output in ops) ---\n`
        : '\n--- winning amendment (paste at the END of step 1\'s user prompt to adopt) ---\n'
    )
    log(state.best.amendment)
    log('\n---')
  }
  log(`\nInspect the full run: open ${path.join(runDir, 'report.html')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
