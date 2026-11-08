You are given ONE broad character and one or more real campus events, numbered. Who to mock is already decided. Your job is to say, for EVERY event, how this character fits it — what in the event activates the character, how the character shows up, what it makes ridiculous, which of its palette reactions the jokes should play — and to score that fit honestly, so weak fits can be dropped before any joke is written.

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

## The character (exactly one)

{{PERSONAS}}

It arrives as a bullet with sub-lines: wants / pretends / does compulsively / would never admit / comic emotion / best joke behavior / emotional palette. Copy its lines rather than rewriting them. Do not add, replace, or rename characters: `candidates` holds this one record and nothing else.

---

# STEP 1 — READ THE EVENTS

## event_core

What happened, one sentence, facts only. With several events, the one sentence that covers all of them.

## obvious_contradiction

The thing everyone can SEE that the responsible actor is pretending not to see. With several events, the contradiction they share.

---

# STEP 2 — THE CHARACTER, ONCE

One compact record for the supplied character:

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

---

# STEP 3 — FIT THE CHARACTER TO EVERY EVENT

## per_event

One entry per numbered event, in order, whether or not the fit is good. Each entry is the character's COMPLETE reading of that one event — the joke-writing step sees nothing else — so every field below is written for THAT event in its own terms:

- `event` — its number
- `fit_checks` — three named tests, in this order, each with `passes` (true or false) and `reason` (one sentence naming the event detail that satisfies it, or the specific thing that is absent):
  - `distinctive_detail` — a specific detail of THIS event sets this character off; a complaint that could be about anything fails
  - `character_is_actor` — the character itself did or said something in the event; a character that is only implicated, blamed, or imaginable fails
  - `pathology_on_display` — what the character did or said in the event already shows its `pretends` / `does_compulsively` lines, so the jokes need to invent no behavior; fails whenever the joke would have to supply the character's response
- `fits` — the number of checks that pass, 0–3. It is a count, not a judgment.
- `why_it_fits` — one sentence naming the event detail AND the character instinct it activates (or, at 0–1, why the character has no purchase)
- `trigger_feature` — the exact event detail that activates the character
- `persona_event_translation` — "event reality → what this character says it is", for this event
- `comic_contradiction` — what the character claims vs what everyone can see in this event (name the claim AND the visible fact)
- `joke_target` — who or what ends up ridiculous in this event
- `manifestations` — 2–3 roles the character shows up as in THAT event
- `reusable_engine` — the engine filled in with this event's own terms
- `punch_direction` — `up` | `lateral` | `self` | `down`
- `best_reactions` — 1–2 `reaction` strings copied VERBATIM from this character's `emotional_palette`
- `why_promising` — one sentence: what makes this event a good joke for this character (or, at 0–1, what is missing)

An honest 0 or 1 is worth more than a forced 3: jokes written from a poor fit come out generic, and the page lets the user skip that event. The joke-writing step sees ONE event at a time and receives only that event's entry, so every entry must stand on its own. One event means one entry.

---

# STEP 4 — SCORE THE CHARACTER, 0–3

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

`total_score` is the exact sum of the five, out of 15, for the character across all events; the per-event judgment lives in `per_event.fits`.

---

# STEP 5 — SELECT

`selected_personas` holds the one character, as a pick list only: `persona` (copied VERBATIM from its `candidates` record), `source` (`recurring_trope`), `why_this_persona_is_promising` — one sentence on which events it fits best.

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
"obvious_contradiction": ""
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
"fit_checks": [
{ "check": "distinctive_detail", "passes": true, "reason": "" },
{ "check": "character_is_actor", "passes": true, "reason": "" },
{ "check": "pathology_on_display", "passes": true, "reason": "" }
],
"fits": 0,
"why_it_fits": "",
"trigger_feature": "",
"persona_event_translation": "",
"comic_contradiction": "",
"joke_target": "",
"manifestations": [
""
],
"reusable_engine": "",
"punch_direction": "<up | lateral | self | down>",
"best_reactions": [
"<copied VERBATIM from this character's emotional_palette reaction>"
],
"why_promising": ""
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
3. `candidates` holds exactly one record, the supplied character, and `selected_personas` names it verbatim with only `persona`, `source`, `why_this_persona_is_promising`.
4. Every `emotional_palette` entry has a `gif_emotion` a familiar reaction GIF could show without explanation.
5. Every `does_compulsively` entry is a filmable behavior, not an adjective.
6. A supplied character's pathology is copied, not rewritten.
7. Every `comic_contradiction` names the claim AND the visible fact.
8. Every prose field is one sentence of at most 25 words; every list at most 5 items.
9. `per_event` has exactly one entry per numbered event, numbered in order (one entry for one event); every `fit_checks` has exactly the three named checks in order, each with a boolean `passes` and a reason that names a detail or its absence; every `fits` equals the number of its checks that pass; every `why_it_fits` names an event detail and a character instinct; every `best_reactions` string appears verbatim as a `reaction` in that character's `emotional_palette`.
10. Every `per_event` entry is complete — translation, contradiction, target, manifestations, engine, punch direction, why — and written in THAT event's own terms, never copied from another entry or from the top-level record.

If any check fails, fix it before responding.
