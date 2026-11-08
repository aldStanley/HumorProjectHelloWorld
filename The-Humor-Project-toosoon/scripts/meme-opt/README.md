# meme-opt — automated prompt-improvement loop for the ops meme pipeline

Automates the manual loop on `/humor-flavor/1513/ops`: run all → read the
"Check meme format alignment" scores → ask an LLM how to improve the
"Recognize content" prompt → re-run → repeat. Instead of one meme at a time in
the browser, it runs **every meme in an image set headlessly**, and instead of
copy-pasting into ChatGPT, an improver model proposes **one minimal edit
operation** each round — a named hypothesis, applied by code, with
anti-overfitting rules enforced mechanically.

## Usage

```bash
# list available image sets
node scripts/meme-opt/optimize.mjs

# see the plan + API-call estimate without spending anything
node scripts/meme-opt/optimize.mjs --set reaction-set --dry-run

# full run: baseline + 4 improvement rounds
node scripts/meme-opt/optimize.mjs --set reaction-set

# QA-only: score the CURRENT prompt on every meme, no tuning
node scripts/meme-opt/optimize.mjs --set reaction-set --rounds 0

# human-in-the-loop: YOU critique each round's jokes in the browser,
# GPT-5.5 proposes a revision (highlighted diff), nothing runs until you approve
node scripts/meme-opt/optimize.mjs --set 4 --images <id> \
  --pin-recognize scripts/meme-opt/pins/henry-danger-laptop.json --interactive
```

`--interactive` serves the live report at http://localhost:5099 (auto-opens).
Each cycle: read the memes → write what's wrong with the jokes → **Suggest**
→ review GPT-5.5's proposal with added/removed text highlighted → **Approve &
run**, **Ask again** with more feedback, or **Discard**. The model **triages
your feedback first**: a one-off bad caption → it recommends a rerun instead
of a revision; a recurring pattern → the minimal revision encoding the
structural rule; guidance about how to revise ("stop adding examples") → a
standing constraint, never prompt text. Approved critiques are stored in
`state.json` and fed to every later improver call as standing guidance, so
your taste accumulates. Proposals that would fail the automated loop's
validators (growth, copied captions, long lists, community mentions) show a
warning next to the Apply button. Works with or without `--pin-recognize`
(revises the pinned JSON or the prompt amendment respectively). Ctrl-C the
terminal when done — everything is saved after each round.

Reads `OPENAI_API_KEY` and the Supabase URL/anon key from the repo's `.env`.
No login and no dev server needed.

Options: `--rounds N` (default 4), `--holdout 0.3`, `--images id,id`,
`--flavor 1513`, `--improver-model gpt-5-2025-08-07`, `--concurrency 6`,
`--include-naive`, `--name my-run`. Cost: ~8 OpenAI calls per meme per round
(1 recognize + 1 context + 3 captions + 3 judge calls).

## How a round works

1. Run the full 1513 pipeline for every meme with the current prompt
   (baseline = exactly what the ops page runs today).
2. The improver model sees the batch's meme verdicts, captions, judge
   failures, and a **hypothesis ledger** of every change already tried (with
   its verdict), then proposes **one hypothesis per round**: a single edit
   operation on the prompt amendment (add/edit/delete one line), or in pinned
   mode 1–4 **coupled** field operations — because a rule change and the
   examples that demonstrate it must move together (stale examples that
   contradict a rule are worse than none; caption writers imitate examples
   over rules). The code applies the operations; wholesale rewrites are
   structurally impossible.
   **Richness in FORM is encouraged** (a `caption_rule` completion test,
   `good_setups` fill-in-the-blank frames, `avoid_patterns` syntactic
   anti-frames, `do_not_match` conditions, `example_captions` categorized by
   generic domain — see `pins/ukulele-apology-GOOD.json` for the reference
   shape). **Richness in CONTENT is banned and enforced mechanically**:
   copying 5+ consecutive words from any batch caption, Columbia/Barnard/CU
   mentions, any topics-steering field, >120 words (+40/round) in prompt mode,
   or JSON growth beyond +2500 chars/round (10k total) → auto-rejected, two
   repair attempts, then the round is skipped.
3. Re-run and compare: accepted only if the train-set mean alignment improves
   AND the held-out memes (~30%, never shown to the improver as tuning
   targets) don't get worse. Rejected rounds revert to the previous best.
   Prompt size is reported per round next to the score, so growth is visible
   as a cost; the run ends with the full hypothesis ledger (what was tried,
   what worked).

## Inspecting results

Each run writes `scripts/meme-opt/runs/<name>/`:

- **`report.html`** — open in a browser (updates after every round, so you can
  watch a live run). Score-trend chart, per-round tabs, and a card per meme
  with the image, each caption, its alignment score, the judge's reason, and
  the raw recognize output. The winning amendment has a copy button.
- **`state.json`** — everything, machine-readable.
  Rebuild the report from it with `node scripts/meme-opt/report.mjs runs/<name>`.

To **adopt** a winning amendment, paste it at the *end* of step 1's
(Recognize content) user prompt in the flavor editor — it's additive, nothing
above it changes. The script never writes to the database.

## Caveats

- The alignment judge is itself an LLM — the holdout split and your own eyes
  (the report) are the guard against the optimizer gaming the judge.
- Caption steps run at temperature 0.7, so scores wobble a little between
  rounds; that's why acceptance requires a margin, not any positive delta.
- The pipeline (prompts, models, temperatures) is mirrored from
  `OP_SPECS_1513` in `ops-client.tsx`. If you change the pipeline there,
  update `pipeline.mjs` to match.
