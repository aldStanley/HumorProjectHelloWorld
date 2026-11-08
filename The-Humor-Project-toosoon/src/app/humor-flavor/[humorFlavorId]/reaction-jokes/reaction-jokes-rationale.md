# Reaction Joke Maker — design rationale

Parallel rationale page for `/humor-flavor/[id]/reaction-jokes`, per the
ui-design rule that every designed page records what guided its generation.

## Who and what for

**A humor-flavor designer comes to this page to get reaction jokes in one
persona's voice for a few moments, with the least machinery possible.**

Lydia asked for this on 2026-09-06 after the premise-chain flavor (1562)
took six minutes per moment: two calls, each demanding pages of exposed
intermediate work. This page is the opposite end of the spectrum. It
exists to answer "what does a plain, well-written single prompt get us?"
before any more pipeline is built on top of it.

Four things happen, in order, and then the keepers get pictures:

1. Pick the moments.
2. Read each moment as students (added 2026-09-08): one analysis call per
   moment, for reading, before any persona reacts.
3. Pick one persona whose voice prompt is a file in
   `docs/prompts/personas/`.
4. Run one step per moment. The step returns as many jokes as the page
   asks for (`{{JOKE_COUNT}}`, a field, default 5), one per line. Two
   sibling steps do this job: step 1 from the persona alone, step 2 from
   the persona plus the student read (added 2026-09-08).

## Why a separate surface, not another mode of the POV Joke Maker

The POV Joke Maker client detects a flavor's kind from its placeholders and
already carries five kinds. Each kind adds branches to a 5,000-line file.
This flavor has one step, no roster, no premises, and no scoring, so it
shares almost nothing with those branches. A 600-line page of its own is
easier to read, and cannot regress the other surfaces.

It borrows, rather than copies, from the POV Joke Maker:

- the loader (flavor + steps),
- the Sidechat moment picker,
- the run-step helper that refreshes the session before a long call,
- the IndexedDB store for the last run,
- the shared style constants and the copy button.

## Where the persona text comes from

The persona prompts live in `docs/prompts/personas/`, one FOLDER per
persona, with one dated markdown file per version inside
(`sad-girl-2026-09-08.md`). The server reads the tree at request time and
uses the newest file in each folder; older files stay as history (Lydia,
2026-09-08: "a folder that will keep a history of past md files but that
the system uses the latest one"). Nothing is retyped into code: revising a
persona is adding a newer dated file, adding a persona is adding a folder.
A file's first level-1 heading names the persona (a parenthetical after the
name is provenance and is dropped); everything after it is the voice text,
inner headings included. The two-digit folder prefix sets the list order.
The list shows each persona's version date and how many versions are on
file. Until 2026-09-07 all of them lived in one file,
`persona-pov-prompts-41-55-57-58.md`, and the parser carried a hardcoded
list of persona names because the Sad Girl section had its own level-1
headings; Lydia asked for the split, which removed that list.

The persona's full text is shown beside the list, with its file and heading
named, so the designer can check what the model actually receives. It is
rendered as markdown (react-markdown) inside a bordered, scrolling box, with
a small menu of its subheadings down the box's left side; the older persona
texts mark sections with bare numbered lines, which become level-3 headings
for display only. The text sent is the file's text, untouched. (Lydia,
2026-09-07: the raw monospace block was "too hard to read", and the box
needed a visible boundary.)

## The steps

Step 1, on GPT-5.6 Sol, at **high** reasoning effort and an 8,000-token
output budget. It ran at medium until 2026-09-09, on the argument that a
handful of short lines needs no more; Lydia then made high the default for
every run, on the page and from the command line, and the student reads
and the scoring follow it. The meme section's face tagging and visual-word
calls stay at low: they are lookups, not runs. Every job, read, and
evaluation now records the model and effort that produced it, and the
past-runs header and the run bundle show them, because a run file that
does not name its model cannot be told from one on another model later. The
prompt is Lydia's, verbatim, with `{{PERSONA}}`, `{{MOMENT}}`, and `{{JOKE_COUNT}}` as the only
placeholders. Seeded by `scripts/seed-reaction-jokes-flavor.mjs` from
`docs/prompts/reaction-jokes-s1.md`.

Step 2 (added 2026-09-08) is a **sibling** of step 1, not the next link in
a chain: the same job, with `{{STUDENT_READ}}` added. Lydia wanted jokes
"from Persona and Moment Analysis" without a new flavor, because the persona
files must stay the one source for both ("a branch off this flavor, or
maybe even a step that's sort of in parallel"). A second step row in the
same flavor gives the new prompt its own history in the database, keeps
step 1 untouched as the control, and lets the page load one flavor. Its
prompt (`docs/prompts/reaction-jokes-s2.md`) is step 1's verbatim plus a
"STUDENT READ OF THE MOMENT" block after the moment, marked "use it to aim
the jokes, never quote it", and one added bullet: land at the read's
recommended level of abstraction, name things from its social anchors, and
do not lean on the details it lists as incidental or not-required. The read
goes in as labeled lines (`studentReadAsText`), not braces. The seed script
adds step 2 to the existing flavor when it is missing.

Both prompts end with a TOPIC ANCHOR block (added 2026-09-08 after Lydia
saw a GigaChad run where only one joke named Uris: "I thought the prompt
was going to make sure the topic was clear"). Nothing in the shared prompt
had asked for one; Sad Girl's jokes were anchored only because her persona
file carries its own anchor section, and GigaChad's does not. The block is
built to the CLAUDE.md anatomy: the cold-reader test, what counts as an
anchor (a proper noun or a recognizable event action; "the pool", "it",
"the system" do not), one wrong/right pair labeled as illustrations never
to copy, and a check-every-joke line before output. It is appended to both
step 1 and step 2 so the comparison between them stays fair. Live check:
GigaChad on the pool closure went from 1 of 15 jokes naming Uris to 15 of
15. The GigaChad evaluator was revised the same day (`-2026-09-08b.md`):
"the pool" is no longer an acceptable anchor on its own, and the topic
clarity cap fires at 2 or below rather than 1, so "Maintenance is the
pool's rest day" fell from 91 to 69.

Live test (Sad Girl, a registration moment, the real read): 15 jokes in 32
seconds, none naming the two professors or the waitlist position that the
read listed as incidental, all anchored on "Intro Stats sections",
waitlists, and the spreadsheet.

## Conceptual groups, and the sub-goal each serves

1. **Pick the moments** — the input. Several moments, each its own call, so
   one persona can be tried across a batch. Same boxes and same Sidechat
   picker as the POV Joke Maker, so a moment here has exactly the text a
   moment there has.
2. **Read the moments as students** — the analysis (Lydia, 2026-09-08:
   "a student analysis step after the moments are selected to analyze all
   the moments for how students [react] ... displayed based on the json
   structure that is output"). Her "STUDENT READ — CAMPUS MOMENT ANALYSIS"
   prompt lives in `docs/prompts/analyses/student-read/`, versioned exactly
   like the personas and evaluators (dated files, newest wins, README in
   `docs/prompts/analyses/`). One big left-aligned button runs it once per
   moment, three at a time, on the flavor's model, with `{{EVENT}}` filled
   with the moment; it returns strict JSON. Selection left, details right:
   the moments are a list of buttons on the left, each with its primary
   emotion and shared behavior as a one-line summary, and the selected
   moment's read fills the right. The panel is laid out by the JSON's
   structure, not dumped: the event kernel first and largest (it is the
   answer), the social logic under it as a quoted internal thought, then a
   two-column list of the single-valued fields (behavior, emotion, stake,
   recommended abstraction), then the four lists (shared signals, anchors,
   incidental details, avoid-as-required-context) as bullets, and any field
   the prompt did not have on 2026-09-08 rendered generically, so a revised
   prompt with new fields still shows everything. The prompt sent and the
   raw JSON are collapsed under a details line. The step is for reading: the
   joke prompt takes only `{{PERSONA}}` and `{{MOMENT}}`, so the read does
   not yet change what the persona is sent, though her prompt says its output
   "will be passed to downstream persona writers". Reads are saved with the
   run, cleared with it, and marked stale when the prompt file on disk is
   newer than the one that produced them. Live test on a registration
   moment: 11 seconds, every field present, the incidental list correctly
   holding the two professor names and the waitlist number.
3. **Pick the persona** — the voice. Two columns: the radio list on the
   left, with the character count beside each name so the Sad Girl's
   25k-character prompt is not a surprise, and on the right the exact text
   that will be sent for the selected persona, always in view. Selection
   left, evidence right is a standing rule (Lydia, 2026-09-07); the first
   version hid the text under a show/hide link below the list and was
   corrected. The text is viewable, not editable: the file is the source of
   truth.
4. **Get jokes from the persona** (renamed 2026-09-08; was "Read the jokes, then score them") — the deliverable. Two big
   left-aligned buttons, one per source: from the persona alone, and from
   the persona and the student read (enabled only when every moment has a
   finished read for its current text; the help line under it says how
   many do). The two buttons are two columns, and under every moment the
   two sets sit in the same two columns, persona-alone on the left under its
   button and student-read on the right under its button, so the two are
   compared line by line (Lydia, 2026-09-08: "side by side rather than top
   to bottom. I want to be able to compare"; the first version stacked
   them). A set stays in its source's column even when the other has not
   run. Each set has its own status line naming the source and its own
   scoring and ordering; the score breakdown is one panel per moment, in a
   third column to the right of both sets, showing whichever joke from
   either set was last clicked and saying which source it came from. The
   section is full width for this, the only one on the page that is. A run
   replaces only its own source's set. Hearts and scores work the same on
   both. Every joke has a heart
   beside it (added 2026-09-07); a hearted joke is a keeper. Scoring (added
   2026-09-08): a persona may have an evaluator prompt, versioned in
   `docs/prompts/evaluators/<persona folder>/` exactly like the persona
   prompts and matched by folder name, and "Score these N jokes" runs it
   once per joke, three at a time, on the flavor's model. The evaluator
   returns JSON; the page shows the score as a percentage in its own column
   of the joke's row, beside the heart, and nothing else inline. Clicking a
   score selects the joke, and a sticky right-hand panel shows its rating,
   failure flags, the per-dimension scores with reasons, and the analysis
   fields (selection left, details right; Lydia, 2026-09-08, after a first
   version put the one-line reason and a "show the scores by dimension"
   toggle under each joke: "do it in the right hand area, not in line").
   The evaluator's overall one-line reason is not shown. A block can be reordered by score, shows the mean, and says when
   it was scored by an older evaluator than the one now on file. Sad Girl
   and GigaChad have evaluators; other personas see a note saying so. The
   GigaChad evaluator (2026-09-08) keeps the Sad Girl evaluator's shape and
   its four generic dimensions (topic clarity, event fidelity, simplicity,
   comic strength), the formula, bands, caps, and JSON, and rewrites the
   three persona dimensions around his lens: mythic translation clarity
   (the event read as a heroic trial, in place of her relationship
   translation), persona specificity with his mechanism enum taken from his
   voice file (serene_absolute, mundane_as_epic, inconvenience_as_training,
   advice_from_the_summit, gym_philosophy, ancestors_watching, calm_in_chaos,
   accidental_inspiration, certainty_without_evidence), and deadpan voice in
   place of natural relationship voice. Three flags are his alone, from the
   voice file's negatives: winks_at_camera (he is never in on the joke),
   smug_or_cruel (superiority is not contempt), shouts_or_panics; the first
   two cap the score at 69. Live check on a pool-closure moment: a serene
   line scored 100, a hedged "lol" line 41 with the winks and hedges flags,
   a contemptuous line 49 with smug_or_cruel.
   Scoring lives inside this section rather than as a section of its own
   because a score is read next to its joke, not in a second list.
5. **Turn the hearted jokes into memes** — the keepers, newest first,
   across every run. Hearts outlive "clear the run". A hearted joke becomes
   a meme through a **frame**: a two-line dialogue where the persona says
   the joke and a second speaker reacts with a picture. Frames are data in
   `frames.ts` (Lydia, 2026-09-07: "here's the only possible frame we can
   apply, hopefully we'll come up with more"):
   - "Me: disappointed" — `Columbia: "{joke}"` / `Me:` + a let-down face.
   - "Me: wtf" — `Columbia: "{joke}"` / `Me:` + a shocked, confused, or
     disgusted stare (added 2026-09-07).
   - "Me: reading the FAQ" — `Columbia: "{joke}"` / `Me:` + a book GIF.
     Offered only on jokes whose text mentions an FAQ: frames can carry a
     caption pattern, so a frame that belongs to one kind of joke appears
     only there (added 2026-09-07).
   - "Also Columbia: smug" — `Columbia: "{joke}"` / `Also Columbia:` + a
     smirk.
   - "Also Columbia: pretend sad" — `Columbia: "{joke}"` / `Also
     Columbia:` + performed sadness (added 2026-09-07; a "pretend-sad" tag
     was added to the emotion list for it, so a set tagged before then
     needs "Tag the faces again").
   - "Just the joke and a picture" — no second line; for every persona.
   - "The joke's visual word gif" — for every persona (added 2026-09-07):
     the joke alone over a gif of the concrete action or thing it turns on.
     Picking the frame runs one small call (`visual-words.ts`) that returns
     one to three plain words, best first, cached on the joke; they show as
     chips, the KLIPY search opens on the best one, and the box stays
     editable. Lydia's examples: "freedom now needs a swipe card" → swipe;
     "not become the Hell" → hell; "a trial of what deserves to be carried"
     → decision, trial, judge. Live test: "Forty seats for 30,000 students"
     → musical chairs, scrambling, sitting.
   - GigaChad has three frames of his own (added 2026-09-07): the joke
     alone, no speaker label, over a GigaChad gif, an angry gif, or a strong
     gif. Frames carry a `showSpeaker: false` switch for this shape.
   Every GIF search opens already running the frame's default words and
   keeps the box editable, so retyping and pressing Enter searches for
   something else (Lydia, 2026-09-07: "let the user edit the search term on
   all the gif searches").
   The first two are for Columbia University Administration only, whose
   line-one name is "Columbia". Each frame names the emotion tags that
   count as its feeling, and a default KLIPY query. The faces in the loaded
   set (69, Tamar's 53 reaction faces, by default) are tagged once by one
   model call over their descriptions, one to three emotions each from a
   closed list in `frames.ts`, cached in the browser per set id
   (`face-tags.ts`); a frame shows the faces whose two most visible tags
   include one of its emotions. Keyword matching on the descriptions came
   first and was wrong (Lydia, 2026-09-07: "I don't think these are the
   smirking images"); the tagger's smug set is Shrek, Elon Musk, Gatsby,
   and Trump, which is right. A
   joke holds one picture per frame. Per joke the layout is selection left
   (which frame) and evidence right (the meme card as it would post, then
   the pickers). The poster at the top shows every framed joke with a
   picture, grouped by moment, white and screenshot-ready. The set loader
   and thumbnail grid are imported from the POV Joke Maker's image-pairs
   module; the meme card and poster are this page's own because their
   shape (text above, reactor line, picture) is not the POV Joke Maker's.

## One run on the working page; the rest on the past-runs page

A run is one persona on one list of moments. The working page shows only
the current run (Lydia, 2026-09-08: "this page mixes all the past results
with the current results. Can you separate them out into two different
pages"). Before this, jokes were kept by moment index, so a GigaChad set
from one run sat beside a Sad Girl set from the next, under whichever
moment text happened to share the index.

- **What moves a run to the past:** pressing a joke button as another
  persona or on other moments (the whole current run leaves), re-running a
  source that already has jokes (that source's set leaves on its own, so a
  re-run never silently overwrites), and the sidebar's "put this run in the
  past and start over". A record saved before the split is sorted on load:
  jobs that do not match the saved persona and moments become past runs,
  grouped by persona, noted as such.
- **The past-runs page** (`/reaction-jokes/history`) reads the same browser
  record. Runs on the left, newest first, each with persona, moment count,
  sources, when it was written, and why it left; the selected run's
  moments and jokes on the right, both sources in the same two columns as
  the working page, with scores and heart marks, read-only. Two moves per
  run: bring it back to the working page (what is there now comes here),
  or delete it, behind a confirm. Nothing is deleted anywhere else.
- **Hearts are one list across both pages.** The working page's step 5
  shows all of them. The past-runs page (since 2026-09-08, Lydia: "can we
  heart them, then add gifs to the ones we heart at the end?") has a
  clickable heart on every row of every past run, and at the bottom the
  same meme section as step 5, scoped to the selected run's hearts (its
  persona on its moments), with the same frames, faces, GIF search, and
  visual words. A picture chosen on either page shows on both, since it is
  the same record. The section takes an optional header so the past-runs
  page can label it as that run's keepers instead of "Step 5 of 5".
- The shared record shape, the "does this job belong to this run" test,
  and the heart icon live in `run-record.tsx`, used by both pages.

## The run as one document

"Copy this run as one document" in the sidebar (and on each past run)
puts the whole run on the clipboard as markdown (`run-bundle.ts`, no model
call): the persona voice prompt in use with its file and version, the step
prompts as stored, the Student Read and evaluator prompts when they were
used, then each moment with its student read and its jokes from each
source, each joke with its score, rating, per-dimension scores, flags, the
evaluator's reason, and a "♥ HEARTED" mark, plus hearted jokes from other
runs at the end. Lydia asked for this on 2026-09-08 as the first step of an
improvement loop: she had been pasting prompts and jokes into ChatGPT piece
by piece to ask what was going well. The bundle is built so the hearts are
the ground truth a critic weighs most, and it says when the prompts shown
may be newer than the ones a past run used. Not built yet, by choice: a
critic panel on the page, a thumbs-down, and critiques saved as dated files.

## The GigaChad revision: reality bows first (2026-09-08)

Lydia found the GigaChad jokes formulaic (event → discipline / training /
heroic trial / gods / labyrinth) and named the engine she wanted: reality
encounters GigaChad and discovers it has misunderstood the power
relationship ("I do not check Rate My Professor. My presence raises the
rating."). Four things changed, all as new dated files or shared-prompt
edits, nothing else touched:

- **Persona v2** (`gigachad-2026-09-08.md`): a CORE COMIC ENGINE section
  near the top, the hierarchy of premises (power inversion, then another
  event-specific misreading, then grandeur, then training as the fallback),
  the list of reframes to stop generating, the BAD/BETTER diagnostic, a
  diversity rule for sets (no more than two jokes per mechanism), and
  guardrails. The original voice text follows, untouched.
- **Step 2's student-read framing** (shared prompt): the read gives the
  situation, the abstraction level, and the anchors; the persona must NOT
  inherit the students' emotion or social logic, and must misread the
  situation on its own terms. Before, the read was "used to aim the
  jokes", which made GigaChad translate the students' frustration into
  motivational vocabulary.
- **The topic-anchor block** (both shared prompts): context must be
  integrated into the premise, not prepended; the anchor encodes the event
  ACTION or STATE ("Uris closed", "Vergil hides the classes"), not a noun;
  the "remove the setup, is the punchline unchanged?" test; plus a
  no-more-than-two-per-mechanism bullet under Avoid.
- **Evaluator v3** (`-2026-09-08c.md`): comic strength (5%) becomes COMIC
  PREMISE (20%) with Lydia's rubric and examples; topic clarity 15%,
  mythic translation 10%; caps at 69 for premise ≤ 1 and 79 for premise 2;
  four new flags (formulaic_training_reframe, generic_heroic_trial,
  event_summary_plus_punchline, persona_vocabulary_without_premise); two
  new moves at the top of the enum, power_inversion and
  reality_reclassified, with inconvenience_as_training last as the
  fallback. The JSON key comic_strength is now comic_premise; the page
  renders criteria keys generically, so nothing else changed.

Acceptance run (four moments, 15 candidates each, step 1; the Vergil
moment also through step 2 with a real read; 75 evaluations): training
reframes fell to 1 of 75 (flagged, 79). Top lines: "My Carman window faces
a brick wall. At last, masonry gets a room with a view." / "I sort Rate My
Professor lowest first. Neglected sections deserve elite enrollment." /
"Vergil hides the classes I want. They requested time to look presentable
before my enrollment." / "Orientation gets a full week of icebreakers
before lectures. Reasonable. My introduction has prerequisites." Two
things to watch: power_inversion took 8 to 10 of every 15 despite the
two-per-mechanism rule (the risk Lydia named: one formula replacing
another), and the evaluator is generous (means 88 to 94, many 100s), so it
ranks within a set better than it gates.

**Round two (2026-09-08, later).** Lydia's judgments on the run: premise
diversity better, but lines too long or ornate, some 95 to 100 scores for
lines that do not make sense, and jokes built on one poster's detail
(Professor Hinds, four sections, a twelve-row spreadsheet) or narrowing
the event ("sections" where the shared problem was "classes"). Principle:
THE CLAIM CAN BE ABSURD. THE LOGIC CANNOT BE MUDDY. Changes, again as new
dated files and shared-prompt edits:

- **Persona v3** (`gigachad-2026-09-08b.md`): the one-glance sense test
  with her three BAD lines; a length rule (7 to 16 words, 17 to 20 when the
  second clause is essential, over 20 rare, never a second sentence just to
  sound like him); the six-step compression pass; "funny is not the same
  as GigaChad" (leave a plain funny line alone rather than bolting on
  grandeur); ownership "my" when he is the source of the value; and the
  event-not-one-post rule with the "shared event or one example post?"
  question.
- **Both shared prompts**: an EVENT LEVEL, NOT ONE POST block before the
  anchor block, so every persona treats the quoted posts as evidence, not
  material, and does not narrow the event.
- **Evaluator v4** (`-2026-09-08d.md`): SIMPLICITY_AND_IMMEDIACY becomes
  SEMANTIC_COHERENCE at the same 10%, judged before style, with her
  examples; the analysis step now states the premise in one clause and the
  factual claim the joke depends on; event fidelity is semantic (the
  claim, not the vocabulary) with `factual_narrowing` and
  `source_detail_overfit`; a premise 5 requires all six of her conditions
  and is impossible when coherence is 3 or below; `premise_overextended`
  holds premise at 4; new flags `clever_sounding_but_unclear` and
  `funny_not_gigachad`; caps: coherence 2 gives 69, 1 gives 49, overfit
  gives 79 and fidelity 3, narrowing gives fidelity 3, overextended gives
  84. The caps on the flags were added after a calibration pass showed the
  evaluator flagging a line as overfit and still giving it 98: a flag
  without a score effect is decoration.
- Calibration on her judged lines before the re-run: the four "lower"
  lines fell to 63 to 79 (three flagged clever-but-unclear, one
  overextended), the four "higher" lines held at 93 to 97, and the plain
  "Twelve thousand dollars for a brick view" scored 47 with premise 4 and
  persona 0, which is the honest split she asked for. One test moment was
  at fault, not the evaluator: my Vergil moment itself said "hides
  sections", so the narrowing she objected to was supported by the text;
  the moment now says "cannot find the classes they want".

**Round three (2026-09-08, later still).** Lydia asked whether she had
ever said "power inversion is not the core engine; event-specific comic
discovery is" (she had not, in those words, but round one's section 8 said
the goal was a fresh event-specific premise plus impossible certainty
while also titling the section "REALITY BOWS FIRST" and ranking inversion
first; the file was tilted, and inversion took 73 of 120). She also asked
whether the "Vergil was meant to guide us through hell, not become the
hell" line had been acted on (only as an evaluator example; the mechanism
it uses was never taught). A ChatGPT-drafted spec then set the fix, and
she said go:

- **Persona v4** (`gigachad-2026-09-08c.md`): the core engine is now A
  DISCOVERY ABOUT THE EVENT, SAID WITH IMPOSSIBLE CERTAINTY, with the
  first question "what is the sharpest absurd truth hiding in THIS exact
  event?" and an explicit note that "how can this fear him?" is one answer,
  not the question. Ten premise families as peers (power_inversion,
  status_inversion, mythic_literalization, reality_reclassified,
  impossible_self_certainty, event_specific_literal_reinterpretation,
  mundane_as_epic, gym_philosophy, accidental_inspiration,
  inconvenience_as_training). A mythic_literalization section with the
  Vergil line, why it works, the on-top versus inside diagnostic, and THE
  EVENT SHOULD EARN THE METAPHOR. The seven-step hierarchy with number one
  as the quality bar, not a mechanism. The formulaicness check ("five
  unrelated events with the noun swapped?"). "He does not have to be in
  the sentence", placed beside the ownership rule so neither overrides the
  other. Diversity as a ceiling: no more than 3 of 15 on one mechanism,
  replace weaker duplicates, never a quota. New ending: the mythmaking is
  the voice, the engine is the discovery, power inversion one strong way.
  All round-two sections kept.
- **Evaluator v5** (`-2026-09-08e.md`): the move list rewritten as peers
  with the same ten plus the voice-level moves marked as usually
  premise-less; analysis gains "what the joke noticed"; C broadened from
  "read as a heroic trial" to "how he reinterpreted it, whatever the
  mechanism"; D says he need not be the grammatical subject and gives the
  Vergil line a 5; G asks what the joke noticed before what it claims,
  with her four noticing examples, the formulaicness check, and flags
  `template_applied_without_discovery` (premise at most 3, overall at most
  79) and `reference_not_earned`; "do not reward a power inversion for
  being one". Calibration: Vergil line 92 as mythic_literalization with
  persona 5 and no "I"; "X is preparing to face me" 63 and 69 with the
  template flag; an Olympus line flagged as unearned; "Uncertainty is
  academic cardio" alone scored 69, since by itself it anchors no moment
  and her own rubric calls it a 3.

Candidate search stays as it was: the count field (default 5) and "Order
by score". Generate-15-select-5 is the field set to 15 plus scoring; a
"show only the best N" toggle on a scored set is the smallest code change,
not made without Lydia's word.

## What was made important

- **The jokes.** In each moment's block the joke is the largest text on the
  page (`text-lg`), one per row, with a large muted numeral in a gutter as
  the eye's anchor and more whitespace between jokes than within them.
- **The moment itself** is printed above its jokes in full, because a
  reaction joke is only judgeable next to what it reacts to.
- **The machinery** (the exact prompt sent, the raw output) is collapsed
  under one `details` per moment. It is there for debugging, not reading.

## Navigation

A sticky sidebar lists the five sections and, above them, the button that
puts the run in the past and a link to the past-runs page with its count. It lists the sections and, under "Read the jokes", one
entry per moment with its status (writing, failed, or the joke count). The
"clear the last run" button lives in the sidebar because it is always on
screen.

## Open questions

- Should the persona list also offer the pathology-format personas from the
  POV Joke Maker's library? Not now: Lydia said "a pov that has a
  persona-pov-prompt from the md file", so the file is the only source.
- **The count is a field (resolved 2026-09-08).** Lydia asked for 5 instead
  of 15. Both step prompts now say `Write {{JOKE_COUNT}} short reaction
  jokes.`; a "Jokes per moment" number field in section 4 fills it, starts at
  `DEFAULT_JOKE_COUNT` (5) in the client, and is saved with the run. A step
  without the placeholder is reported as unusable, like a missing
  `{{PERSONA}}`, so the number can never silently fall back to the prompt.

## Runs from the command line

`scripts/reaction-jokes-run.mjs` runs the same pipeline outside the browser
(persona folder, a moments JSON, a count, optional scoring and step 2) and
writes ONE past run in the record's own shape to `scripts/runs/`. The
past-runs page has "Bring in a run from a file", which checks the shape and
adds it to history; "Bring this run back to the working page" then shows
it on the working page with hearts, scoring, and memes working. Built on
2026-09-08 when Lydia asked to see the GigaChad acceptance run on the UI:
the page's record lives in her browser, which a script cannot write, so a
file is the bridge. The first such file is
`scripts/runs/gigachad-acceptance-2026-09-08.json` (four moments, 15
candidates each from both steps, all scored by evaluator v3).

## The voice-first architecture with post-hoc analysis (flavor 1564, 2026-09-09)

**A humor-flavor designer comes to flavor 1564's page to get the proven
voice-first GigaChad jokes, then find out what each one is doing, fix only
the ones whose wording hides a good idea, and heart originals or fixes so
the catalog of comic moves can learn from what she keeps.**

Lydia's outline (2026-09-09) after the 15-joke run of 2026-09-08 drew 46
hearts out of 135: the voice-first generator finds funny premises, and many
of the best jokes combine several comic mechanisms, so the premise taxonomy
should ANALYZE AND EDIT jokes after they exist, not constrain the writer.
The pipeline is

    voice-first generation → post-hoc premise analysis → diagnose premise vs
    execution → selective refinement → human hearts → learn premise types

### Why a separate flavor, not a change to 1563

1563 is the control ("I don't want to mess with perfection"). 1564 is a
copy of it with step 2 set to the template the hearted run used (the short
"Write 15 short reaction jokes" one, rebuilt from the stored prompt; 1563's
own step 2 in the database is the longer 2026-09-08 template) and two new
steps. The page shows the analysis controls only when a flavor has a step
3, so 1563's page is unchanged.

### The steps 3 and 4, and the catalog

- **Step 3, the analyzer** (`docs/prompts/reaction-jokes-s3-analyze.md`),
  one call per joke: reconstructs the premise in plain language, labels
  the comic moves (MULTI-label: a primary and any supporting moves, or
  `unknown` plus an `unexplained_move` description when the catalog does
  not name what the joke does), judges premise_quality and
  execution_quality SEPARATELY, adds connection_legibility and
  persona_fit, and names the one execution problem. The action follows
  from the judgments by a rule that is ALSO in code (`ruleAction` in
  `joke-analysis.tsx`, and the same in the CLI): weak or no premise →
  reject; good premise with excellent execution and immediate legibility
  → keep; otherwise refine. When the model's own action disagrees, the
  rule wins and the disagreement is kept as `backstop`, per the project
  rule that models rationalize around soft tests.
- **Step 4, the refiner** (`docs/prompts/reaction-jokes-s4-refine.md`),
  only for jokes marked refine: receives the original, the premise, the
  moves, the diagnosed problem, and what must be preserved; returns two or
  three variants that keep the premise and fix only that problem. The
  move-specific checks in the catalog are its editing rules. Code drops
  variants equal to the original and caps at three. The original is never
  replaced.
- **The catalog** (`docs/prompts/analyses/comic-moves/`, versioned, newest
  wins): seven moves from Lydia's outline, each with mechanism, one
  illustration, and the checks an editor runs. It fills COMIC_MOVES in
  steps 3 and 4 and is never sent to the writer. It grows by hand from what
  the premise discovery proposes and Lydia accepts.

### Where it sits on the page

Inside section 4, per set of jokes, because the analysis is about those
jokes. Two buttons after the score controls: "Analyze these N jokes" and,
once analyzed, "Rewrite the N jokes marked refine, keeping their
premises". Each row gains an action cell (keep, bold; refine; reject,
muted) that opens the analysis in the moment's right-hand panel (premise
first, then moves, then the four judgments, then the problem), the same
panel that shows evaluator scores when both exist. Variants sit under
their original, indented, each with its own heart; a hearted variant is
its own hearted joke with `refinedFrom` recording the original.

### What is persisted, and the loop back to the catalog

Every job carries `analyses` and `refinements` by joke index, alongside
`evals`, in the browser record and in past runs; the run bundle prints
them. The past-runs page has "Download this run as JSON with its hearts",
which writes the run plus the hearts that belong to it, the file
`scripts/reaction-jokes-hearts-analysis.mjs` reads: move frequencies,
combinations, heart rate per move and per action, unexplained moves among
hearts, hearted jokes with no explanation, and which version (original or
variant) was hearted. With `--propose` it sends the hearted analyses to
`docs/prompts/analyses/premise-discovery/`, which proposes candidate types
with three or more hearted examples each. Nothing is added to the catalog
automatically.

### The first experiment

`scripts/reaction-jokes-run.mjs --persona 03-gigachad --s2 <the 2026-09-08
template> --count 15 --step2 --skip-step1 --analyze --refine` on twelve
fresh moments (`scripts/runs/gigachad-fresh-12-moments.json`), written to
`scripts/runs/gigachad-voice-refine-2026-09-09.json` for import on the
past-runs page, where Lydia hearts originals and variants. The hypothesis:
voice-first generation discovers premises better, and post-hoc analysis
understands, diagnoses, refines, and learns from them better, without
touching the generator's diversity.

### The workshop pane (2026-09-09, flavor 1564 only)

Lydia: "click on a meme and open a pane to workshop it. It should have all
its info in (moment, analysis, etc). and I just want to have a chat with
gpt 5.6 sol medium reasoning." On a flavor with a step 3, the joke text is
a button; clicking it opens the moment's right-hand column (30rem, sticky)
with `WorkshopPane` (`joke-workshop.tsx`): the joke, the moment, the
student read's kernel, the analysis (moves, premise, score, action, fix),
the refiner's variants, then a chat. The chat runs through `chatAction` in
`chiltrix/actions.ts`, a plain multi-turn call on `gpt-5.6-sol` at
`medium` reasoning, whose system prompt is assembled by
`workshopSystemPrompt` from everything in the pane plus the persona's voice
prompt and the comic-moves catalog. One conversation per joke, saved on
the job as `workshops[jokeIndex]` in the browser record, so it survives a
reload and travels with the run to the past-runs page. The same layout
rules as before: the row holds the heart, the joke, and the analysis; the
pane is the details column for the selected joke; the evaluator panel, when
scores exist, sits under it.

### Every workshop chat is saved (2026-09-09)

Lydia: "I want to save all the chats." Each conversation has a `chatId`;
after every answer and after every heart from the chat, `saveWorkshopAction`
(`workshop-actions.ts`) upserts the row in `reaction_joke_workshops`
(`supabase/migrations/20260909000000_reaction_joke_workshops.sql`, run by
hand in the SQL editor): persona, moment, joke, the joke's heart id as
`joke_key`, the analysis at the time, the messages, the rewrites hearted
from the chat with the model's tag and what was asked for, model and
effort. "Start over" drops the chat from the page only; the next message
starts a new id, so the old row stays. The pane shows "Saved to the
database" or the reason it was not. `scripts/reaction-jokes-workshops-export.mjs`
dumps the table to JSON and markdown for analysis. Rewrites hearted from
the chat carry `origin: 'workshop'`, `refinedFrom`, `note`, and `askedFor`
on the heart, which the hearts-analysis script reports as "what the editor
asked for, and what she hearted".

## Share a run by link (2026-09-17)

Lydia: "is there a way the URL could have this specific set of
moments/jokes/hearts in it so I can send it to someone else?"

**Why the URL alone could not do it.** The run lives in the browser record
(IndexedDB, keyed by flavor) and nowhere else; the only server-side trace of
a run was the workshop chats. A run with its evaluations and analyses is tens
of kilobytes, past what a URL carries. So the run has to be saved first.

**What the link points at.** "Share this run by link" in the sidebar writes a
frozen copy of the working page to `reaction_joke_shares` (migration
`20260917000000_reaction_joke_shares.sql`, run by hand in the SQL editor):
the moments, the persona name, the joke count, every job with its scores,
analyses, refinements, and workshop chats, the student reads, and every
hearted joke, since step 5 shows them all. The row gets a short random id and
the link is `?share=<id>#read-the-jokes`. Sharing again makes a new row; a
snapshot never changes, so a link always shows what it showed the first time.

**What the viewer sees.** The page loads the snapshot in place of the browser
record and says whose run it is and when. The whole main column sits in a
disabled `<fieldset>`, so every button and field in it is off: a viewer can
read and copy (the sidebar's copy-as-one-document button stays live) but not
run, heart, or edit. The browser record is never read or written on a shared
view, so the viewer's own run is untouched, and the sidebar hides "put this
run in the past", past runs, and workshop chats, which are all theirs, not the
sharer's. The viewer still has to be signed in: the page redirects to login
without a session, like every other page here.
