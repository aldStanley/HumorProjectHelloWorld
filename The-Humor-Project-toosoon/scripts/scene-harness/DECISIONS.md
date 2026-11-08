# Multi-person scene jokes — decisions that have settled

(as of 2026-07-11; excludes anything still being tuned)

## 1. The scene track is its own flavor: 1534 (`scene-track-harness`)

The multi-person scene pipeline was split out of 1528 into flavor 1534 — just
the scene track, renumbered S1–S8: plain visual read → scene graph → viewer
stance → viewer alignment → role casting → caption writer → extraction.
Why: scene prompts can now be tweaked in isolation (no interleaving with the
metaphor track), and the step numbering is stable so tooling doesn't chase
renumbered steps.

## 2. gemini-2.5-pro is the scene model

Decided by a faceoff on the 4 test images: gemini-3.5-flash vs gemini-2.5-pro
vs gpt-5.5 on the scene steps, with everything downstream held identical, run
all the way to finished jokes. gemini-2.5-pro read the scenes best, and it is
now the DB default for S2 (scene graph) and S3 (stance) in flavor 1534.

Extended 2026-07-12 to the S1 plain visual read on BOTH flavors (1528 and
1534): on the star-&-sponge image, flash misread the gaze ("exchanging a
glance at one another"), which licensed a wrong judge/judged physical analog
downstream; 2.5-pro correctly read "looking in the same direction at
something off-screen," and the analog fixed itself on the next harness run.

## 3. Scene changes are evaluated with a standing harness, end-to-end

`node scripts/scene-harness/harness.mjs` runs the whole flavor once per
scene-model variant and builds a side-by-side page (`faceoff-1534.html`)
with each column's jokes at the top. Two design choices that proved out:

- **Vary one thing.** Only the scene steps change per column; every other
  step runs exactly as the flavor configures it, so differences in the final
  jokes are attributable to the scene model (or the prompt being tweaked).
- **Judge the jokes, not the judge.** The pipeline's internal alignment
  scores were saturated (0.89–0.92 across all models) and don't discriminate;
  the instrument is a human reading the final captions side by side.

## 4. Iteration is cheap by construction

Every LLM call is cached by a content hash (model + fully substituted
prompts + image). Editing one prompt invalidates exactly that step and its
downstream — nothing else is re-billed, and a crashed run resumes from cache.
The working loop: edit a prompt on flavor 1534 in the flavor editor → rerun
the harness → read the new jokes.
