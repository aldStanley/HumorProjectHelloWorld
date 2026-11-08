<!-- Snapshot of flavor 1558 (1558-lydia-9-5-26-pov-jokes-persona-pays-from-1555) step 1 "S1: Find the POVs worth joking from (one call per moment)" (step id 3450), taken 2026-09-05T18:13:38.351Z from the DB, which is the source of truth. The page fills {{EVENT}}, {{EVENT_CONTEXT}}, and {{PERSONAS}} before sending. System prompt: "" -->

You are given a real campus event and a library of recurring campus personas.

Your job is to identify which personas are most promising for generating image + caption jokes about this specific event.

Do NOT generate captions yet.

The goal is to find personas that create distinct, specific, high-potential comic interpretations of the event.

The key question is NOT:

"Could this persona have a reaction to this event?"

Almost any persona could.

The key question is:

"Does something specific about this event strongly activate this persona's characteristic way of seeing the world?"

A strong persona creates a distinctive transformation:

event feature → persona processing rule → comic interpretation

A weak persona merely adds persona vocabulary to the event.

Example of weak fit:

event → gamer → "this is a side quest"

Example of strong fit:

policy removes a previously available advantage → gamer → "the latest patch nerfed the strategy everyone was using"

---

# INPUT

## Campus Event

{{EVENT}}

## Optional Event Context

{{EVENT_CONTEXT}}

## Recurring Persona Library

{{PERSONAS}}

Each recurring persona arrives as a PATHOLOGY: four lines with fixed labels.

* <persona name>
  - wants: <what they are after>
  - pretends: <the self-image they perform>
  - does compulsively (and pays for): <2-4 exact filmable behaviors through which the pathology becomes visible>
  - would never admit: <the fact that punctures the pretense>

The pathology IS the persona. A processing rule ("event → money, status, leverage") is a function, and a function has nothing to expose. The gap between `pretends` and `would never admit` is what a joke exposes; the compulsive behaviors are how the exposure shows on screen.

The parenthetical `and pays for` is a LEGACY INPUT LABEL: interpret it as behavior that exposes the pathology, not a requirement for literal loss.

SELF-EXPOSURE IS THE PAYOFF. For any persona with a non-null `pretends`, the eventual joke must make something ridiculous about THAT PERSON visible through their own behavior.

Use this causal chain:

`event trigger → persona pathology → characteristic behavior → comic self-exposure`

Do NOT require an incidental punishment after the behavior. Missing dinner, losing sleep, being late, wasting an evening, or similar generic losses do not create self-exposure.

The behavior itself may be the consequence when it reveals the pathology: overreach, opportunism, compulsive correction, ownership, status anxiety, resolution resistance, or goal corruption.

INCIDENTAL-CONSEQUENCE TEST: could the exact consequence attach unchanged to almost any obsessive persona? If yes, reject it.

SELF-EXPOSURE TEST: after the behavior, ask "What is ridiculous about THIS PERSON now?" If the answer is only effort, vocabulary, or lost time, reject it.

REMOVE-THE-PUNISHMENT TEST: delete any final "and then they miss/lose/fail X" clause. If the joke is unchanged or stronger, that punishment was incidental.

(Illustration of the SHAPE only — never copy it into output:

* the wannabe sommelier
  - wants: to be the person at the table who can read a label
  - pretends: he chose the bottle; he always chooses the bottle
  - does compulsively (and pays for): swirls a $6 screw-top, says "notes of cherry" before tasting, sends the wine list to the group chat
  - would never admit: he picked it because it was the second-cheapest)

DO NOT ECHO THE LIBRARY. For a library persona, `persona_pathology` is `null` in every array: the page attaches the supplied four lines to your output by persona name, so `persona` must be the library name copied VERBATIM. Read `pretends` from the supplied entry to apply the PRETENDS RULE. Write the four lines yourself ONLY for personas you discover, and only once, in `selected_personas`.

If a library entry arrives as a one-line comic logic instead of a pathology, treat its `pretends` as unknown: apply the ordinary role choice and say so in `evaluation_notes`.

---

# CORE TASK

Perform the following analysis internally, then return the result using the exact JSON schema specified at the end of this prompt.

LENGTH IS A CONTRACT: every prose field is ONE sentence of at most 25 words. Lists hold at most 4 items. The output is read by a page and a second prompt, not by a person; a second sentence is cost, not credit.

---

# STEP 1 — EXTRACT EVENT COMIC AFFORDANCES

First understand the event independently of any persona.

Identify:

## event_core

A concise factual description of what happened.

Do not include the joke interpretation yet.

## event_affordances

Identify approximately 5–12 concrete properties of the event that could support humor.

Look especially for:

* money
* cost
* scarcity
* status
* prestige
* embarrassment
* winners and losers
* power
* authority
* coercion
* hypocrisy
* reversal
* contradiction
* bureaucracy
* institutional language
* inconvenience
* delay
* academic consequences
* grade consequences
* social consequences
* romantic consequences
* career consequences
* access to campus spaces
* absurd scale
* escalation
* anticlimax
* ritual
* rule changes
* competition
* uncertainty
* reputational consequences
* implementation problems
* downstream work
* opportunity for clout/content/networking
* strange American or Columbia-specific behavior

Each affordance must contain:

* `feature`
* `why_comically_useful`

Avoid vague features such as:

"this is controversial"

Prefer specific features such as:

"Columbia has to absorb a very large unexpected financial cost."

---

# STEP 2 — EVALUATE EVERY RECURRING PERSONA

Evaluate EVERY persona supplied in `{{PERSONAS}}`.

Do not silently skip weak personas.

For each persona determine:

## trigger_feature

What exact feature of THIS event activates the persona's existing comic machinery?

If there is no meaningful trigger, use `null`.

## persona_processing_rule

Complete this conceptual sentence:

"When this persona encounters an event like this, they characteristically convert it into ______."

This should describe the persona's reusable mental/comic machinery, not just their reaction to this one event.

Examples:

CC professor:

"contemporary event → canonical philosophical framework"

financial officer:

"institutional event → cost and budget consequence"

social justice warrior:

"specific issue → larger systemic structure → additional unresolved struggle"

wannabe finance bro:

"event → money, leverage, status, networking, or deal logic"

## persona_event_translation

Apply the processing rule specifically to THIS event.

Use the conceptual structure:

"event reality → what this persona sees"

For example:

"large federal settlement → expensive deal whose winner and loser need to be identified"

## persona_pathology

`null` for a library persona (the page attaches the supplied lines). The four lines are written only for a discovered persona, and only in `selected_personas`; there, every field is a string except `pretends`, which is `null` ONLY when the persona genuinely performs no self-image (a plain functional role such as a housing clerk).

## who_pays

`who_pays` is a LEGACY FIELD NAME. For personas with non-null `pretends`, it records the COMIC BOOMERANG or SELF-EXPOSURE, not necessarily literal loss.

THE PRETENDS RULE (mechanical, no exceptions): if the persona's `pretends` is non-null, `comic_role` is `target` and `who_pays.entity` names the persona.

For those personas, `who_pays.what_it_costs` describes how their own pathology exposes, undermines, corrupts, overextends, or makes ridiculous their behavior in THIS event.

The causal chain MUST be:

`persona flaw → persona-specific behavior → comic consequence/exposure`

NOT:

`persona does something → unrelated inconvenience happens afterward`

Valid comic boomerangs include:

* SELF-DEFEAT — the behavior undermines the goal they claim to want
* OVERREACH — a normal situation triggers an absurdly oversized persona-specific response
* SOCIAL FRICTION — the persona turns agreement, help, or an ordinary interaction into something dysfunctional
* OWNERSHIP LEAK — the persona reveals that being the expert, interpreter, winner, or authority matters alongside the stated goal
* RESOLUTION RESISTANCE — getting what they ostensibly wanted immediately produces a new reason the issue remains unfinished
* OPPORTUNISM — the worldview produces revealingly selfish, predatory, or status-seeking behavior
* PRETENSE PUNCTURE — the behavior reveals the fact in `would_never_admit`
* GOAL CORRUPTION — pursuit of the stated goal becomes distorted by the persona's own obsession

A literal loss is allowed only when the specific WAY it happens reveals this persona's pathology.

WRONG: wannabe sommelier + gas station starts selling wine → who_pays: "the sommelier — he reads every label on the rack and misses the last bus" — missing the bus is interchangeable punishment and adds nothing about the persona
RIGHT: wannabe sommelier + gas station starts selling wine → who_pays: "the sommelier — he lets a $6 screw-top breathe on the hood of his car under the pump lights" — the behavior itself is the exposure; nothing else has to go wrong
RIGHT SHAPE: "a simple practical question triggers a massive self-appointed archive" — the oversized response itself reveals the need to be the definitive interpreter.

A persona whose `pretends` is null follows the ordinary role choice; `who_pays` may then name the institution, process, stakeholder, or persona actually exposed.

THE SECRET GAIN: if the persona simply wins, looks smart, or proves their pretense correct, the joke lands elsewhere unless their behavior still exposes pathology.

IMAGINING IT: a daydream in which the persona wins is exposure ONLY when the daydream itself is the ridiculous thing — its scale or its object reveals `pretends` or `would_never_admit`. A daydream that is a flex told straight scores 0, however self-aware the framing sounds.
WRONG: "picturing the whole table applauding his pick" — the win is the content; nothing about him is punctured
RIGHT: "picturing the cashier remembering him as the wine guy from the $6 shelf" — the object of the daydream is what he would never admit

(Illustrations only — never copy them into output.)

## comic_role

Choose the strongest role from:

* `target`
* `affected_stakeholder`
* `straight_man`
* `functional_role`
* `persona_archetype`
* `opportunist`
* `bystander`
* `other`

This describes the persona's role in the JOKE, not merely their literal role in the event.

## likely_joke_target

What would actually be made ridiculous from this point of view?

Examples:

* the persona itself
* Columbia administration
* federal government
* bureaucracy
* campus culture
* institutional language
* the absurdity of the situation
* another stakeholder

When the PRETENDS RULE applies, this names the persona first; others may follow.

## comic_contradiction

Identify the tension that could power the joke.

Useful structures include:

"Everyone else sees X, while this persona sees Y."

or:

"It is funny that X, while Y."

A CONTRAST IS NOT A TENSION. A tension names what the persona WANTS or PRETENDS and how THIS event activates behavior that blocks, corrupts, overextends, or exposes it. The blocking force may be the persona's own flaw.

WRONG: "Everyone else sees a gas station, while the wannabe sommelier sees a cellar."

RIGHT: "It is funny that he wants to be the man who can read a label, while the label is a $6 screw-top and the cashier watched him pick it."

(Illustrations only — never copy them into output.)

## joke_runway

Briefly explain whether this interpretation naturally supports multiple concrete jokes, behaviors, or images.

---

# STEP 3 — SCORE EVERY RECURRING PERSONA

Give integer scores from 0 through 3.

## trigger_strength

0 = no meaningful trigger
1 = weak connection
2 = natural connection
3 = event strongly activates the persona

## persona_specificity

0 = could be anyone
1 = mildly persona-flavored
2 = clearly fits this persona
3 = unmistakably this persona

## event_specificity

0 = could attach to almost any headline
1 = loosely uses this event
2 = uses an important event detail
3 = depends on something distinctive about this event

## comic_transformation

0 = merely restates the event
1 = adds vocabulary or attitude
2 = meaningfully reframes the event
3 = produces a surprising but recognizable alternate interpretation

## joke_runway_score

0 = no clear joke direction
1 = perhaps one joke
2 = several plausible jokes
3 = many concrete image/caption possibilities

## expense_fit

This is a LEGACY FIELD NAME. Score PATHOLOGY PAYOFF / SELF-EXPOSURE, not literal financial, temporal, or material expense.

0 = persona merely supplies a lens, vocabulary, or clever observation; nothing ridiculous about the persona is exposed
1 = a flaw is visible, but the outcome is generic, incidental, postfixed, or could attach unchanged to many personas
2 = the flaw clearly causes an event-specific overreach, contradiction, social distortion, or revealing behavior, but the exposure is mild
3 = the pathology directly CAUSES the comic outcome and punctures `pretends`, reveals `would_never_admit`, corrupts the goal, or makes the characteristic behavior ridiculous

A 3 does NOT require material loss.

When the PRETENDS RULE applies and this scores 0 or 1, the pairing is weak whatever the other scores say.

Then calculate:

`total_fit_score`

as the exact sum of those six values.

Maximum score = 18.

Do NOT inflate scores simply to preserve personas from the supplied library.

Some personas SHOULD score poorly.

Assign:

`verdict`

using exactly one of:

* `strong`
* `medium`
* `weak`

As a default:

* 14–18 = strong
* 9–13 = medium
* 0–8 = weak

You may deviate only if there is a strong qualitative reason, which should appear in `evaluation_notes`.

---

# STEP 4 — DISCOVER EVENT-NATIVE PERSONAS

Do not rely only on the supplied recurring persona library.

Find roles that become funny specifically because of THIS event.

Systematically consider:

## Direct actors

Who:

* caused it?
* decided it?
* negotiated it?
* announced it?
* opposed it?

## Affected stakeholders

Who:

* benefits?
* loses?
* is protected?
* is inconvenienced?
* is angry?
* is relieved?

## Implementers

Who:

* now has to make this happen?
* receives additional work?
* has to enforce it?
* has to track compliance?

## Financial roles

Who:

* pays?
* has to find the money?
* loses resources?
* explains the cost?

## Explainers

Who has to explain it to:

* students?
* parents?
* prospective students?
* donors?
* faculty?
* alumni?
* journalists?
* government officials?

## Reputation roles

Who has to:

* spin it?
* defend it?
* hide it?
* euphemize it?
* answer awkward questions about it?

## Opportunists

Who suddenly has:

* a story?
* content?
* a networking opportunity?
* a campaign issue?
* a research topic?
* a résumé line?
* increased status?

## Bystanders

Who barely cares about the substantive issue but experiences some mundane consequence?

## Downstream roles

Ask especially:

"Who wasn't central to the event, but now has a funny problem because it happened?"

Examples could include:

* university financial officers
* university lawyers
* tour guides
* admissions officers
* PR staff
* student journalists
* librarians
* RAs
* campus security
* faculty
* teaching assistants
* parents
* prospective students
* donor relations
* alumni relations

Generate approximately 5–10 event-native candidates.

For every event-native persona include:

* `persona`
* `source`
* `relationship_to_event`
* `trigger_feature`
* `persona_baseline`
* `who_pays`
* `persona_processing_rule`
* `persona_event_translation`
* `comic_role`
* `likely_joke_target`
* `comic_contradiction`
* `joke_runway`

For `source`, use:

`"event_native"`

---

# STEP 5 — SEARCH FOR NARROW-LENS PERSONAS

Deliberately search for perspectives that care about a comically narrow aspect of the event.

Ask:

"What is the small, selfish, professional, obsessive, logistical, or mundane thing somebody might care about while everyone else focuses on the big issue?"

This often creates:

BIG EVENT × SMALL PERSONAL CONCERN

Examples:

Huge settlement:

finance officer → "Where does the money come from?"

Campus protest:

premed → "Can I still get into Butler?"

National controversy:

tour guide → "How do I explain this to visiting parents?"

Major policy change:

recent graduate → "You're telling me they change this NOW?"

Generate approximately 3–5 narrow-lens discoveries if there are good ones.

If one duplicates an existing candidate, do NOT create a duplicate persona. Strengthen the existing candidate instead.

For genuinely new narrow-lens personas use:

`"source": "narrow_lens"`

---

# STEP 6 — FAVOR DISTINCT COMIC TRANSFORMATIONS

Do NOT optimize primarily for political viewpoint diversity.

Optimize for different ways of SEEING the event.

Useful transformation families include:

* event → money problem
* event → status problem
* event → romantic problem
* event → academic inconvenience
* event → philosophical framework
* event → systemic injustice
* event → game mechanic
* event → networking opportunity
* event → legal exposure
* event → PR problem
* event → bureaucratic implementation
* event → strange American ritual
* event → evidence of personal misery
* event → mundane downstream inconvenience
* event → opportunity for attention
* event → proof of preexisting worldview
* event → workload
* event → threat to routine
* event → institutional embarrassment

Penalize candidate sets in which several personas perform essentially the same transformation.

Five personas all saying some version of:

"This proves I was right"

is NOT a diverse set.

---

# STEP 7 — RANK ALL CANDIDATES TOGETHER

Combine:

1. recurring personas
2. event-native personas
3. narrow-lens discoveries

Consider:

* trigger strength
* persona specificity
* event specificity
* comic transformation
* joke runway
* student recognizability
* visual potential
* distinctiveness from other candidates

For newly discovered personas, also assign the same six 0–3 scores used for recurring personas and calculate `total_fit_score`.

---

# STEP 8 — SELECT THE BEST PERSONA SET

Choose approximately 5–8 personas.

Do NOT mechanically take only the highest scores if that would create redundant comic lenses.

The final set should maximize:

strong individual fit + diversity of comic transformations

DO NOT REPEAT THE RECORD. Every selected persona already has its full evaluation in one of the three arrays above, and the page joins the two by name. `selected_personas` is a pick list:

## persona

The persona name, copied VERBATIM from its evaluation record.

## source

Exactly one of:

* `recurring_trope`
* `event_native`
* `narrow_lens`

## persona_pathology

`null` for a library persona. For a discovered persona, the four lines (`wants`, `pretends`, `does_compulsively`, `would_never_admit`), written here and nowhere else. Step 2 treats them as binding.

## why_this_persona_is_promising

One sentence on why this pairing deserves full joke generation.

---

# STEP 9 — REPORT WEAK RECURRING PERSONAS

Identify supplied recurring personas that should probably NOT be used for this event.

Do not invent weak personas just to reach a quota.

For each include:

* `persona`
* `trigger_feature`
* `why_skip`
* `total_fit_score`

Good reasons include:

* no concrete event feature activates the persona
* only generic vocabulary substitution is available
* joke would work for almost any headline
* another persona captures the same transformation much better
* there is no meaningful visual or behavioral runway

---

# STEP 10 — COVERAGE CHECK

Inspect the final selected persona set.

Identify the distinct comic transformations represented.

Examples:

* event → money
* event → philosophical framework
* event → systemic struggle
* event → institutional PR problem
* event → mundane inconvenience

Then identify any pairs that remain potentially redundant.

Finally give:

`selection_summary`

A concise explanation of why the selected set gives strong coverage of the event.

---

# CRITICAL HUMOR PRINCIPLES

1. Persona selection is about COMIC ACTIVATION, not topical relevance.
2. Always identify the exact trigger.
3. Always identify the persona's transformation.
4. Avoid vocabulary substitution.

Bad:

"gamer → calls someone an NPC"

Better:

"rule change → gamer interprets it as a patch nerf"
5. Favor behavior over adjectives.

Bad:

"financial officer is worried"

Better:

"financial officer immediately opens the budget and starts deciding which line becomes nonessential"
6. Do not require a strong political opinion.

Humor may come from:

* inconvenience
* workload
* tunnel vision
* status
* confusion
* opportunism
* bureaucracy
* selfishness
* obsession
* mundane consequences
7. Look downstream.

The person inheriting the consequence can be funnier than the person who caused the event.

8. A persona with a non-null `pretends` IS the joke target (the PRETENDS RULE). Only a persona performing no self-image can be a straight man, functional role, or bystander.
9. Preserve the emotional truth of genuinely affected groups.

Do not manufacture malicious motives simply because the system needs humor.

10. Prefer event-specific insight over generic meme compatibility.
11. A persona is especially strong when you can complete:
"Everyone else sees ______. This persona sees ______. That makes them DO ______. And that reveals ______."

Under the PRETENDS RULE, the final blank must name what becomes ridiculous about the persona, not merely what happens to them.

12. The loss/consequence cannot be incidental; it must be caused by the persona flaw and reveal that flaw.
13. A joke may expose the persona through overreach, ownership, correction, opportunism, self-defeat, resolution resistance, or another pathology-driven boomerang.
14. Reject weak pairings instead of forcing them.

---

# JSON OUTPUT CONTRACT

Return ONLY one valid JSON object.

Do not include:

* Markdown
* code fences
* commentary before the JSON
* commentary after the JSON
* trailing commas
* JavaScript comments
* undefined values
* NaN
* ellipses such as "..."

Use valid double-quoted JSON strings.

Use integers for all scores.

Use `null` when a value genuinely does not apply.

Use empty arrays `[]` rather than inventing content when no good candidates exist.

Do NOT change field names.

The output MUST conform to this exact top-level structure:

{
"event": {
"event_core": "",
"event_affordances": [
{
"feature": "",
"why_comically_useful": ""
}
]
},
"recurring_persona_evaluations": [
{
"persona": "",
"source": "recurring_trope",
"trigger_feature": null,
"persona_baseline": "",
"persona_pathology": "<null — a library persona; the page attaches the supplied four lines>",
"who_pays": {
"entity": "",
"what_it_costs": ""
},
"persona_processing_rule": "",
"persona_event_translation": "",
"comic_role": "<one of the allowed comic_role values>",
"likely_joke_target": "",
"comic_contradiction": "",
"joke_runway": "",
"scores": {
"trigger_strength": 0,
"persona_specificity": 0,
"event_specificity": 0,
"comic_transformation": 0,
"joke_runway": 0,
"expense_fit": 0,
"total_fit_score": 0
},
"verdict": "<strong | medium | weak>",
"evaluation_notes": ""
}
],
"event_native_personas": [
{
"persona": "",
"source": "event_native",
"relationship_to_event": "",
"trigger_feature": "",
"persona_baseline": "",
"who_pays": {
"entity": "",
"what_it_costs": ""
},
"persona_processing_rule": "",
"persona_event_translation": "",
"comic_role": "<one of the allowed comic_role values>",
"likely_joke_target": "",
"comic_contradiction": "",
"joke_runway": "",
"scores": {
"trigger_strength": 0,
"persona_specificity": 0,
"event_specificity": 0,
"comic_transformation": 0,
"joke_runway": 0,
"expense_fit": 0,
"total_fit_score": 0
}
}
],
"narrow_lens_personas": [
{
"persona": "",
"source": "narrow_lens",
"relationship_to_event": "",
"trigger_feature": "",
"persona_baseline": "",
"who_pays": {
"entity": "",
"what_it_costs": ""
},
"persona_processing_rule": "",
"persona_event_translation": "",
"comic_role": "<one of the allowed comic_role values>",
"likely_joke_target": "",
"comic_contradiction": "",
"joke_runway": "",
"scores": {
"trigger_strength": 0,
"persona_specificity": 0,
"event_specificity": 0,
"comic_transformation": 0,
"joke_runway": 0,
"expense_fit": 0,
"total_fit_score": 0
}
}
],
"selected_personas": [
{
"persona": "<copied VERBATIM from its evaluation record>",
"source": "<recurring_trope | event_native | narrow_lens>",
"persona_pathology": "<null for a library persona; for a discovered persona an object with wants, pretends, does_compulsively (a list), would_never_admit>",
"why_this_persona_is_promising": ""
}
],
"weak_fits_to_skip": [
{
"persona": "",
"trigger_feature": null,
"why_skip": "",
"total_fit_score": 0
}
],
"coverage_check": {
"comic_transformations_represented": [
""
],
"potentially_redundant_pairs": [
{
"persona_1": "",
"persona_2": "",
"overlap": ""
}
],
"selection_summary": ""
}
}

---

# FIELD CONSISTENCY RULES

The following fields have specific meanings and MUST remain consistent because they will be consumed by another prompt.

## `persona_baseline`

The recognizable recurring stereotype, role, habit, concern, or behavior.

It should NOT describe only this particular event.

## `persona_pathology`

`null` for a library persona everywhere. For a discovered persona, an object in `selected_personas` only: `wants`, `pretends`, `does_compulsively` (a list of exact filmable behaviors), `would_never_admit`.

## `who_pays`

Legacy name: for non-null `pretends`, `entity` is the persona and `what_it_costs` is the pathology-driven comic boomerang or self-exposure, not necessarily literal loss.

For `pretends: null`, the field may describe the actual stakeholder, institution, process, or persona that loses or is exposed.

## `trigger_feature`

The concrete property of THIS event that activates the persona.

## `persona_processing_rule`

The GENERAL transformation the persona habitually performs.

Example:

"institutional event → budget consequence"

## `persona_event_translation`

The application of that rule during evaluation.

Example:

"large settlement → unexpected expense that has to come from somewhere"

## `comic_role`

Describes the persona's role in the humor.

Allowed values ONLY:

* `target`
* `affected_stakeholder`
* `straight_man`
* `functional_role`
* `persona_archetype`
* `opportunist`
* `bystander`
* `other`

## `likely_joke_target`

Describes who or what the eventual joke is likely to attack or expose.

This may differ from the persona.

## `comic_contradiction`

The central tension between what the persona wants or pretends and the behavior this event activates in them.

## `source`

Allowed values ONLY:

* `recurring_trope`
* `event_native`
* `narrow_lens`

---

# FINAL VALIDATION BEFORE RESPONDING

Before returning the JSON, silently check:

1. Is it valid JSON?
2. Are all supplied recurring personas represented in `recurring_persona_evaluations`?
3. Are all score fields integers from 0–3?
4. Does every `total_fit_score` equal the sum of its six component scores?
5. Are all enum values legal?
6. Does every selected persona name a record that exists in one of the three evaluation arrays, verbatim, and carry nothing but `persona`, `source`, `persona_pathology`, and `why_this_persona_is_promising`?
7. Are weak personas actually allowed to remain weak?
8. Are the selected personas diverse in comic transformation rather than merely political viewpoint?
9. Are there any duplicate personas across discovery arrays that should have been merged?
10. Is there any text outside the JSON object?
11. Does every persona with non-null `pretends` have `comic_role` = `target` and `who_pays.entity` naming that persona?
12. Does every `total_fit_score` include `expense_fit`, out of 18?
13. Does every `comic_contradiction` name a want or pretense and how this event activates behavior that blocks, corrupts, overextends, or exposes it?
14. Is every `does_compulsively` entry a filmable behavior rather than an adjective?
15. Is `persona_pathology` `null` for every library persona, and is every library `persona` name copied verbatim?
16. Is every prose field one sentence of at most 25 words, and every list at most 4 items?
17. CAUSAL CONSEQUENCE TEST: for non-null `pretends`, does the pathology CAUSE the comic outcome rather than merely precede an incidental loss?
18. SELF-EXPOSURE TEST: can you state specifically what becomes ridiculous about the persona because of their behavior?
19. REMOVE-THE-PUNISHMENT TEST: if a final "misses/loses/fails" clause is deleted, does the comic logic survive unchanged or improve? If yes, remove it.

If any check fails, fix it before responding.
