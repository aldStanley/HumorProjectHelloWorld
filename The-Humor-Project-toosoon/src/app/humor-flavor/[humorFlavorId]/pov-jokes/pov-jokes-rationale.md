# POV Joke Maker — design rationale

Parallel rationale page for `/humor-flavor/[id]/pov-jokes`. Everything that
guided the layout lives here, not in the component.

## Who comes here, and what for

**A humor researcher comes to this page to take one campus moment, see which
points of view are worth joking from, and then — only for the points of view
she picks — generate and read a full joke analysis for each.**

The defining constraint she stated: *"Take all the POVs from step 1 and have
the ability to run step 2 on them. But don't run it until I say so, because
there are a lot of them."* Step 2 costing one call per point of view is not an
implementation detail — it is the reason the page has a middle section at all.
A page that ran step 2 automatically would be the wrong page.

## What the flavor is

Flavor **1552** (`1552-lydia-8-15-26-pov-jokes`), two steps, both on
**GPT-5.6 Sol** (`gpt-5.6-sol`, OpenAI) at **high** reasoning effort:

- **S1 — Find the POVs worth joking from.** One call per moment. Scores every
  supplied recurring persona, discovers event-native and narrow-lens personas,
  and returns a strict JSON object whose `selected_personas` array is the
  roster. Its JSON contract exists explicitly so each entry can be handed
  straight to S2.
- **S2 — Make jokes from ONE POV.** One call per point of view. Inhabits the
  persona, finds its processing rule and comic contradiction, and produces five
  scored joke angles plus a best caption.

The moment is the only input. There is no image anywhere in this flavor, which
is why the surface passes `imageId: null` to the shared step runner.

## Conceptual groups, and the sub-goal each serves

Numbered section cards, in the order the work happens, separated by whitespace
rather than borders.

1. **"Describe the moment you want jokes about"** — *sub-goal: supply the one
   input and start the cheap step.* The moment textarea is the largest field on
   the page because it is the only thing the page truly requires. Optional
   event context and the recurring persona library sit under it; the library is
   collapsed by default, because it is a stable default she rarely edits and
   showing it would compete with the moment for attention. A second collapsed
   disclosure, "Or pick a moment from an archived Sidechat clustering"
   (2026-09-05), lists every clustering the Sidechat Event Clusters tool has
   archived, loads one with no model calls, and shows its events as numbered
   headings with the reaction groups beneath; "Use this moment" puts the
   shared chunker's text (event, reaction, loudest posts verbatim with
   upvotes) into the moment box. It reuses `sidechat-moments.ts`, so a moment
   picked here is byte-identical to the same moment on the reverse surfaces
   — one code path for what a Sidechat moment is. It is a disclosure rather
   than always-open because a loaded clustering is several screens of events,
   and it lives in `sidechat-moment-picker.tsx` so this file does not grow. After a run, this
   section also shows what step 1 understood the moment to be and the comic
   affordances it extracted — that belongs here, not in a separate group,
   because it is feedback on *this* input. **Revised after first use:** that
   feedback was originally expanded by default, and a moment produced eleven
   comic affordances — an eleven-item list sitting directly under the button,
   which read as the answer. It is now collapsed behind a summary that says it
   is background, and a single large sentence states the actual result ("Step 1
   found N points of view worth joking from") with a link into section 2. The
   rule this cost: *the answer goes where the eye lands after the button; the
   model's working-out is collapsed below it, however interesting it is.*

2. **"Choose which points of view get the full joke treatment"** — *sub-goal:
   decide where to spend the expensive calls.* Each point of view shows the
   information needed to make that decision and nothing else: its score out of
   15 with the five components spelled out, where it came from (library,
   event-native, or narrow-lens), how it reads the moment, the tension powering
   the joke, what ends up ridiculous, and why step 1 thinks it is promising.
   Per-point-of-view "Write jokes" buttons plus checkboxes and a "Write jokes
   for the N I checked" button — the default she asked for. Every run status is
   a full sentence ("Not run yet.", "Waiting for a free slot…") rather than a
   colored dot needing a legend.

3. **"Read the jokes each point of view produced"** — *sub-goal: read the
   output and judge the captions.* One block per point of view actually run, in
   the roster's order. Now that S2 returns JSON, the block leads with the
   caption that point of view picked as best — set in the largest type on the
   page, because the caption is the thing being judged — then all five
   captions with the angle each takes, the image each wants, and its score out
   of 25. The persona machinery that produced them is collapsed behind "Show
   the comic machinery behind these captions", and stays collapsed after a run
   finishes: same rule as section 1, the answer is never buried under the
   working-out.

4. **"Review the points of view step 1 considered but did not select"** —
   *sub-goal: judge whether the roster is trustworthy.* Rejected personas,
   every library persona's score, and the coverage check. Entirely collapsed
   and marked "Reference", with an explicit sentence saying nothing in it can
   be run — it answers a question about section 2 rather than being a step.

## What is marked important, and how

Importance is carried by size, weight, and whitespace; no color is doing
hierarchy work. In grayscale the reading order still holds.

- The two actions that cost money — "Find the points of view worth joking
  from" and "Write jokes for the N points of view I checked" — are the only
  large buttons, left-aligned at the start of their row.
- Point-of-view names are the largest text inside section 2; the score is
  bolded inside an otherwise muted sentence.
- Every heading and label is subject–verb–object. "Points of view", never
  "POVs" as a bare label; "Write jokes from this point of view", never "Run".
- Each section opens with a goal sentence, and each states its scope (section
  3's blocks are per point of view; section 4 applies to section 2's list).
- A saved caption says so in two places (2026-09-05, after Lydia could not
  tell from a card that its caption was already saved). Until then the only
  signal was the save button's label flipping to "Remove this caption from
  the saved ones", which reads as an action, not a state. Now the card's
  kicker gains "· saved" in ink rather than muted, and a bold full-sentence
  line sits above the action buttons — "✓ Saved. This caption is in step 4,
  'Keep the captions worth using'. Jump to it" — linking to the caption's
  entry there. Weight and a sentence carry the state; no color is added.

## Every step's full output is available in the Flavor Maker's structured view

Added 2026-09-05. Lydia asked to see outputs "displayed, organized and
scored, like I do in sad girl flavors" and pointed at S11 on the Flavor Maker —
the shared `JsonTree`: every key an uppercase label, lists of like objects as a
comparison table with one column per item, scores in colour. This page used to
show raw JSON only as a `<pre>`, and only for step 1.

- **Where.** Step 1: "Show everything step 1 returned, laid out field by
  field" replaces the raw-JSON toggle. Each step-2 block (both shapes): a
  collapsed "Show everything step 2 returned…" is the FIRST thing in the
  block, so it is findable, but closed, so the picked caption or ranking
  still reads as the answer. Step 3: the image-concept result is drawn this
  way outright. Step 2 output the page cannot classify falls back to this
  view instead of raw text.
- **One component.** `StructuredOutput` in `pov-jokes-ui.tsx` parses the
  text (code fences tolerated), draws `JsonTree`, and offers a copy-raw
  button; non-JSON falls back to the text. Both surfaces that share the UI
  file get it.
- **Why collapsed, not default.** A full step-2 output is several screens.
  The Flavor Maker shows it by default because that page has nothing else;
  here the caption is the thing being judged and keeps the top slot.

## Navigating a page this long

The page runs many screens once several points of view have been run, so a
sticky sidebar carries a nested table of contents: the four sections at the
top level, and beneath sections 2 and 3, every individual point of view. It is
generated from state, so it grows as step 1 and step 2 produce things, and
each entry carries a short status ("7 found, 3 checked", "jokes written", "not
run yet") — which makes the nav double as a map of where the work stands.
Hidden below `lg`, where the page is one narrow column and scrolling is the
navigation.

**"Clear the last run and start a new moment" sits at the top of the page and
at the top of the outline** (2026-09-05). It used to be only a text link at
the end of section 1, after step 1's whole read of the moment — Lydia could
not find it ("it's at the end of a long ass section"). Now the same action is
a button above step 1 and the first thing in the sidebar, which is always on
screen; the in-section link stays for anyone reading there. Clearing now also
empties the moment and its context, because clearing means "ready for a new
moment", not "re-run this one"; saved captions are untouched, as before. The
button is disabled, with a sentence saying so, when there is nothing to clear.

## Section 3 leads with every joke ranked, then the per-point-of-view blocks

Added 2026-09-05, after Lydia asked to see step 2's outputs "displayed,
organized and scored, like I do in sad girl flavors" — meaning the sad-girl
flavors' "Rank all jokes" fan-in on the Flavor Maker, where every caption from
every branch is one list, best first, each score visible.

- **What it is.** `all-jokes-ranked.tsx` flattens every finished step-2 run on
  the page into one ranked list at the top of section 3: rank numeral in the
  gutter, caption largest, point of view and angle as the quiet kicker, bold
  total over its maximum, then the per-dimension scores in words. Each row
  has the same save button as the card it came from and a link to the block
  of the point of view that wrote it. Top 10 by default, expandable.
- **No model call.** It is drawn from output already on the page, so it
  costs nothing and appears the moment a run finishes. Both step-2 shapes
  contribute — persona-roster candidates (out of 25) and premise-first
  executions and wildcards (out of 30) — and sort by fraction of maximum, so
  a mixed page still orders sensibly.
- **The caveat is on the page.** The scores are self-scores given in separate
  calls, one per point of view, so two 24s were never judged side by side.
  The goal text says to treat the order as a shortlist to read, not a
  verdict — the same weakness the sad-girl notes record (self-scores
  saturate). An independent judge step would be the next lever, not built.
- **Answer before working-out.** The ranked list is the answer; the
  per-point-of-view blocks below it are the reasoning, now introduced by a
  quiet heading saying they are the same jokes. It has its own outline entry.

## Making repeated items distinguishable

First version of the caption list failed on this: five captions rendered at
nearly the same type size in the same muted color, with the explanation prose
physically larger than the caption it explained. Nothing caught the eye and
the items ran together. The fixes, all structural rather than color:

- A **large numeral in a left gutter** per caption — dark for the one the
  model picked as best, light for the rest. This is what separates items.
- The **caption is the largest thing in the row** (`text-xl`), since it is
  what is being judged; the winning caption above the list is larger still.
- The explanation moved into a definition list — **quiet uppercase label,
  normal-weight dark value**. It had been the reverse (dark bold label, muted
  value), which is what made every line look the same.
- The score leads with the **number set large and dark** (`24 / 25`), with the
  five components trailing quietly.
- **Item gaps far exceed line gaps** (`space-y-12` between captions).

Both of these are now rules 7 and the repeated-items entry in the `ui-design`
skill, so they apply to every page and not just this one.

## The optional per-caption steps (S3 and S4)

Steps 3 and 4 are not stages of the pipeline — they are things you can do to
**one caption you are already looking at**, so neither has a section of its
own. Both hang off the caption itself, in section 3 and again on every saved
caption in section 4, and both are disabled rather than hidden when the flavor
does not have that step.

- **S3, "Find images to search for this caption"**, turns a caption into
  GIF-searchable concepts plus the queries to find them. Its output is shown
  **as the Flavor Maker shows any step's JSON** (2026-09-05, at Lydia's
  request, pointing at S11 on the sad-girl flavor): the shared `JsonTree` —
  every key an uppercase label, the list of concepts as a comparison table
  with one column per concept, scores in colour, nothing summarised away.
  The earlier hand-built layout (recommended concept large, then a ranked
  list, then the analysis collapsed) hid fields and was replaced, not kept
  alongside. The recommended concept's search terms stay as click-to-copy
  chips above the tree, since they are what gets pasted into a search.
- **S4, "Simplify this caption"** (added 2026-08-15), keeps the comic core and
  writes eight shorter versions of it, from light compression through
  meme-native rewrites to a minimal one, each scored out of 25.

They share one thing mechanically: the same `{{JOKE_OUTPUT}}` payload — the
caption plus everything step 2 said around it, with missing pieces sent as
`null` rather than dropped, so the prompt can see what context it did not get.
One `runCaptionStep` runs both; they differ only in which step row, which
cache, and which prompt hash they use.

S4's output follows the same rule as every other block on this page: the
**three picks lead** ("The one to use", "The simplest that still works", "The
shortest if the image carries the reaction"), the first of them in the largest
type, and only then the full list of eight and — collapsed — what the model
decided was the joke versus what it decided was machinery. Word counts are
**recomputed from the caption** rather than trusted from the model's own
`word_count` field. Any simplified version can be saved into section 4; it
keeps the id of the caption it was cut from (`persona#3~simplified-6`) and is
labelled with it, so a shorter rewrite never loses track of its original.

## Pairing a GIF with a saved caption

Every saved caption has a paste box for the embed code from the GIF you found
(KLIPY, GIPHY, Tenor). Once pasted, the caption and the GIF render together as
a `<figure>` — caption above, image directly beneath, nothing else inside the
frame. That composed pair is the artifact the whole page has been building
toward, so it gets the largest treatment in section 4.

**Pasting a klipy.com embed does not work, so the page searches instead.**
`https://klipy.com/gifs/<slug>/player` answers `403` with
`x-frame-options: SAMEORIGIN` — it refuses to be shown inside another site,
which is what "klipy.com refused to connect" means. KLIPY also has no
slug-lookup endpoint (`gifs/<slug>` 403, `gifs/slug/<slug>` 204,
`gifs/view/<slug>` 404), so a pasted page URL cannot be resolved to a usable
file either. What does work is the search API's direct `static.klipy.com`
URLs: `200`, `content-type: image/gif`, `access-control-allow-origin: *`.

So every saved caption gets a KLIPY search instead, seeded with **step 3's own
search terms for that caption as one-click buttons** — which is what finally
joins the two steps up: step 3 works out what to search for, this searches for
it, and choosing a result stores a direct file URL that actually displays. The
paste box stays for direct image links and other hosts, and now says plainly
that a `/player` embed will not display.

**The pasted markup is never rendered.** The parser pulls the `src` out, checks
its host against an allowlist, and the page builds its own element around it.
Injecting pasted HTML would hand anything in that string — scripts, event
handlers, an iframe pointing anywhere — a place on the page. Extracting only
the address means a paste carrying `onerror="…"` loses it on the way in. The
iframe is additionally sandboxed and sent with `referrerPolicy="no-referrer"`.

Two things the parser gets right that the first version did not, both caught
by testing it against her actual paste rather than an imagined one:

- **Attribute values containing an apostrophe.** A single `["']([^"']*)["']`
  pattern stops at the first `'`, which truncated
  `title="Family Guy: Peter Griffin's Living Room Mayhem"` to "Family Guy:
  Peter Griffin". Double- and single-quoted forms are now matched separately.
- **`.mp4` and `.webm` are video, not images.** KLIPY serves both; routing
  them into an `<img>` renders nothing. Direct media URLs become `<img>` or an
  autoplaying muted `<video>` by extension; everything else becomes an iframe.

## Decisions worth knowing

- **Prompts stay verbatim in the DB.** They use `{{EVENT}}`-style placeholders,
  not the pipeline's `${...}` convention. The surface fills them before calling
  the shared runner, so the shared `${...}` resolver never sees them. Editing
  the prompts is done in the DB, not here.
- **Reasoning effort is a property of this surface**, hardcoded to `high`.
  `humor_flavor_steps` has no effort column; adding one is the right move only
  if she wants it to vary per step.
- **Three concurrent step-2 calls.** Enough to make a batch of eight quick,
  low enough to stay under rate limits and to keep a failure legible.
- **Results survive a reload** via `localStorage`, keyed by flavor — the
  moment, the context, the persona library, step 1's output, every per-POV
  step 2 output, and every per-caption step 3 and step 4 output. Losing an eight-call batch to an accidental refresh was the
  failure mode worth preventing; nothing is written to the database yet.
  Three things this needs to be trustworthy rather than merely present:
  - **A call in flight when the page goes away is restored as a failure**, not
    as "running". Restoring it as running left `anyRunning` true forever, which
    disabled every button on the page — a cache that silently bricks the UI
    reads as a cache that does not work.
  - **The restore is stated, not silent.** "Generated <date>. This page keeps
    your latest run in this browser, so a reload does not cost you a re-run",
    with a "Clear the saved run" button beside it. Cached state that appears
    without explanation is indistinguishable from stale state.
  - **A payload without step-1 output must never replace a stored one that
    has it.** This is the failure that actually happened: the 60 KB stored run
    was found overwritten by a ~2 KB stub holding only the moment and the
    persona library. The save effect fired on every state change, so any
    moment when step-1 output was absent from memory — an explicit clear, a
    restore that produced nothing — immediately wrote a stub over the real
    thing. Explicit clearing still works because `clearSavedRun` removes the
    key first, leaving nothing to protect. Guarded and unit-checked against
    six cases, including "corrupt blob is replaceable, not a permanent brick".
  - **The store is IndexedDB, not localStorage.** localStorage turned out to
    be the wrong home: its ~5 MB cap is shared by the WHOLE origin, so every
    other surface in this app competes for the same budget, and a real run
    (step 1 plus eight step-2 outputs plus the per-caption step 3 and 4
    results) hit `QuotaExceededError` — meaning an expensive multi-call run
    could not be saved at all. IndexedDB's quota is a large fraction of free
    disk. `pov-jokes-store.ts` wraps it; anything left in localStorage is
    migrated in on first load and then deleted, which also hands that space
    back to the surfaces still using it. Writes are debounced 400 ms, because
    typing in the moment box would otherwise fire one per keystroke.
  - **Storage failures are reported, never swallowed.** Both the read and the
    write used bare `catch {}`, which made "the browser refused to store this"
    (`QuotaExceededError`) look exactly like "you never ran anything" — the
    page keeps working and you only discover the loss on reload. Section 1 now
    states what storage did: nothing found, found but unreadable, found but
    without a run, or could not be written and why.
  - **Staleness is detected, not assumed.** Each cached output stores a
    `promptHash` of the prompt that produced it (reusing `@/utils/prompt-hash`,
    the same mechanism the reverse surface uses for reaction profiles). When
    the step's prompt in the DB no longer hashes the same, the page says so and
    tells you to re-run. Prompts here change often; a cache with no staleness
    signal would quietly show output from a prompt that no longer exists.
- **A new step-1 run clears the picks and the jokes.** A roster and the jokes
  written from a different roster must never be shown together.

## The premise-first architecture (flavor 1554, 2026-08-16)

Flavor **1554** (`1554-lydia-8-16-26-premise-first-pov-jokes-from-1552`) is the
same four steps rebuilt around a different unit of work. 1552 is untouched and
still runs; this surface serves both, deciding which it is looking at from
step 1's output rather than from a flag.

**What changed and why.** Step 1 now discovers premises, not just personas: it
decomposes the event into moments, maps personas onto them, and returns
normalized tables — `personas`, `moments`, `activations`, `processing_paths`,
`ideas` — joined by id. The first draft of step 2 was handed all of it and
told to resolve `idea → activation → moment` and `idea → path` itself, five
times over. That is a join, and a model that gets a join wrong does not
error — it produces a fluent joke about a moment that was never in the data.

So the join moved into `resolve-premises.ts`, and step 2 now receives a flat
`{persona, premises[]}` object with nothing left to look up. The rule this
encodes: **the storage schema and the prompt payload are different
representations and do not have to be the same one.** Normalized is right for
storage; denormalized-for-this-exact-task is right for a prompt.

Every hop that fails is recorded as a `problem` string and shown — section 1
lists what could not be read out of step 1's output, and a premise that lost
its moment still runs, thinner, saying so. `FIELD_NAMES` at the top of the
resolver is the written-down contract; when step 1's field names change, that
constant is the only edit. `scripts/check-premise-resolver.mjs` golden-tests
all of it against a fixture, including the broken-hop cases.

**The premise is the unit of cost; the persona is the unit of browsing.**
Section 2 keeps persona checkboxes, and underneath each persona lists its
premises, **all ticked by default**. Someone who does not care about this
level picks a persona and presses go, exactly as before. Someone who sees a
weak or repetitive premise unticks it before paying for two captions. The
button counts what it will actually cost — premises, not personas — and a
persona with everything unticked is not runnable.

**One ranking, and it is the answer.** Step 2 writes exactly two executions per
premise and selects exactly one winner from each, so `ranked_finalists` cannot
contain two rewrites of the same joke. That makes the ranking itself the
deliverable, so it leads the block with rank 1 set largest; both executions per
premise, and why one won, collapse underneath. Diversity is arithmetic here,
not an instruction — the old "produce 5 distinct captions, they should NOT be
wording variations" was an adjective, and adjectives drift.

**Prompt decisions worth keeping.** The output contract is a *field
specification*, not a fake JSON instance, because `"word_count": "<integer>"`
visually teaches the wrong type however clearly the prose says integer; one
small correctly-typed example follows it, and a checklist line requires JSON
numbers. Every illustration was moved off-domain — a wedding photographer, an
airport gate agent, a hardware store owner — because the previous examples
(Columbia Finance, the Knicks) were few-shot training on the exact data this
runs against. `target_clarity` came back as a sixth score, out of 30, so
"respect `likely_joke_target`" is measured rather than merely asked for; the
generic-pseudo-punchline blacklist came back for the same reason. Premise
fidelity is a rejection rule rather than a seventh score, to avoid score bloat.
Wildcards are capped at one and gated four ways: a genuinely new semantic
premise, a total above the *weakest* accepted winner (not above all of them, so
a good third-place wildcard can still exist), and 4+ on both comic tension and
persona specificity.

Two of the six field paths guessed for `FIELD_NAMES` were wrong, and the live
run is what caught them: moments are **nested under `event`** as
`event.event_moments`, not top level, and the concern is
**`activated_concerns`, a list on the activation**, not a `concern` string.
Both would have resolved to `null` on every premise — the missing moment would
have been reported, the missing concern would not. The fixture in
`check-premise-resolver.mjs` now mirrors the real contract, and
`scripts/check-premise-pipeline.mjs` runs the whole thing live (step 1 → resolve
→ step 2) because a fixture can only prove the resolver self-consistent, never
that it matches the prompt. On its first run: 5 personas, 25 premises, every
hop resolved, every authoritative field present.

`scripts/check-s2-contract.mjs` runs the prompt once against an off-domain
fixture and mechanically checks all of it — two executions per premise, one
winner each, ranking integrity, `best_overall` equal to rank 1, scores as JSON
numbers summing correctly, word counts, the wildcard gate, and illustration
leakage. It passed on the first live run. One weakness it exposed: the model
scored all three winners 29/30, so the scores are compressed at the top and the
ranking is doing less work than it looks like. Worth watching.

**The stable downstream interface.** Steps 3 and 4 now read a `joke_context`
object built by `jokeContextFrom` — persona, baseline, moment, core comic idea,
contradiction, joke target, processing path. Their prompts were given a short
additive note describing it and still accept the older flat shape, so 1552 and
1554 both feed them. A later change to step 1's schema is absorbed in one
function rather than in two more prompts.

## Open questions asked of the designer

- **Step 2's output format — resolved 2026-08-15.** She said twice that step 2
  must output JSON, but the prompt she supplied ended in headed text. Its
  `OUTPUT FORMAT` section has been replaced with a JSON contract using her own
  field names, grouped exactly as her headings grouped them (`event`,
  `persona`, `comic_relationship`, `persona_processing`, `response`, `stakes`,
  `humor_engine`, `persona_material`, `joke_candidates`, `best`). Nothing above
  that section was touched. Two mechanical checks were added because prose
  alone does not hold them: `joke_candidates` must contain exactly 5 entries,
  and `best_caption` must be copied verbatim from one of them rather than
  written fresh. The page still falls back to showing raw text if a run comes
  back unparseable.
- **Step 1's prompt was replaced at the same time** with her revised version
  (adds `student_recognizability` and `visual_potential` to the discovered
  personas, an enum-rules block, and a 13-point final validation). Her paste
  had stray Markdown code fences inside the JSON schema and three orphaned `*`
  bullets in STEP 8 — both plainly paste artifacts, both removed, nothing else
  altered. Stray fences inside a schema that says "do not use a code fence"
  are actively harmful.
- **Persistence to the database.** Currently browser-local only. Archiving runs
  the way `ops_runs` does is a natural next step if these outputs need to be
  compared across sessions.
- **The discovery prompt already existed, on flavor 1553** —
  `1553-lydia-8-16-26-persona-premise-funnel-from-1552`, written the same
  morning. Two flavors were checked for it and it was on a third; the search
  should have been the whole `humor_flavor_steps` table, which takes one query.
  Its step 1 is now installed as step 1 of 1554 and the pipeline runs end to
  end. **1553 also has its own step 2** — "write 5 captions executing ONE
  assigned comic premise", one call *per premise*, filling `{{COMIC_IDEA}}` —
  which is a different design from 1554's "one call per persona, two executions
  per premise". Both are premise-first; they differ in what one call buys. The
  surface implements 1554's. 1553's step 2 will not run here, because nothing
  fills `{{COMIC_IDEA}}` — it now fails before the call rather than sending a
  prompt with a hole in it.

## The empty-block bug, and the rule it produced

Predicted, wrongly, that a half-migrated 1554 would "render the earlier layout,
so nothing breaks". It broke, in the worst available way. With the new step 2
and the old step 1, the page chose its layout from **step 1's** schema and drew
the persona-roster block around premise-first JSON. That block renders its best
caption and its candidate list conditionally, so both vanished, no error fired,
and two personas came out as nothing but a "Show the comic machinery" toggle —
a run that had cost real money and looked like it had never happened.

Three fixes, in order of how much they matter:

1. **Draw the block that matches the output you got, not the one you expected.**
   `step2Shape` reads each job's own JSON — `premises`/`ranked_finalists` versus
   `joke_candidates`/`best` — and picks the renderer per job. Step 1's schema
   now decides only how sections 1 and 2 are drawn. The two steps are separate
   DB rows and can be edited independently, so anything that assumes they agree
   is a bug waiting for the next migration.
2. **A parsed result that no renderer recognizes says so, beside its raw JSON.**
   There is now no path where a finished job renders as nothing.
3. **The mismatch is announced before the money is spent.** Section 2 detects it
   from the prompts themselves — step 2 containing `{{PERSONA_AND_PREMISES}}`
   while step 1 returned a persona roster — and says the two steps were written
   for different pipelines. A premise-first result under a persona-roster step 1
   also carries a note that step 2 invented the premises it was not given, so
   the jokes are not mistaken for step 1's work.

The general rule, worth applying anywhere two prompt steps are versioned
separately: **render from the shape of the data in hand, and make "I do not
recognize this" a visible state.** Silence is the one outcome a page must never
have.

## The persona pays (flavor 1558, 2026-09-05)

Flavor **1558** (`1558-lydia-9-5-26-pov-jokes-persona-pays-from-1555`) is a
copy of 1555 with what the sad-girl flavors (1546) and the wannabe-bro port
(1547) already knew about making the persona the butt, ported into the two
POV prompts. 1555 is untouched and stays as the control.

**The failure it answers.** On the room-swap moment, the wannabe finance bro
scored 15/15 in step 1 and every caption 24–25/25 in step 2, and Lydia read
them as "no clear emotion, no clear criticism target." Run through 1547's
tests, none of the five scored above 0.7: the Zillow line has no persona in
it, two captions have the bro simply being *right* (a bad room is bad, swap
posters do hide things), and the judge gave "clear target 5" to every one.
The persona was a vocabulary, not a character with a flaw.

**What changed, and the rule each encodes.**

- **A pathology, not a processing rule.** The library entry was "event →
  money, leverage, status" — a function, and a function has nothing to
  expose. Each persona is now four lines with fixed labels: *wants*,
  *pretends*, *does compulsively (and pays for)*, *would never admit*. The
  gap between *pretends* and *would never admit* is what a joke exposes; the
  compulsive behaviors are how it shows on screen. Step 1 copies the four
  lines for library personas and writes them for discovered ones;
  `pretends` is `null` only for a plain functional role. The page starts
  with the pathology library when the flavor's step 1 mentions
  `persona_pathology`, read from the prompt rather than from a flag.
- **THE PRETENDS RULE, mechanical.** `pretends` not null → `comic_role` is
  `target` and `who_pays` names the persona, in step 1 and in every step 2
  caption. This replaces two hedges the old prompts carried ("Do NOT assume
  the persona is the joke target", "Do not force the persona to be the joke
  target") and the copyable `"comic_role": "persona_archetype"` schema
  constant, which named the vocabulary-substitution role. The derived
  abstraction (`pretends`) carries the constraint, so personas without a
  self-image can still be straight men.
- **who_pays with a score.** Step 1 adds `expense_fit` 0–3 (total now out of
  18; verdict thresholds moved to 14/9), with 1547's two backstops: imagining
  a win is not paying, and a secret gain moves the joke elsewhere unless the
  persona visibly pays anyway.
- **A contrast is not a tension.** "Everyone sees homes; the bro sees a
  portfolio" was the template every prompt example taught. A tension now
  has to name what the persona *wants* and what in this event *blocks* it.
- **Three mechanical caption tests.** `at_persona_expense` 1–5 runs the
  speaker-agency test (whose is the main verb), the right-call test (does
  the caption still work if the persona is simply correct), and the
  last-laugh test (whose behavior would the persona's own peers wince at).
  `target_clarity` is retested as "who is worse off, visibly, in the words."
  Every caption also carries one filmable `behavior` from
  `does_compulsively` and names `who_pays`, and never states the feeling
  word.
- **Overall is the minimum, not the sum.** `overall` is the weakest of the
  six checks, `weakest_check` says which, and `best_caption` is the highest
  `overall`. The page leads each caption's score line with that number out
  of 5 ("as its weakest check") and shows the weakest check under it; the
  ranked list sorts by it and breaks ties on the sum. Runs from the older
  flavors keep their sum-out-of-25 display, decided per caption from
  whether `overall` is present.
- **A humor checklist.** The old final validation checked entry counts and
  enum values. Seven checklist lines now restate the humor rules as FAILs,
  because prose-only rules drift and checklist rules stick.

All illustrations in both prompts are off-domain (a wannabe sommelier at a
gas station), so nothing in them can be copied into a campus caption.

## Step 1 was too slow (2026-09-05, same day)

Lydia: "finding point of view is taking too long." Measured on one room-swap
moment with the nine-persona library, one call each, seconds and output size:

| prompt | effort | seconds | output chars |
|---|---|---|---|
| 1555 control | default | 120 | 45k |
| 1558, pathologies echoed | default | 155 | 68k |
| 1558, library not echoed | default | 149 | 57k |
| 1558, library not echoed | high (what the page sent) | 211 | 61k |
| 1558 lean | high | 165 | 36k |
| 1558 lean | medium | 126 | 41k |

Two things the numbers settled. Output size is only part of it: cutting a
third of the characters bought about 45 seconds at high effort. Effort is the
other part: the same prompt at medium is 40 seconds faster still.

**What changed, and the rule each encodes.**

- **The page joins; the model does not echo.** Step 1 no longer copies the
  library's four pathology lines back out (they were output the call paid
  for, twice) and `selected_personas` is a pick list — name, source, why,
  and a pathology only for discovered personas — instead of a second copy of
  every record. `attachEvaluation` and `attachPathology` in the client join
  a pick back to its evaluation record and to the library entry by
  normalized name. Same rule as the premise resolver: *resolve joins in
  TypeScript; the prompt writes each fact once.* A roster that still repeats
  the record (older flavors) is untouched, because the pick's fields win.
- **Length is a contract.** Every prose field is one sentence of at most 25
  words, every list at most four items, stated once where the task is
  defined and again as a checklist line. The output is read by a page and a
  second prompt, not by a person.
- **Step 1 runs at medium effort; step 2 stays at high.** Effort is still a
  property of this surface, now per step (`STEP1_REASONING_EFFORT`). Step 1
  is a scoring task the researcher waits on before anything else can
  happen; step 2 writes the captions. The mechanical checks in
  `scripts/check-persona-pays.mjs` pass at medium.

Not done, and the next lever if 126s is still too long: fewer discovered
personas (the prompt asks for roughly 5–10 event-native and 3–5 narrow-lens,
and every one is a full record), which is a content decision rather than a
plumbing one.

## Self-exposure, not loss (Lydia's revision, 2026-09-05 evening)

Lydia rewrote step 1 so that `who_pays` and `expense_fit` score **pathology
payoff**: the persona's own behavior makes something ridiculous about them
visible. A literal loss is allowed only when the way it happens reveals the
pathology. Her three tests, now in the prompt and its checklist: the
incidental-consequence test (could this consequence attach unchanged to any
obsessive persona?), the self-exposure test (what is ridiculous about THIS
PERSON now?), and the remove-the-punishment test (delete the final
"misses/loses/fails" clause; if the joke survives, the punishment was
padding). She also named eight boomerang shapes (self-defeat, overreach,
social friction, ownership leak, resolution resistance, opportunism,
pretense puncture, goal corruption). The field names stay as legacy names so
nothing downstream breaks; the page's labels for them changed to "pathology
payoff" and "Who is exposed, and how". Her file was pasted with markdown
escapes; the diff against the installed prompt was checked section by
section before installing (same sections, only the intended edits). Step 2
still describes `who_pays` as the entity that loses; its own caption tests
are already about exposure, so it was left for a separate change.

## The event-native cast (flavor 1559, 2026-09-05 evening)

Lydia wrote a step 1 that starts from the event, not a library: derive the
people, roles, and institutions the event itself creates (power-holders,
spinners, implementers, affected people, beneficiaries, opportunists,
explainers, downstream casualties, witnesses), give each a four-line
pathology, find its comic contradiction, and assign a punch direction (up,
lateral, self, down). The power-holder check forces the cast to include the
responsible actor when the event has one, as POV, target, or both; the
villain's own rationale said out loud is the joke.

Flavor **1559** (`1559-lydia-9-5-26-event-native-cast-from-1558`) carries it
as step 1; step 2 is 1558's. Her file had no input placeholders and no output
schema, so an INPUT block, a LENGTH rule, a JSON contract, and a validation
list were appended; nothing of hers was reworded. The contract keeps the
page's conventions: `selected_personas` is a three-field pick list joined
back to a `candidates` array by name, the pathology is on the record (there
is no library to attach), the target is `joke_target` and the page reads it
as the roster's target field, and the top-level keys avoid `ideas` and
`personas` so the premise-first detector does not claim the output. The
score line shows this prompt's six checks (causal, event-specific,
contradiction, runway, clear target, leverage) out of 18; the card gains
"Which way the joke punches" with the search category that found the role;
the library box gives way to a sentence saying this step does not read one.
`scripts/check-event-native-cast.mjs` runs it live on an off-domain fixture
with a clear power-holder and checks the pick list, the sums, the four-line
pathologies, the punch directions, that the power-holder is in the cast, and
step 2 downstream.

## One broad character, reaction memes (flavor 1560, 2026-09-05 night)

An AI conversation Lydia brought in argued that the event-native cast is
"intellectually better, but probably worse for memes": precision makes the
jokes brittle, and for GIF humor the persona should be a comic character
with ONE obvious emotional instinct. "Columbia" is already enough of a
character; the PR writer, the one hitting renew, the one editing the sign
are manifestations of it, not separate personas. The pipeline becomes
EVENT → who should we mock → that character → what simple ridiculous
reaction are they having → caption + reaction GIF.

Flavor **1560** (`1560-lydia-9-5-26-broad-character-reaction-memes-from-1559`)
builds it. Step 1 names one to three actors worth mocking, gives each a
compact record (four-line pathology, `comic_emotion`, a 4–5 entry
`emotional_palette` where each reaction names the reaction GIF it maps to,
`manifestations`, `reusable_engine`), and scores it on mockability, event
specificity, one-idea-one-attitude, GIF-ability, and target clarity, out of
15. The page starts this flavor's library box with the compact "Columbia"
entry from that conversation; a bullet's extra sub-lines pass through to the
prompt untouched. Step 2 writes five captions, each reducing the character to
ONE palette reaction, each in one of three structures (character + behavior;
character: fake quote; character when + trigger), and scores GIF-ability
alongside the 1558 checks; `image_situation` is the GIF emotion in at most
eight words, the way a search would say it, so step 3 has a clean handoff.
Illustrations are an airline, off-domain, so "47 synonyms for closed" cannot
be copied out. The card shows the emotion, the palette with its GIFs, the
manifestations, and the engine; the score line reads "works as a GIF".
`scripts/check-broad-character.mjs` checks the pick list, the palette shape,
the sums, that a supplied character is copied rather than rewritten, that
every caption names the character on a different reaction, the eight-word
GIF limit, and the minimum-overall judge.

**Step 2 replaced with Lydia's "Punchy Reaction-Meme Captions"** (same
night). Kernel first: the model generates 8–12 one-line comic ideas, writes
five captions from distinct kernels at 5–14 words, and chooses the GIF anchor
after the joke rather than starting from a palette reaction. Observational
captions are allowed (the character need not perform the main verb), the
contradiction may be implied, and the three-structure rule is gone. Scores
are punch, compression, event_specificity, target_clarity, naturalness,
gif_ability, overall = minimum. Only a JSON contract was appended (kernels,
five candidates with the kernel as angle_name and the GIF anchor as
image_situation, best). The page shows "lands immediately" and "nothing
removable" on the score line and lists the kernels considered in the
collapsed machinery block. Note her text names Columbia in the scoring
rubric and caption guidance; on a non-Columbia character those lines read
as the example rather than the rule.

**Then the generic version** (same night): the same prompt with every
"Columbia" removed so it works for any character in the box, a longer kernel
family list, a fifth compression question, a "do not force the analysis into
the caption" section, and its own OUTPUT block. Installed verbatim. Its
kernels sit at `humor_engine.comic_kernels` and each candidate carries a
`kernel` beside `angle_name`; the page reads either location and shows the
kernel on the card when it differs from the angle name.

## Step 5 on 1560: pair every caption with an image from a set (Sep 5, 2026)

Lydia wanted something postable before the images are good: "pair each joke
with one of the images from image set 69 … lay them out so I can take a
screenshot and post on slack." So 1560 (renamed Columbia POV Reaction) gained
a fifth step and the page gained an optional section between "read the jokes"
and "the keepers".

- **One text-only call per point of view.** The prompt gets the moment, the
  persona label, the captions with the GIF note step 2 wrote for each, and
  the set's images as words (who is recognized + the first 300 characters of
  the stored description). Output is `{"pairs":[{joke_id, image_id, fit,
  why}]}`. Set 69 loads by default; any set id can be typed in.
- **Short image ids, mapped back in code.** The set's ids are UUIDs and the
  model retyped two of five wrong on the first live run, which silently
  dropped those captions. The page now sends `img-01…img-53` and maps back;
  three runs since, zero bad ids. Same pattern as the premise resolver:
  hand the prompt something it cannot mangle.
- **The poster is the deliverable.** A white box with the moment on top and a
  three-column grid of `#n` badge → square image → caption → "persona · fit".
  Ordered the way section 3 ranks (overall fraction, tiebreak sum). The
  "why" for each choice sits in a collapsed list below so the screenshot
  stays clean. Unknown ids are dropped and counted above the poster rather
  than shown as broken images.
- **Cached with the run** (`imagePairs` in the saved state), cleared with it
  and whenever step 1 reruns.

`scripts/check-image-pairs.mjs` runs step 5 live on the town-pool captions
against set 69 and checks the contract (every caption once, ids verbatim,
fit in 0..1, a why, distinct images). ~12 s per point of view at medium.

## 1561: several moments, one character (Sep 5, 2026)

Lydia: "I want to be able to select multiple moments in step 1, and we write
jokes for all of them with the one persona." 1561 is a copy of 1560 with one
prompt changed; 1560 stays the control.

- **The unit of work is the (moment, persona) pair.** A single moment is a
  list of one and takes the same path, so nothing on the page branches on
  the count except labels. Job keys: the first moment keeps the bare persona
  name (old saved runs still read); later moments append "· moment N".
- **Step 1 runs once over all moments** as a numbered list in `{{EVENT}}`
  and picks ONE character for all of them. The only prompt change is
  additive: a `per_event` array on each candidate (event number, trigger,
  joke target, 2–3 manifestations, 1–2 palette reactions copied verbatim),
  scores stay per character, and validation line 9 checks the array.
- **Steps 2 and 5 did not change.** They already take one event and one
  persona; the page fans them out over moments. Step 2 gets that moment's
  `per_event` entry laid over the cross-moment fields, so it never sees the
  other moments. Live check: captions for the parking moment never mention
  the pool moment.
- **Section 3 groups by moment**, the persona row in section 2 summarizes
  its runs ("2 of 3 moments done"), the poster has one block per moment,
  and favorites record the moment they came from, not the numbered list.

`scripts/check-multi-moment.mjs` runs step 1 on two off-domain moments and
step 2 on the second one, live. Step 1 took 19 s for two moments at medium.

## Pictures live on the saved captions (Sep 6, 2026)

Two changes from one batch that failed on "moment 4 of 6".

- **"You must be signed in to run a step" mid-batch.** Step 2 calls take a
  minute and run three at a time, so a batch straddles the hour at which the
  Supabase access token expires. The refresh only reaches the browser on a
  response, and a step's response is a minute away; every call started in
  between carries the already-rotated refresh token, which Supabase rejects
  after ten seconds. Fix: `runStepWithSession` (pov-jokes/run-step.ts) calls
  a 100 ms `touchSessionAction` (cookie-writing client, `getUser`) right
  before every long call and retries once on that exact error. Every step
  call on this page and in the pairing module goes through it.
- **Section 4 is now "Generate images/GIFs for saved captions."** Lydia:
  "THIS is where the place to assign an image (from the image set) OR a gif
  should be." The standalone pairing section after section 3 is gone. The
  pairing step now runs over the SAVED captions that have no image, one
  call per (persona, moment) group, and writes the image onto the favorite
  (`imageId/imageUrl/imageWho/imageFit/imageWhy`), so it persists with the
  favorites and survives clearing a run. Each saved caption also has a
  thumbnail grid of the loaded set to pick or override by hand, alongside
  the KLIPY search and paste box that were already there. The poster sits
  under the controls and draws whatever each caption has: the set image
  first, else a GIF that is a direct image or video file.
- Favorites now record the bare persona name (not "Columbia · moment 2")
  and step 2's GIF note, which the pairing prompt reads.

## 1561 elects ONE point of view and fits it to every moment (Sep 6, 2026)

Lydia: "step 2 should come up with a reason Columbia fits EVERY moment
elected. This flavor should focus on one POV at a time … at the top, we
need to elect that POV." So 1561 stops searching for whom to mock.

- **Section 1 elects the character** from the library (a select; add
  bullets to the library to see more). Only that entry's block goes into
  `{{PERSONAS}}`. Detected from the prompt asking for `why_it_fits`.
- **Step 1 fits the character to every moment.** Rewritten from the
  multi-moment prompt: `candidates` holds exactly the supplied character;
  each `per_event` entry gains `fits` (0–3, with an honest-0 rule: a forced
  3 produces generic jokes) and `why_it_fits` (must name the event detail
  AND the character instinct). Who-should-we-mock is gone; the five
  character scores /15 stay. Snapshot: docs/prompts/1561-step1-one-pov-every-moment.md.
- **Section 2 becomes "Confirm the point of view fits each moment":** one
  row per moment with its fit score, the why, trigger, target,
  manifestations, palette reactions, and a checkbox. Unticked moments are
  skipped by the write buttons (`momentsOff`, saved with the run, cleared
  when step 1 reruns).

Live (two off-domain moments): the Town scored fits 3 on both with
sentences naming the detail and the instinct; step 2 on moment 2 stayed on
moment 2. Step 1 took 34 s at medium.

## 1561's section order, corrected (Sep 6, 2026)

Lydia: "Step 1 is select the moment. Step 2 is select the POV and come up
with the angle for each moment and the selected POV. Step 3 is generate the
joke for each moment with this POV, ranked by how much potential it has."
The one-POV flavors now read:

1. Describe the moment(s). Nothing else in the section.
2. Select the point of view and find its angle on each moment: the select,
   the character's lines, the library editor, the step-1 button ("Find
   Columbia's angle on each of the 6 moments"), and the result as one row
   per moment (fit 0–3, why, trigger, target, manifestations, reactions)
   with the tick that decides whether step 3 writes for it.
3. Write the jokes for each moment from this point of view: one big button
   for the ticked moments, per-moment status, then every joke ranked by
   step 2's score, then the moment blocks, best-fit moment first.
4. Generate images/GIFs for saved captions.

The other flavors keep their four sections unchanged; the page picks the
layout from the prompt asking for `why_it_fits`.

## The full card, per moment (Sep 6, 2026)

Lydia expected the persona card — how it reads the moment, the tension,
what ends up ridiculous, pretends / would never admit, the one emotion, the
reactions, where it shows up, the engine, the punch direction, why it is
promising — under EACH moment. Step 1's `per_event` entries were thin
(trigger, target, manifestations, reactions), so they now carry the
character's complete reading of that one event: `persona_event_translation`,
`comic_contradiction`, `reusable_engine`, `punch_direction`, `why_promising`
too, each written in that event's own terms (validation line 10: never
copied from another entry or the top-level record). The page renders the
same Field terms as the persona card per moment, repeating the
character-level lines so each card reads on its own, and marks the
reactions to play with the GIF each maps to. Step 2 gets the per-moment
reading merged over the top-level record, so it now also receives an
event-specific engine and contradiction. Live: engines and contradictions
differ between the two fixture events; step 1 took 50 s for two moments.

## An imperfect fit names its deficit (Sep 6, 2026)

"If the fit is imperfect, 'fit 2 of 3', I want to make it obvious in the UI
what exactly the deficit is." Step 1's per-moment entry gains
`fit_deficit`: null exactly when `fits` is 3, otherwise one sentence naming
the concrete missing thing (a detail, an instinct the event does not
activate, the character not being the actor); "the fit is weaker" is ruled
out as a non-answer. The card shows it as the one amber callout, "What
holds it at 2: …", under the why-it-fits sentence. The checker gained a
third fixture moment the Town had no hand in (a bakery's pie ribbon): it
scored 0 with the deficit "the event lacks any Town action, public-space
restriction, resident complaint, or official wording for the character to
rename or defend," which is the honest-0 rule working.

## 1562: discover the premises, then execute them (Sep 6, 2026)

Lydia's two new prompts, "Step 1 — Discover Comic Premises" and "Step 2 —
Execute Comic Premises", installed on 1562 (a 1561 copy) as flavor steps 2
and 3; the angle step stays as step 1, and image concepts / simplify / pair
move to 4 / 5 / 6. 1561 stays the control.

- **Why two calls.** The discover prompt's core model is EVENT FACT → ODD
  IMPLICATION → CHARACTER EXPOSURE → COMIC LEAP → PREMISE, and it bans
  starting from a satire device ("rename it", "mark it resolved") and
  hunting for an event noun. The execute prompt writes TWO executions per
  premise, runs fact-integrity, premise-fidelity, swap and generic-template
  checks on each, picks, compresses, then chooses the GIF. Nine scores;
  overall = minimum; factual_support under 4 cannot win.
- **The page chains them** inside one "write" job per moment: step 2 with
  `{{PREVIOUS_PREMISES}}` = "None.", then step 3 with the discover output's
  `event_analysis`, `character_role`, `selected_premises` as JSON and
  `{{PREVIOUS_JOKES}}` = "None.". Both fills use the same per-moment persona
  context as before. The job keeps step 2's text beside step 3's and shows
  which call is running.
- **Nothing downstream changed.** Step 3's `final_candidates` are reshaped
  into the candidate list every reader already understands
  (`normalizeStep2`): premise → kernel, odd implication → why funny, the
  lowest score → weakest check, and the execution record's checks (the
  losing execution, why the winner won, swap test, template risk, fact
  integrity, compression, GIF) → "How this execution was chosen" in the
  analysis column. The moment's aside lists the selected premises with the
  frames they leave open, the raw premises with their rejections, and the
  full step 2 output.
- Detected by the `{{SELECTED_PREMISES}}` placeholder on a step, never by
  flavor id; later steps are found at orderBy + 1 when it is present.

Live on the town-pool fixture (`scripts/check-premise-chain.mjs`): 14 raw
premises, 5 selected in distinct families, all passing the swap test; 5
finals, one per premise, overall = min of nine, every factual_support ≥ 4.
Step 3 took 207 s at high. Best: "Staff wellness update: we removed the
public and kept the overtime."

Also today: the long persona descriptions in section 2 are display only —
step 1 reads the seven library lines, nothing else; the page says so under
the text.

## The fit score is three named checks (Sep 6, 2026)

"Are there explicit criteria? Are there three things it's looking for, or is
3 a random scale?" It was a ladder (one definition per level) that mixed
two questions. Now step 1 answers three yes/no checks per moment, each with
a reason, and `fits` is the count that pass:

1. `distinctive_detail` — a specific detail of THIS moment sets the
   character off; a complaint that could be about anything fails.
2. `character_is_actor` — the character itself did or said something in
   the moment; implicated, blamed, or imaginable fails.
3. `pathology_on_display` — what it did or said already shows its
   pretends / does_compulsively lines, so the jokes invent no behavior.

`fit_deficit` is gone: the failed checks and their reasons are the deficit.
The page shows the three checks with ✓/✗ and the reason on the section-2
card and beside the jokes in section 3; older runs still show the old
meaning and deficit sentence. Installed on 1561 and 1562. Live: the pool
and parking moments pass all three, the bakery fails all three with
reasons that name what is absent ("the Town neither does nor says
anything"). Step 1 took 78 s for three moments.
