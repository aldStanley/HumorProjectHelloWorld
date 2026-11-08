# Moment analysis prompts

One folder per analysis, holding one markdown file per version,
`<slug>-<YYYY-MM-DD>.md`. The Reaction Joke Maker uses the NEWEST file in
each folder; older files stay as history. Two on one day: suffix a letter
(`-2026-09-08b.md`).

Folders the page knows:

- `student-read/` — the Student Read: what students are collectively doing,
  feeling, and risking in a moment. Runs once per selected moment, right
  after the moments are picked, with `{{EVENT}}` filled with the moment.
  Returns strict JSON; the page renders every field it returns, known
  fields with their own labels and layout, unknown fields generically.

- `comic-moves/` — the catalog of known comic moves (name, mechanism,
  one illustration, the checks an editor runs). Fills `{{COMIC_MOVES}}` in
  the joke analyzer (step 3 of a flavor that has one) and the joke refiner
  (step 4). Never sent to the joke writer. Grows by hand, from what the
  premise discovery proposes and Lydia accepts.
- `premise-discovery/` — reads hearted jokes with their analyses and
  proposes candidate premise types (three or more hearted examples each).
  Run by `scripts/reaction-jokes-hearts-analysis.mjs --propose`; nothing is
  added to the catalog automatically.

A file's first level-1 heading names the analysis. Everything after it is
the prompt, sent as written.
