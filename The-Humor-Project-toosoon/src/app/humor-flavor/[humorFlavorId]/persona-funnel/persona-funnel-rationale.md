# Persona Premise Funnel — design rationale

Parallel rationale page for `/humor-flavor/[id]/persona-funnel`, per the
ui-design rule that every designed page records the information that guided
its generation.

## Who and what for

**A humor-flavor designer comes to this page to turn one campus moment into
several genuinely different jokes, and to see where a joke came from well
enough to tell whether it is different from the last one.**

That second half is the reason this page exists separately from
`/pov-jokes`. Both pages take one moment and nothing else. The difference is
the unit of work:

| | POV Joke Maker (flavor 1552) | Persona Premise Funnel (flavor 1553) |
|---|---|---|
| Step 1 returns | a roster of selected personas | a whole derivation, ending in premises |
| Unit of work | one persona | one **premise** |
| Step 2 is asked to | find five different comic angles | write five executions of ONE given premise |
| Diversity is established | inside step 2, per persona | upstream in step 1, across premises |

Keeping 1552 untouched is deliberate: it is the control. The two flavors are
run against the same moment and compared.

## The failure this page is built around

A persona whose name contains the joke — "the bar manager who sees the lead
change" — can only tell one joke. Step 2 then writes five captions that are
five wordings of it. Step 1's new prompt attacks this by separating

    persona → moment → activation → processing path → core comic idea

and by deduplicating premises on the joke mechanism underneath them rather
than their wording, so "put the bottles on a shot clock" and "swap glass for
plastic" collapse into one premise instead of counting as two.

That is only worth doing if the premise survives into step 2. So the premise
is the thing this page names, counts, checks, links to, and runs — and step
2's prompt was changed to be told which premise it is executing rather than
being left to pick one.

## Conceptual groups, and the sub-goal each serves

1. **Describe the moment you want jokes about** — the only input. Sub-goal:
   say what happened, and optionally which recurring personas to scan.
2. **Choose which comic premises get written into captions** — sub-goal:
   decide what to spend money on. Step 1 returns roughly 3-5 premises for
   each of 3-5 personas, so 9-25 possible step-2 calls. Nothing runs until
   checked and pressed. Grouped by persona, because "which persona is this"
   is how a designer navigates, but **checked and run per premise**, because
   that is what a call actually is.
3. **Read the captions each premise produced** — sub-goal: judge the
   captions. Each block restates the premise above the captions, so the
   question "did these five execute the premise, or wander off it?" can be
   answered without scrolling back to section 2.
4. **Keep the captions worth using** — unchanged from /pov-jokes: favorites
   survive clearing a run, and each can be simplified or given an image.
5. **Reference: how step 1 narrowed the moment down** — not runnable. The
   moments, every persona candidate with how far it got, and the premises
   thrown away as duplicates. Sub-goal: tell whether a persona was missed or
   correctly dropped, and whether the dedup pass was right.

## What was marked important, and how

- **The premise text is the largest thing in each section-2 row** — larger
  than the persona's own scores and processing rule. It is what is being
  chosen.
- **Section 1 leads with the count of premises**, then a single sentence
  describing the whole funnel in numbers (moments scanned, candidates,
  raw premises written, duplicates thrown away). The funnel's shape is the
  claim this prompt makes, so it is stated as a result rather than left to
  be reconstructed from the raw JSON.
- **Grayscale-safe**: hierarchy is carried by size, weight, and whitespace.
  Amber is used only for the three failure states (storage failed, invalid
  JSON, stale prompt), consistent with the rest of the app.
- **The sidebar nests three levels** — section → persona → premise — because
  a run with five personas has up to twenty-five premises and the page is
  far longer than one screen. `PageNav` was made recursive here; the
  /pov-jokes copy is still two levels.
- **"Clear the last run and start a new moment" is at the top of the page and
  the top of the sidebar** (2026-09-05, same change as /pov-jokes). It had
  been a text link at the end of section 1, which Lydia could not find. The
  sidebar copy is always on screen; the page-top copy covers narrow widths
  where the sidebar is hidden. Clearing now also empties the moment and its
  context, since clearing means "ready for a new moment"; saved captions in
  step 4 are untouched. Disabled, with a sentence saying so, when nothing is
  on the page to clear.

## Mechanical checks built into the page

These exist because prose rules in a prompt drift and code does not.

- **Score totals are recomputed, never trusted.** Step 1 is asked for a
  total that is the sum of five components. The first version of the prompt
  wrote that formula with `*` between the components (a markdown bullet
  artifact), which a model can read as multiplication. The page shows its own
  sum and says so explicitly when the model's number disagrees.
- **Broken ID references are counted and listed.** The whole output is
  id-referenced, so a `selected_idea_ids` entry naming an idea that was never
  written means part of the derivation is unreadable. Section 1 says how many
  and which, rather than silently rendering fewer premises.
- **Caption ids are keyed on the premise, not the persona.** One persona now
  produces several premises and each writes an "execution 1", so a
  persona-keyed caption id would collide and let one premise's caption
  overwrite another's saved favorite or image search.
- **An empty "premises thrown away as duplicates" list is called out** as
  probably meaning the dedup pass did not run, rather than shown as an
  innocuous empty state.

## Prompt changes this page depends on

Flavor **1553**, a copy of 1552.

- **Step 1 (id 3434)** — replaced with the funnel prompt. Installed with
  three corrections to the pasted version: the score formulas rewritten as
  explicit sums (they used `*` between components), two stray code fences
  removed from inside the JSON schema (which made the schema itself
  unparseable), and one line added to STEP 10 saying that a processing path
  may legitimately yield zero ideas, since a persona can have up to sixteen
  paths but only about eight ideas.
- **Step 2 (id 3435)** — additive edit plus one revision. Added a
  `{{COMIC_IDEA}}` input and a short block fixing the assigned premise.
  Revised STEP 11 and validation item 4, which previously demanded five
  *different comic angles* — directly contradictory once the premise is
  given. They now ask for five different **executions** of the one premise,
  with a wrong/right pair distinguishing the two.
- Steps 3 and 4 are unchanged and still run per caption.

## Reused rather than copied

`klipy-actions.ts`, `klipy-types.ts`, `pov-jokes-store.ts`, and
`load-data.ts` are imported from the `/pov-jokes` folder. They are
infrastructure — GIF search, IndexedDB, and the flavor/steps loader — and
identical for both surfaces, so a bug fixed in one should not need fixing
twice. The client component is a genuine copy, because almost every part of
it that touches step 1's shape had to change.

## Open questions for the designer

1. **Two rules from the original CRITICAL HUMOR PRINCIPLES are still absent**
   from step 1: "preserve the emotional truth of genuinely affected groups —
   do not manufacture malicious motives simply because the system needs
   humor," and "do not require a strong political opinion." Restoring them is
   her call; flagged, not done.
2. **Nothing forces the supplied persona library to be considered.** STEP 3
   says to include recurring personas "that appear relevant," so the model
   can silently drop one. The old prompt required every supplied persona to
   be evaluated and reported.
3. **`actual_premise_diversity` is emitted in two places** — on the persona
   and in `persona_premise_selections` — which breaks the prompt's own
   "exactly one canonical location" rule. Harmless while they agree; the page
   prefers the persona's copy and falls back to the selection's.
4. **Output size is the main risk to watch.** The token budget is 60,000 and
   the failure mode is a truncated run showing as invalid JSON. Section 1
   says so explicitly when that happens.
