You are given one or more real campus events, numbered. Find the ONE broad character most worth mocking across all of them (at most three), and make each one a comic character with ONE obvious emotional instinct. One character serves every event; each event gets its own grounding in `per_event`.

Precision makes meme jokes brittle. "Columbia administrator making restricted access the new normal" is analytically right and hard to joke from. "A powerful institution that does something visibly unpopular, then reacts with calm bureaucratic confidence as though changing the wording makes the contradiction disappear" is a character. Specific roles (the PR writer, the one hitting "renew", the one editing the sign, the one ignoring the question) are MANIFESTATIONS of that character, not separate personas.

The reusable comic engine is:

<actor> does X → students point out the obvious contradiction → <actor> calmly doubles down / renames it / pretends nothing is weird

---

# INPUT

## Campus Event(s)

Numbered `1.`, `2.`… when there is more than one. A single unnumbered event counts as event 1.

{{EVENT}}

## Optional Event Context

{{EVENT_CONTEXT}}

## Broad characters already defined (may be empty)

{{PERSONAS}}

Each arrives as a bullet with sub-lines: wants / pretends / does compulsively / would never admit / comic emotion / best joke behavior. Use an entry when THIS event activates it, and copy its lines rather than rewriting them. Add an event-native broad character only when the event has a mockable actor the entries do not cover (the NYPD, Housing, the swim club, the landlord), and write its lines yourself.

---

# STEP 1 — WHO SHOULD WE MOCK

## event_core

What happened, one sentence, facts only. With several events, the one sentence that covers all of them.

## obvious_contradiction

The thing everyone can SEE that the responsible actor is pretending not to see. With several events, the contradiction they share.

## who_should_we_mock

One to three actors with power or responsibility in this event, most obvious first, each with one sentence on why. A student group is mocked only when it is clearly the one behaving absurdly.

---

# STEP 2 — MAKE EACH ONE A COMIC CHARACTER

For each actor, a compact record:

## persona_pathology

`wants` / `pretends` / `does_compulsively` (2–4 exact filmable behaviors) / `would_never_admit`. Copied from the supplied entry when there is one.

## comic_emotion

ONE attitude, in a few words, that every joke from this character plays.

## emotional_palette

4–5 exaggerated reactions, each instantly visual, each with the reaction-GIF emotion or action it maps to. The reactions are the joke inventory; a reaction that needs explaining is not in the palette.

## manifestations

3–5 roles this character shows up as in THIS event.

## reusable_engine

The engine above, filled in with this event's own terms.

## trigger_feature, persona_event_translation, comic_contradiction, joke_target, punch_direction

The exact event detail that activates the character; "event reality → what this character says it is"; what they claim vs what everyone can see (a contrast is not a tension: name the claim AND the visible fact); who is exposed; `up` | `lateral` | `self` | `down`. With several events these describe the character across all of them.

## per_event

One entry per numbered event, in order: `event` (its number), `trigger_feature`, `joke_target`, `manifestations` (2–3 roles in THAT event), `best_reactions` (1–2 `reaction` strings copied VERBATIM from this character's `emotional_palette`). The joke-writing step sees ONE event at a time and receives only that event's entry, so every entry must stand on its own. One event means one entry.

---

# STEP 3 — SCORE EACH CHARACTER, 0–3

## mockability

0 = nobody would laugh at this actor · 3 = the actor's own behavior is already the joke

## event_specificity

0 = fits any headline · 3 = depends on a distinctive detail of THIS event

## one_idea_one_attitude

0 = needs a paragraph of setup · 3 = one idea plus one attitude carries every joke

## gif_ability

0 = the reactions need explaining · 3 = every palette entry is a familiar reaction GIF

## target_clarity

0 = unclear who is ridiculous · 3 = the actor is unmistakably the butt

`total_score` is the exact sum of the five, out of 15. Scores are per character across all events, not per event.

---

# STEP 4 — SELECT

`selected_personas` is usually ONE character, at most three, most mockable first, as a pick list only: `persona` (copied VERBATIM from its `candidates` record), `source`, `why_this_persona_is_promising`.

---

LENGTH IS A CONTRACT: every prose field is ONE sentence of at most 25 words; lists hold at most 5 items.

(Illustration of the SHAPE only — off-campus, never copy any of it into output:
* the airline
  - wants: to keep the schedule looking intact while appearing customer-first
  - pretends: nothing has changed; every delay is ordinary operations
  - does compulsively: renames the delay, thanks you for your patience, adds a boarding group, treats complaints as a messaging problem
  - would never admit: the passengers' blunt description is more accurate than the announcement
  - comic emotion: serene confidence while the board says CANCELLED
  - emotional palette: smug denial → "actually…" correction; cheerful rebranding → proudly unveiling; casual doubling down → pressing the same button again; caught-but-unbothered → zero embarrassment
  - reusable engine: the airline cancels the flight → passengers point at the board → the airline calls it a schedule enhancement)

---

# JSON OUTPUT CONTRACT

Return ONLY one valid JSON object. No Markdown, no code fence, no commentary, no trailing commas. Integers for scores. Placeholders in angle brackets are NOT values; never copy them.

{
"event": {
"event_core": "",
"obvious_contradiction": "",
"who_should_we_mock": [
{ "actor": "", "why": "" }
]
},
"candidates": [
{
"persona": "",
"source": "<recurring_trope when copied from a supplied entry | event_native when you wrote it>",
"persona_pathology": {
"wants": "",
"pretends": "<string, or null only when there is genuinely no pretense>",
"does_compulsively": [
""
],
"would_never_admit": ""
},
"comic_emotion": "",
"emotional_palette": [
{ "reaction": "", "gif_emotion": "<the reaction-GIF emotion or action, a few words>" }
],
"manifestations": [
""
],
"reusable_engine": "",
"trigger_feature": "",
"persona_event_translation": "",
"comic_contradiction": "",
"joke_target": "",
"punch_direction": "<up | lateral | self | down>",
"per_event": [
{
"event": 0,
"trigger_feature": "",
"joke_target": "",
"manifestations": [
""
],
"best_reactions": [
"<copied VERBATIM from this character's emotional_palette reaction>"
]
}
],
"scores": {
"mockability": 0,
"event_specificity": 0,
"one_idea_one_attitude": 0,
"gif_ability": 0,
"target_clarity": 0,
"total_score": 0
}
}
],
"selected_personas": [
{
"persona": "<copied VERBATIM from its candidates record>",
"source": "<recurring_trope | event_native>",
"why_this_persona_is_promising": ""
}
],
"cast_summary": ""
}

The page joins each selected persona to its `candidates` record by name, so `selected_personas` carries nothing else.

---

# FINAL VALIDATION BEFORE RESPONDING

1. Valid JSON, nothing outside the object.
2. Every `total_score` is the sum of its five 0–3 scores, out of 15.
3. `selected_personas` has one to three entries, each naming a `candidates` record verbatim, each with only `persona`, `source`, `why_this_persona_is_promising`.
4. Every `emotional_palette` entry has a `gif_emotion` a familiar reaction GIF could show without explanation.
5. Every `does_compulsively` entry is a filmable behavior, not an adjective.
6. A supplied character's pathology is copied, not rewritten.
7. Every `comic_contradiction` names the claim AND the visible fact.
8. Every prose field is one sentence of at most 25 words; every list at most 5 items.
9. `per_event` has exactly one entry per numbered event, numbered in order (one entry for one event), and every `best_reactions` string appears verbatim as a `reaction` in that character's `emotional_palette`.

If any check fails, fix it before responding.
