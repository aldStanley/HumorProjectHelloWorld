#!/usr/bin/env node
// Blind A/B comparison of two pinned recognize outputs on one image.
//
//   node scripts/meme-opt/compare.mjs --image <id> --a <pin.json> --b <pin.json> [--runs 4] [--name cmp]
//
// Runs the full downstream pipeline (moments -> 3 captions -> judge) K times
// per pin, pools all captions SHUFFLED and UNLABELED into an HTML page, and
// lets the human check the ones they like before clicking "Reveal sources" —
// which unblinds each caption's pin and judge score and tallies likes per pin.
// The point: the judge is saturated, so the only trustworthy comparison is a
// human judging blind.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEnv, makeDb, pLimit } from './lib.mjs'
import { runPipelineForImage } from './pipeline.mjs'
import { diffHtml } from './report.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')

const args = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i]
}
if (!args.image || !args.a || !args.b) {
  console.error('usage: node scripts/meme-opt/compare.mjs --image <id> --a <pin.json> --b <pin.json> [--runs 4] [--name cmp-...]')
  process.exit(1)
}

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function main() {
  const env = loadEnv(ROOT)
  const apiKey = env.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY
  const db = makeDb(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const runs = Number(args.runs ?? 4)

  const readPin = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.resolve(process.cwd(), p), 'utf8').trim()
  // Randomize which file is "first" so even the person launching the script
  // can't infer sources from ordering.
  const files = Math.random() < 0.5 ? [args.a, args.b] : [args.b, args.a]
  const pins = files.map((f) => ({ file: f, json: readPin(f) }))

  const [imgRows, contexts] = await Promise.all([
    db(`images?id=eq.${args.image}&select=id,url,additional_context,image_description`),
    db('community_contexts?select=content&order=id'),
  ])
  const image = imgRows[0]
  if (!image) {
    console.error(`no image with id ${args.image}`)
    process.exit(1)
  }
  const contextsText = contexts.map((c) => c.content).filter(Boolean).join('\n')

  const limit = pLimit(6)
  const ctx = { apiKey, steps: { 1: {} }, contextsText, includeNaive: false, limit, pinRecognize: true }

  console.log(`Running ${runs} pipeline rounds per pin (${runs * 2 * 7} OpenAI calls)…`)
  const all = []
  await Promise.all(
    pins.flatMap((pin, pi) =>
      Array.from({ length: runs }, (_, k) =>
        runPipelineForImage(ctx, image, pin.json)
          .then((r) => {
            for (const b of r.branches ?? []) {
              if (!b || b.error || !b.caption) continue
              all.push({
                caption: String(b.caption),
                moment: typeof b.moment?.moment === 'string' ? b.moment.moment : '',
                score: b.score,
                pin: pi,
                run: k,
              })
            }
            console.log(`  pin ${pi} run ${k + 1}/${runs}: ${(r.branches ?? []).filter((b) => b?.caption).length} captions${r.error ? ` (⚠ ${r.error})` : ''}`)
          })
          .catch((err) => console.log(`  pin ${pi} run ${k + 1}: ⚠ ${err?.message ?? err}`))
      )
    )
  )
  if (!all.length) {
    console.error('no captions were produced — aborting')
    process.exit(1)
  }

  // Shuffle the pooled captions.
  for (let i = all.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }

  const runsDir = path.join(HERE, 'runs')
  let name = args.name
  if (!name) {
    let n = 1
    while (fs.existsSync(path.join(runsDir, `compare-${n}`))) n += 1
    name = `compare-${n}`
  }
  const outDir = path.join(runsDir, name)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'compare.json'), JSON.stringify({ image: image.id, files, runs, captions: all }, null, 2))

  const cards = all
    .map(
      (c, i) => `<div class="card" data-pin="${c.pin}">
      <label><input type="checkbox" class="like" data-pin="${c.pin}"> <span class="cap">${esc(c.caption)}</span></label>
      <div class="momentline muted">moment: ${esc(c.moment.slice(0, 140))}</div>
      <div class="src" hidden>source: <strong class="srcname" data-pin="${c.pin}"></strong> · judge score ${c.score ?? '—'}</div>
    </div>`
    )
    .join('\n')

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Blind compare — ${esc(name)}</title>
<style>
body{font:15px/1.45 -apple-system,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1a1a1a}
img.meme{max-width:340px;border-radius:8px;display:block;margin:0 0 6px}
.card{border:1px solid #ddd;border-radius:8px;padding:10px 14px;margin:10px 0}
.cap{font-weight:600}
.muted{color:#888;font-size:12.5px;margin-top:4px}
.src{margin-top:6px;font-size:13px;color:#0a6}
button{font-size:15px;padding:8px 18px;border-radius:8px;border:1px solid #888;cursor:pointer;margin:14px 0}
#tally{font-size:17px;font-weight:600;margin:10px 0}
details{margin:20px 0}pre{white-space:pre-wrap;word-break:break-word;background:#f6f6f6;border:1px solid #ddd;border-radius:6px;padding:10px;font-size:12px}
ins{background:#d3f9d8;text-decoration:none}del{background:#ffe3e3}
</style></head><body>
<h1>Blind caption comparison</h1>
<p>Two recognize outputs each generated captions for this image, ${runs} pipeline runs apiece.
All captions are pooled and shuffled below. <strong>Check every caption you'd be happy to post</strong>, then reveal the sources.</p>
<img class="meme" src="${esc(image.url)}" alt="meme">
${cards}
<button id="reveal">Reveal sources &amp; tally</button>
<div id="tally" hidden></div>
<details><summary>The two recognize JSONs (diff, revealed with sources)</summary>
<div id="jsondiff" hidden><pre>${diffHtml(pins[0].json, pins[1].json)}</pre>
<p class="muted">shown as: <del>only in ${esc(path.basename(files[0]))}</del> · <ins>only in ${esc(path.basename(files[1]))}</ins></p></div>
<p id="jsonhint" class="muted">hidden until you reveal, so it can't bias your judging</p>
</details>
<script>
var NAMES=${JSON.stringify(files.map((f) => path.basename(f)))};
document.getElementById('reveal').addEventListener('click',function(){
  var counts=[[0,0],[0,0]]; // [pin][liked? 1 : 0] -> counts[pin] = [total, liked]
  document.querySelectorAll('.card').forEach(function(card){
    var pin=+card.dataset.pin;
    counts[pin][0]+=1;
    if(card.querySelector('.like').checked)counts[pin][1]+=1;
    card.querySelector('.src').hidden=false;
    card.querySelector('.srcname').textContent=NAMES[pin];
  });
  var t=document.getElementById('tally');t.hidden=false;
  t.innerHTML=NAMES.map(function(n,i){return n+': you liked '+counts[i][1]+' of '+counts[i][0];}).join('<br>');
  document.getElementById('jsondiff').hidden=false;
  document.getElementById('jsonhint').hidden=true;
});
</script>
</body></html>`
  const outFile = path.join(outDir, 'compare.html')
  fs.writeFileSync(outFile, html)
  console.log(`\nBlind comparison ready: ${outFile}`)
  console.log(`(${all.length} captions pooled from ${files.map((f) => path.basename(f)).join(' vs ')})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
