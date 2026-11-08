<!-- Snapshot of flavor 1559 (1559-lydia-9-5-26-event-native-cast-from-1558) step 1 "S1: Find the POVs worth joking from (one call per moment)" (step id 3454), taken 2026-09-05T18:30:05.290Z from the DB, which is the source of truth. Lydia's event-native cast prompt plus an INPUT block, a LENGTH rule, a JSON contract, and a validation list so the page can read it. The page fills {{EVENT}} and {{EVENT_CONTEXT}}; there is no persona library. Step 2 is 1558's. System prompt: "" -->

You are given a real campus event.

Your job is to derive the PEOPLE, ROLES, GROUPS, and INSTITUTIONS that are inherently funny POVs for this specific event.

Do NOT begin from a recurring persona library.

Do NOT ask:

"What generic personality type could react to this?"

Instead ask:

"Who does this event itself create as a comic character?"

The goal is to build an EVENT-NATIVE CAST.

A strong candidate exists because of the causal structure, power structure, consequences, contradictions, or implementation of THIS event.

The best joke may come from:
- the actor who caused the problem
- the institution defending the decision
- the person enforcing it
- the person stuck implementing it
- the person harmed by it
- the person benefiting from it
- the person trying to spin it
- the person forced to explain it
- the person opportunistically using it
- the person whose ordinary job has become absurd because of it

The POV may speak in the voice of the joke target.

For example:

powerful institution makes controversial decision
→ institution explains its own behavior in sanitized language
→ its internal logic becomes self-indicting

This is often stronger than having an unrelated archetype comment on the institution from outside.

---

# INPUT

## Campus Event

{{EVENT}}

## Optional Event Context

{{EVENT_CONTEXT}}

---

# CORE PRINCIPLE: BUILD THE CAST FROM THE EVENT

First determine:

1. What happened?
2. Who caused, chose, maintained, enabled, enforced, opposed, experienced, benefited from, or inherited the consequences?
3. Where is the power?
4. Where is the contradiction?
5. Whose POV would reveal that contradiction most efficiently?

Do not assume the loudest speaker in the source material is the best joke target.

Do not assume every affected student must become a target.

When an event contains a clear power imbalance or contested institutional decision, explicitly search for a POV that punches UP at the actor with meaningful power or responsibility.

---

# STEP 1 — EXTRACT THE EVENT STRUCTURE

Identify:

## event_core

A concise factual description of what happened.

Separate factual event information from interpretations or accusations contained in reactions.

## contested_issue

What are people actually angry, amused, confused, relieved, or divided about?

## causal_chain

Identify the important causal sequence.

Example shape:

decision → implementation → consequence → reaction

## power_map

Identify the actors who had meaningful ability to:
- cause the situation
- choose differently
- maintain it
- reverse it
- enforce it
- define how it is publicly described

## consequences

Identify concrete:
- burdens
- restrictions
- benefits
- inconveniences
- hypocrisies
- implementation work
- social consequences
- reputational consequences
- absurdities

---

# STEP 2 — DERIVE EVENT-NATIVE PERSONA CANDIDATES

Systematically search ALL of the following categories.

Do not merely consider them internally; emit strong candidates you find.

## A. POWER-HOLDERS / POSSIBLE ANTAGONISTS

Who:
- made the contested decision?
- authorized it?
- maintains it?
- could reverse it?
- benefits from presenting it as necessary or normal?

Ask:

"What would become ridiculous if this actor's internal reasoning were said out loud?"

Favor SELF-INDICTING POV satire:

stated rationale → behavior actually implied by the event

A powerful actor may be BOTH:
- the POV speaking the caption
- the target being mocked

When the event clearly contains a powerful responsible actor, generate at least one candidate from this category.

---

## B. DEFENDERS / SPINNERS

Who has to:
- justify the decision?
- write the announcement?
- choose the euphemism?
- reassure people?
- explain why an obviously strange situation is supposedly normal?
- answer awkward questions without conceding the criticism?

Look for gaps between:

what they SAY is happening
vs.
what everyone can SEE is happening

---

## C. ENFORCERS / IMPLEMENTERS

Who now has to physically or bureaucratically make the policy happen?

Examples:
- security
- administrators
- RAs
- faculty
- registrars
- housing staff
- IT
- lawyers

Ask:

"What absurd behavior does this policy force them to perform repeatedly?"

The implementer need not be morally responsible to be funny.

---

## D. AFFECTED PEOPLE

Who actually experiences the consequence?

Ask:
- What do they lose?
- What becomes harder?
- What ordinary activity becomes absurd?
- What expectation gets violated?

Preserve legitimate emotional stakes.

Do not manufacture a flaw in an affected person merely because the system needs a persona target.

An affected person may be:
- the joke target
- a straight man
- the sympathetic POV attacking someone more powerful

---

## E. BENEFICIARIES

Who gets:
- more control?
- more access?
- less competition?
- more money?
- more protection?
- more status?
- an easier job?
- a new advantage?

Ask whether the benefit itself creates an uncomfortable or absurd POV.

---

## F. OPPORTUNISTS

Who suddenly gets:
- content?
- clout?
- a campaign issue?
- a résumé line?
- a consulting engagement?
- a research topic?
- a fundraising opportunity?
- an excuse for something they already wanted?

The opportunity must arise specifically from THIS event.

---

## G. EXPLAINERS / INTERMEDIARIES

Who now has to explain this event to someone else?

Examples:
- tour guides
- admissions officers
- professors
- parents
- student journalists
- administrators
- orientation leaders

Ask:

"What impossible, awkward, contradictory, or absurd explanation have they inherited?"

---

## H. DOWNSTREAM CASUALTIES

Who was not central to the original event but now has a weird new problem because it happened?

Look especially for mundane consequences of large events.

---

## I. WITNESSES / VETERANS / HISTORIANS

Who remembers the before-state?

Who now has to tell newer people:

"This did not used to be normal"?

Use this only when the event genuinely creates a meaningful before/after divide.

---

# STEP 3 — TURN ROLES INTO COMIC PERSONAS

A job title or institution is not yet a comic persona.

For every promising event-native role, derive its comic pathology.

Use:

## persona

A concise event-native persona name.

Examples of SHAPE:
- Columbia administrator defending the policy
- campus security officer enforcing the new rule
- freshman discovering the new normal
- admissions tour guide explaining the contradiction

Do not copy these unless they actually fit the event.

## relationship_to_event

Why this actor exists in the comic cast.

## wants

What does this actor want in this event?

This should be concrete.

## pretends

What self-image, official story, public rationale, or moral position do they perform?

Use `null` if there genuinely is no pretense.

Institutions can have a `pretends`.

Example shape:

"we are preserving openness while ensuring safety"

## does_compulsively

2–4 exact, filmable behaviors produced by the event.

Prefer:
- issuing
- checking
- explaining
- defending
- redirecting
- enforcing
- rewriting
- euphemizing
- apologizing
- optimizing
- documenting

Avoid adjectives.

## would_never_admit

What fact punctures the stated rationale or self-image?

Do NOT invent secret evil motives unsupported by the event.

Prefer contradictions visible from the event itself.

---

# STEP 4 — FIND THE COMIC ENGINE

For each persona identify:

## trigger_feature

What exact feature of THIS event activates the persona?

## persona_event_translation

Use:

event reality → what this actor's role turns it into

## comic_contradiction

The contradiction must involve:
- what the actor wants or claims
and
- what their actual behavior reveals

Strong structures include:

"They claim X while having to do Y."

"They want X, but their solution visibly produces Y."

"They are responsible for X and must now pretend X is normal."

"They are trying to solve X in a way that recreates X."

"They insist X is temporary while behaving as though X is permanent."

Avoid mere perspective shifts.

BAD:

"Students see a gate; administrators see security."

That is only a contrast.

BETTER:

"Administration describes campus as open while maintaining a system whose defining behavior is preventing people from freely entering it."

---

# STEP 5 — DETERMINE PUNCH DIRECTION

For each candidate assign:

## joke_target

Who or what is actually being exposed?

## punch_direction

Use exactly one:

- `up`
- `lateral`
- `self`
- `down`

Definitions:

`up` = the joke targets an actor with greater institutional, economic, political, or social power than the sympathetic POV

`lateral` = peers or comparably situated actors

`self` = the POV character exposes their own pathology

`down` = the joke targets someone with materially less power in this event

Prefer `up`, `self`, or justified `lateral` satire.

Treat `down` as a warning signal, especially when the target is genuinely harmed by the event.

Do NOT mechanically reject every `down` joke, but require a strong comic reason.

---

# STEP 6 — POWER-HOLDER CHECK

Before ranking candidates, ask:

"Does this event contain a clearly identifiable actor who made, maintained, defended, or enforced the contested condition?"

If YES:

You MUST include at least one candidate where that actor or institution is:
- the POV
- the joke target
- or both

Ask specifically:

"What would this actor say if the subtext of its behavior became the text?"

This candidate should receive serious consideration even if another generic persona has more obvious meme vocabulary.

---

# STEP 7 — SCORE THE CANDIDATES

Score each dimension 0–3.

## causal_relevance

0 = barely related
1 = adjacent
2 = meaningfully involved
3 = directly caused, experienced, enforced, defended, or inherited this event

## event_specificity

0 = works for almost any headline
1 = loosely related
2 = uses an important event feature
3 = depends on a distinctive detail or contradiction of this event

## comic_contradiction

0 = no contradiction
1 = mostly attitude or vocabulary
2 = meaningful tension
3 = behavior strongly contradicts the actor's stated goal, rationale, or self-image

## behavioral_runway

0 = no concrete behavior
1 = one plausible gag
2 = several behaviors/images
3 = many concrete, filmable executions

## target_clarity

0 = unclear what is ridiculous
1 = vague situation joke
2 = recognizable target
3 = specific actor/pathology/contradiction is unmistakably exposed

## satirical_leverage

0 = no meaningful satirical target
1 = generic criticism
2 = exposes a consequential actor or hypocrisy
3 = event supplies a powerful/responsible actor whose own POV becomes strongly self-indicting

Calculate `total_score` out of 18.

Do not inflate candidates simply because they are politically sympathetic or unsympathetic.

---

# STEP 8 — SELECT THE CAST

Choose approximately 5–8 personas.

The selected cast should NOT merely represent different personality types.

It should represent different POSITIONS IN THE EVENT.

When available, seek coverage across:

- power-holder / antagonist
- defender / spinner
- implementer
- affected person
- downstream role
- opportunist or beneficiary
- explainer / witness

Do not force every category.

Favor strong individual candidates over quota filling.

However:

IF there is a clear powerful actor responsible for the contested condition, do not return a final cast that entirely omits that actor.

---

# CRITICAL HUMOR PRINCIPLES

1. DERIVE PERSONAS FROM THE EVENT, NOT FROM A GENERIC TROPE LIBRARY.

2. CAUSAL POSITION IS A HUMOR RESOURCE.

"Who did this?" can be more important than "Who has a funny personality?"

3. THE VILLAIN'S POV CAN BE THE JOKE.

A caption written from the powerful actor's perspective can punch up when the actor's own logic indicts them.

4. DO NOT CONFUSE POV WITH SYMPATHY.

Speaking in Columbia administration's voice does not mean siding with Columbia administration.

5. DO NOT INVENT MALICE.

Expose contradictions supported by the event rather than assigning unsupported secret motives.

6. PRESERVE REAL GRIEVANCES.

If someone is genuinely harmed, do not manufacture a pathology merely to make them pay.

7. FAVOR SELF-INDICTING LANGUAGE.

The strongest institutional satire often lets an actor sincerely state a rationale whose absurdity is obvious from the event.

8. LOOK FOR:
official story → visible contradiction

policy goal → absurd implementation

temporary measure → permanent behavior

openness → restriction

safety → theatrical bureaucracy

solution → recreation of the problem

9. PUNCHING UP IS NOT A REQUIREMENT FOR EVERY JOKE, BUT IT IS A SEARCH PRIORITY WHEN THE EVENT HAS A CLEAR POWER STRUCTURE.

10. REJECT GENERIC LENSES.

If the same persona could be attached to twenty unrelated campus headlines with only noun substitutions, it is weak.

---

# FINAL TEST

For every selected persona, you should be able to answer:

"Why does THIS PERSON OR INSTITUTION exist as a comic character because THIS EVENT happened?"

And for any clear power-holder:

"What would be funny about hearing their own rationale from their own POV?"

If those answers are weak, reject the candidate.

---

# LENGTH

Every prose field is ONE sentence of at most 25 words. Lists hold at most 4 items. The output is read by a page and a second prompt, not by a person; a second sentence is cost, not credit.

---

# JSON OUTPUT CONTRACT

Return ONLY one valid JSON object. No Markdown, no code fence, no commentary before or after, no trailing commas. Integers for scores. `null` where a value genuinely does not apply. Placeholders in angle brackets are NOT values; never copy them.

{
"event": {
"event_core": "",
"contested_issue": "",
"causal_chain": "<decision → implementation → consequence → reaction, in this event's own terms>",
"power_map": [
{ "actor": "", "power": "<what this actor could cause, choose, maintain, reverse, enforce, or define>" }
],
"consequences": [
""
]
},
"candidates": [
{
"persona": "",
"source": "event_native",
"category": "<A power-holder | B defender | C implementer | D affected | E beneficiary | F opportunist | G explainer | H downstream | I witness>",
"relationship_to_event": "",
"persona_pathology": {
"wants": "",
"pretends": "<string, or null when there is genuinely no pretense>",
"does_compulsively": [
""
],
"would_never_admit": ""
},
"trigger_feature": "",
"persona_event_translation": "",
"comic_contradiction": "",
"joke_target": "",
"punch_direction": "<up | lateral | self | down>",
"scores": {
"causal_relevance": 0,
"event_specificity": 0,
"comic_contradiction": 0,
"behavioral_runway": 0,
"target_clarity": 0,
"satirical_leverage": 0,
"total_score": 0
}
}
],
"selected_personas": [
{
"persona": "<copied VERBATIM from its candidates record>",
"source": "event_native",
"why_this_persona_is_promising": ""
}
],
"power_holder_check": {
"power_holder": "<the responsible actor this event contains, or null>",
"represented_by": "<the selected persona that is that actor as POV or target, or null>"
},
"cast_summary": ""
}

Every candidate you scored appears in `candidates`, selected or not. The page joins each selected persona to its `candidates` record by name, so `selected_personas` carries nothing else.

---

# FINAL VALIDATION BEFORE RESPONDING

1. Valid JSON, with nothing outside the object.
2. Every `total_score` equals the sum of its six 0–3 scores, out of 18.
3. Every selected persona names a `candidates` record verbatim and carries only `persona`, `source`, and `why_this_persona_is_promising`.
4. If `power_holder_check.power_holder` is not null, `represented_by` names a selected persona.
5. Every `does_compulsively` entry is a filmable behavior, not an adjective.
6. Every `punch_direction` of `down` has its strong comic reason stated in `comic_contradiction`.
7. Every `comic_contradiction` names what the actor wants or claims AND what their behavior reveals, not a bare contrast.
8. Every prose field is one sentence of at most 25 words, and every list at most 4 items.

If any check fails, fix it before responding.
