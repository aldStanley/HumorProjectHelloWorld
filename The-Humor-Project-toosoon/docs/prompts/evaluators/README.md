# Joke evaluator prompts

One folder per persona, named exactly like the persona's folder in
`../personas/` (`07-sad-girl`), holding one markdown file per version,
`<slug>-<YYYY-MM-DD>.md`. The Reaction Joke Maker uses the NEWEST file in
each folder to score that persona's jokes, one call per joke; older files
stay as history. A persona with no folder here has no scoring step.

A file's first level-1 heading names the evaluator. Everything after it is
the prompt, sent as written, with these placeholders filled by the page:

- `{{EVENT}}` — the moment the joke reacts to
- `{{JOKE}}` — the one joke being scored

The prompt must return strict JSON in the shape the page reads: `analysis`,
`criteria` (each with `score` and `reason`), `score`, `rating`, `reason`,
`failure_flags`. See the Sad Girl evaluator for the full shape.

Folders so far: `07-sad-girl`, `03-gigachad`. To adapt an evaluator to a
new persona, keep the four generic dimensions (topic clarity, event
fidelity, simplicity and immediacy, comic strength), the formula, the
bands, the caps, and the JSON shape; rewrite the three persona dimensions,
the mechanism enum, and the persona-specific failure flags from the
persona's voice file. Its negatives ("never in on the joke") become flags
that cap the score. The page needs no code change: criteria keys render
under their own names.

To revise an evaluator: add a newer dated file beside the old one. Two on
one day: suffix a letter (`-2026-09-08b.md`).
