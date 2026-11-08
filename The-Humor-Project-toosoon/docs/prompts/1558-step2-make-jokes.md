<!-- Snapshot of flavor 1558 (1558-lydia-9-5-26-pov-jokes-persona-pays-from-1555) step 2 "S2: Make jokes from ONE POV (one call per selected POV)" (step id 3451), taken 2026-09-05T18:13:38.510Z from the DB, which is the source of truth. The page fills {{EVENT}}, {{PERSONA}}, and {{PERSONA_CONTEXT}} (the step 1 record for one persona, with the library pathology attached) before sending. System prompt: "" -->

You are analyzing a real campus event from the point of view of a specific campus persona or entity in order to generate image + caption meme concepts.
Your goal is NOT merely to describe how the persona would realistically react.
Your goal is to identify the comic machinery that makes this particular event funny when filtered through this particular persona.
The humor should feel recognizable to students familiar with campus culture. It may be affectionate, cynical, absurd, exaggerated, self-aware, or satirical depending on the persona.
INPUT
Campus event
{{EVENT}}
Persona / entity
{{PERSONA}}
Optional context about how students generally perceive this persona
{{PERSONA_CONTEXT}}

The context is step 1's JSON for this persona. Two of its fields are BINDING here:
- `persona_pathology` — wants / pretends / does_compulsively / would_never_admit. This IS the persona; do not re-derive a different one.
- `who_pays` — a legacy name: who is exposed, and how. For a persona with a non-null `pretends` it records SELF-EXPOSURE (their own behavior makes something about them ridiculous), not a literal loss. THE PRETENDS RULE (mechanical, no exceptions): if `pretends` is not null, the persona is the one exposed in every caption.

STEP 1 — UNDERSTAND THE EVENT
Briefly identify:
event_core
What actually happened, stripped of commentary?
most_comically_salient_details
Which 1–3 details are most useful for humor?
Prefer specific details involving money, status, hypocrisy, inconvenience, bureaucracy, conflict, escalation, unusual scale, awkward language, etc.
Do not yet interpret the event through the persona.

STEP 2 — UNDERSTAND THE PERSONA
Start from `persona_pathology`. `persona_baseline` restates it as the archetype students recognize; it never replaces it.
Describe the persona as students would recognize the archetype, not as a neutral encyclopedia entry.
persona_baseline
What is the familiar stereotype, habit, worldview, professional concern, obsession, vulnerability, or behavior associated with this persona?
Focus especially on what they predictably:
notice
care about
complain about
translate things into
overthink
ignore
exploit
fear
get excited about
connect to other things
do compulsively
Avoid generic traits such as "passionate," "intelligent," "concerned," or "responsible" unless made behaviorally specific.
Bad:
passionate about social justice
Better:
turns individual controversies into evidence of larger interconnected systems and rarely accepts that one issue has been fully resolved
Bad:
interested in philosophy
Better:
compulsively maps current campus events onto Plato, Hobbes, Rousseau, or whatever text the class read that week

STEP 3 — DETERMINE THE PERSONA'S COMIC RELATIONSHIP TO THE EVENT
THE PRETENDS RULE decides the role: `persona_pathology.pretends` not null → `comic_role` is `target` and `joke_target` names the persona first (others may follow). Only a persona with a null `pretends` chooses among the other roles.
Possible roles include:
TARGET
We are primarily laughing at the persona/entity itself.
Example mechanism:
official noble motive vs. cynical self-serving motive
AFFECTED STAKEHOLDER / STRAIGHT MAN
The persona has a legitimate stake in the event, and their perspective exposes something absurd about the institution, process, or situation.
Example mechanism:
"This sounds promising, but we've seen how Columbia implements things."
FUNCTIONAL ROLE
The persona translates a huge event into the narrow consequence relevant to their job.
Example:
historic institutional crisis → surprise budget line item
PERSONA / ARCHETYPE
The event activates a stereotyped behavior, worldview, obsession, or conversational move.
Example:
breaking campus event → "This is literally Rousseau."
OPPORTUNIST
The persona sees the event primarily as an opportunity to gain status, attention, content, leverage, money, etc.
BYSTANDER
The persona is minimally invested in the substantive issue and reacts through inconvenience, confusion, self-interest, or campus life.
OTHER
If none fit, describe the relationship precisely.
Return:
comic_role
why_this_role_fits
joke_target
Who or what is actually being made ridiculous?
This may be:
the persona itself
Columbia administration
federal government
bureaucracy
campus culture
the scale of the event
institutional language
another stakeholder
the absurd situation itself

STEP 4 — FIND THE PERSONA'S PROCESSING RULE
This is one of the most important steps.
Complete this sentence:
"When {{PERSONA}} encounters an event like this, they characteristically convert it into ______."
Call this:
persona_processing_rule
Examples:
CC professor:
contemporary controversy → canonical philosophical framework
University financial officer:
institutional event → cost, budget variance, and funding problem
Social justice warrior:
specific injustice → larger systemic pattern → additional unresolved struggles
PR office:
crisis → messaging problem
Pre-law student:
controversy → legal doctrine, liability, precedent
Finance bro:
news → money/status/market implication
Tour guide:
awkward campus reality → something that must be euphemized for visiting parents
The processing rule should be specific enough that it could generate jokes across many different events.

STEP 5 — IDENTIFY WHAT IN THIS EVENT TRIGGERS THAT PROCESSING RULE
trigger_feature
What concrete property of THIS event activates the persona?
Examples:
enormous settlement cost
question of institutional legitimacy
university announces a "solution"
controversy involves federal power
reputational embarrassment
protest shuts down a campus space
Do not merely repeat the entire event.

STEP 6 — MAP THE PERSONA'S INTERNAL RESPONSE
Separate realistic/public response from comedic/unfiltered response.
public_or_surface_response
What might this person plausibly say in a normal or official setting?
unfiltered_response
What is the sharper, less filtered version that exposes the comic perspective?
Important:
"Unfiltered" does NOT always mean secretly evil or cynical.
It could reveal:
greed
exhaustion
skepticism
excitement
tunnel vision
anxiety
self-interest
obsessive intellectualization
opportunism
moral absolutism
bureaucratic thinking
pettiness
For sympathetic or affected groups, do not invent malicious motives merely to create a joke.

STEP 7 — IDENTIFY STAKES, OPPORTUNITY, OR BURDEN
Not all personas are materially affected.
Fill only those that matter.
material_stake
What actually changes for them?
downstream_burden
What new work/problem has landed on them?
persona_opportunity
What excuse or opportunity does the event give them?
Examples:
Financial officer:
burden = find money
CC professor:
opportunity = turn event into class discussion
Student journalist:
opportunity = huge story
Affected student group:
stake = whether conditions actually improve

STEP 8 — FIND THE COMIC CONTRADICTION
Complete:
"It is funny that ______, while ______."
This should identify the tension powering the joke.
Examples:
It is funny that the university describes an enormous concession with solemn institutional language, while cynical students imagine the administration just wants the crisis to disappear.
It is funny that everyone else sees a historic political controversy, while finance sees an Excel problem.
It is funny that a huge federal settlement is treated as resolution, while the activist persona immediately sees it as the beginning of 14 more struggles.
It is funny that everyone is processing serious breaking news, while the professor is thrilled to have found a live Rousseau example.
A CONTRAST IS NOT A TENSION. "Everyone else sees a gas station; the wannabe sommelier sees a cellar" is a contrast: nobody wants anything and nothing blocks it. A tension names what the persona WANTS (from `wants`) and what in THIS event BLOCKS it or punctures what they PRETEND.
WRONG: "It is funny that everyone else sees a gas station, while the wannabe sommelier sees a cellar."
RIGHT: "It is funny that he wants to be the man who can read a label, while the label is a $6 screw-top and the cashier watched him pick it."
(Illustrations only — never copy them into output.)
Return:
comic_contradiction
If you cannot identify a strong contradiction, say so rather than forcing one.

STEP 9 — IDENTIFY THE COMIC MOVE
Choose or describe the strongest transformation.
Possible moves include:
cynical motive reveal
occupational tunnel vision
worldview absorption
scope expansion
reductive translation
inappropriate enthusiasm
weary skepticism
bureaucratic absurdity
euphemism vs. reality
status anxiety
self-interest
opportunism
literalization
understatement
overstatement
escalation
reversal
"everyone sees X; persona sees Y"
pretending coercion is voluntary
treating something enormous as routine
treating something routine as enormous
converting crisis into content
converting crisis into homework
converting crisis into budget problem
converting victory into "just the first step"
Return:
comic_move
comic_move_explanation

STEP 10 — CREATE PERSONA-SPECIFIC DETAILS
Generate:
persona_specific_vocabulary
5–10 words, phrases, references, behaviors, or objects associated with this persona that could naturally appear in a joke.
Do not stuff them all into one caption.
Example for a CC professor:
Rousseau
Hobbes
state of nature
social contract
"what does this tell us about..."
discussion section
syllabus
close reading
Example for financial officers:
Excel
reforecast
discretionary spending
budget line
cost center
variance
"essential"
fiscal year
visual_behaviors
3–5 concrete actions or situations that visually express the persona's response.
Prefer actions over facial expressions.
Bad:
looks concerned
Better:
opens Excel immediately
starts crossing items out of a university budget
circles the settlement number with a calculator beside them

STEP 11 — GENERATE MULTIPLE JOKE ANGLES
Produce 5 distinct caption concepts.
They should NOT just be wording variations.
Each should use a different comic angle where possible.
For each:
angle_name
setup
What is the perspective?
joke_mechanism
Why should it be funny?
image_situation
What image/reaction template would fit?
caption
Short, meme-like, and natural.
Aim for captions that sound like something a student would actually post.
Avoid overly polished institutional prose.
behavior
ONE exact filmable behavior of the persona that the caption carries, drawn from `does_compulsively` or visual_behaviors. The caption text must contain it.
WRONG: "the sommelier is suspicious of the label" (an adjective, not filmable)
RIGHT: "lets a $6 screw-top breathe on the hood of his car under the pump lights"
who_pays
Who is exposed in THIS caption and how, in the caption's own words: the persona's behavior reveals `pretends` or `would_never_admit`. A literal loss counts only when the WAY it happens is the exposure; a tacked-on "and then misses / loses / fails X" is padding — delete it and the joke should survive. Under the PRETENDS RULE the exposed one is the persona, every time.
EVERY caption MUST ALSO:
- deliver the feeling through the behavior; never state the feeling word ("anxious", "smug", "sad")
- speak with the persona's own main verb when the PRETENDS RULE applies, or put them on the hook with something they did, wanted, or swore
(Illustrations only — never copy them into output.)

STEP 12 — CRITIQUE THE JOKES
For each caption score 1–5 on:
persona_specificity
Could this joke only or especially belong to this persona?
event_specificity
Does it actually use something distinctive about this event?
comic_tension
Is there a real contradiction, exaggeration, or transformation?
naturalness
Does it sound like a meme caption rather than an AI explanation?
target_clarity
Who is exposed as ridiculous by this caption, and is that visible in the caption itself? Naming a target is not enough; someone has to come off worse. 5 = the exposed one and what exposes them are in the words; 1 = an observation nobody pays for.
at_persona_expense
THE SPEAKER-AGENCY TEST (mechanical, run it first): find the caption's MAIN VERB and name whose action it is. The persona's → the joke is on them by construction. Anyone else's → the persona is only reacting, and the joke is at THAT entity's expense UNLESS the setup ALSO puts the persona on the hook: something THEY did, wanted, or swore that the event now exposes. Quote the words that expose them; if the only thing the caption reveals is what someone else did, score 2 or below.
THE RIGHT-CALL TEST: does the caption still work if the persona's read of the event is simply correct? If yes, nothing about them is exposed; score 2 or below.
THE LAST-LAUGH TEST: whose behavior in the caption would the persona's OWN peers wince at? If it is not the persona's, score 2 or below.
When `pretends` is null, score this on whoever `who_pays` names instead.
WRONG (at_persona_expense 2): "'Notes of cherry' on a gas station label okay so what are they hiding" — the main verb is the store's, his suspicion is reasonable, and he comes off as the smart one
RIGHT (at_persona_expense 5): "Me letting a $6 screw-top breathe on the hood of my car so the cashier knows I know" — the main verb is his, and the punchline is his own pretense
(Illustrations only — never copy them into output.)
overall
THE WEAKEST LINK (mechanical, compute it last): the MINIMUM of the six scores. Not an average, not the sum. A caption is only as good as its weakest check.
weakest_check
The name of the score that set `overall`, and one sentence on why.
Then choose:
best_caption
the candidate with the highest `overall`; ties broken by the highest sum of the six scores. Never a caption whose `overall` is below another candidate's.
and explain briefly:
why_best

IMPORTANT HUMOR RULES
Do not merely summarize the persona's reasonable reaction.
Bad:
"Let's hope this brings real change."
That is a reaction, not necessarily a joke.
Do not assume every persona must be cynical or malicious.
A persona with a non-null `pretends` is exposed by their own behavior in every caption (the PRETENDS RULE). A lens is not a joke: if the caption would still work with the persona simply being right, it is vocabulary substitution. An incidental punishment is not exposure: missing dinner, losing sleep, being late say nothing about the persona.
Prefer behavioral stereotypes over adjective stereotypes.
Bad:
intellectually curious
Better:
incapable of hearing about institutional legitimacy without mentioning Rousseau
Prefer specific transformations.
Bad:
sees the financial impact
Better:
mentally converts a national political controversy into an unplanned Excel variance
Look for the persona's predictable move.
Ask:
"What would students immediately expect this person to SAY or DO?"
Maintain the emotional truth of sympathetic stakeholders while finding humor elsewhere when appropriate.
The persona's first thought should not simply paraphrase the news.
Avoid generic caption structures such as:
"Another day at the office."
"This is a teachable moment."
"We remain vigilant."
"Time to get to work."
unless the wording itself is being used ironically.
A strong joke often has the form:
Big event + extremely persona-specific interpretation
or:
Official framing + cynical/unfiltered translation
or:
Everyone else sees X + persona sees Y
or:
Supposed resolution + persona immediately creates the next problem
or:
Serious event + hilariously mundane downstream consequence


---

# JSON OUTPUT REQUIREMENTS

Return ONLY valid JSON.

Do not return Markdown.

Do not use a code fence.

Do not include any explanation outside the JSON object.

Do not change the field names.

Do not include trailing commas.

Use double quotes for all strings and keys.

Use `null` where a value genuinely does not apply.

Use integers for scores.

---

# REQUIRED JSON SCHEMA

{
"event": {
"event_core": "",
"most_comically_salient_details": [
""
]
},

"persona": {
"persona_baseline": ""
},

"comic_relationship": {
"comic_role": "<one of the allowed comic_role values>",
"why_this_role_fits": "",
"joke_target": ""
},

"persona_processing": {
"persona_processing_rule": "",
"trigger_feature": ""
},

"response": {
"public_or_surface_response": "",
"unfiltered_response": ""
},

"stakes": {
"material_stake": null,
"downstream_burden": null,
"persona_opportunity": null
},

"humor_engine": {
"comic_contradiction": "",
"comic_move": "",
"comic_move_explanation": ""
},

"persona_material": {
"persona_specific_vocabulary": [
""
],
"visual_behaviors": [
""
]
},

"joke_candidates": [
{
"angle_name": "",
"setup": "",
"joke_mechanism": "",
"image_situation": "",
"caption": "",
"behavior": "<the one filmable behavior the caption carries>",
"who_pays": "<who loses in this caption and what it costs them>",
"scores": {
"persona_specificity": 0,
"event_specificity": 0,
"comic_tension": 0,
"naturalness": 0,
"target_clarity": 0,
"at_persona_expense": 0,
"overall": 0
},
"weakest_check": "<the score that set overall, and why>"
}
],

"best": {
"best_caption": "",
"best_overall": 0,
"why_best": ""
}
}

---

# ENUM RULES

`comic_role` may ONLY be:

* `target`
* `affected_stakeholder`
* `straight_man`
* `functional_role`
* `persona_archetype`
* `opportunist`
* `bystander`
* `other`

---

# FINAL VALIDATION

Before answering, silently verify:

1. The result is valid JSON.
2. There is no text outside the JSON object.
3. `joke_candidates` contains exactly 5 entries.
4. The 5 candidates use genuinely different comic angles, not wording variations of one joke.
5. Every score is an integer from 1 to 5.
6. `comic_role` uses an allowed value.
7. `best_caption` is copied VERBATIM from the `caption` of one of the 5 entries in `joke_candidates` — it is never a new or edited caption.
8. Any field in `stakes` that does not genuinely apply to this persona is `null` rather than padded with invented content.
9. `persona_pathology.pretends` is not null → `comic_role` is `target`, `joke_target` names the persona, and every candidate's `who_pays` names the persona. Otherwise FAIL: rewrite the candidate.
10. A candidate whose main verb belongs to someone other than the persona, with nothing in the caption exposing the persona → `at_persona_expense` is 2 or below, no exceptions.
11. A candidate that still works if the persona's read of the event is simply correct → `at_persona_expense` is 2 or below.
12. Every candidate's `behavior` is a filmable action AND appears in the caption text. An adjective is not a behavior.
13. A caption states a feeling word instead of delivering it through behavior → FAIL: rewrite.
14. Every `overall` equals the MINIMUM of that candidate's six scores, never higher. Otherwise FAIL: recompute.
15. `best_caption` is the candidate with the highest `overall`, and `best_overall` equals it. Otherwise FAIL.
