You find genuinely different COMIC PREMISES for ONE broad character reacting to ONE real campus event.

Who to mock is already decided.

Your job is NOT to write finished jokes.

Your job is to discover what becomes weird, absurd, revealing, or unexpectedly true because of THIS PARTICULAR EVENT.

# INPUT

Event:

{{EVENT}}

Character:

{{PERSONA}}

Character context:

{{PERSONA_CONTEXT}}

Optional previously used premises:

{{PREVIOUS_PREMISES}}

The character context is ANALYSIS, not copy.

It tells you WHO is being exposed and what kind of flaw makes that exposure funny.

It must NOT dictate the comic premise.

---

# CORE MODEL

EVENT FACT
→ ODD IMPLICATION
→ CHARACTER EXPOSURE
→ COMIC LEAP
→ COMIC PREMISE

NOT:

CHARACTER TRAIT
→ GENERIC SATIRE DEVICE
→ INSERT EVENT NOUN

The event should create the funny idea.

The character determines why that idea is embarrassing.

---

# IMPORTANT: OUTPUT THE INTERMEDIATE ANALYSIS

Do not hide the important intermediate work.

The JSON output must expose:

1. the hard facts extracted from the event
2. the raw premise candidates considered
3. the character's role in THIS event
4. the checks performed on each premise
5. the selected premises

These outputs are for debugging the humor pipeline.

Keep them concise.

Do not output private free-form reasoning or essays.

Use the structured fields defined below.

---

# STEP 1 — IDENTIFY THE HARD FACTS

Extract 2–5 concrete facts directly supported by the event.

These MUST appear in the output under:

`event_analysis.hard_facts`

For each fact, record:

- `fact`
- `why_comically_useful`

Prefer unusually specific facts:

- exact timing
- duration
- sequence
- location
- who is affected
- before/after change
- mismatch between purpose and availability
- something students can now or can no longer do
- an unusual consequence

Also output:

`event_analysis.distinctive_structure`

This is the unusual relationship among the facts.

Examples of SHAPE:

- supposedly temporary + has lasted years
- facility exists for X + unavailable during prime X time
- older students experienced X + newer students never have
- restriction introduced as exception + now inherited as normal

Do not infer motive.

Do not invent an official claim.

Do not assume the character deliberately caused a consequence unless the event says so.

---

# STEP 2 — GENERATE RAW PREMISES

Generate 10–15 RAW premise candidates.

THE RAW PREMISES MUST APPEAR IN THE OUTPUT.

Do not output only the winners.

Each raw premise should be compact enough to inspect quickly.

For every raw premise output:

- `premise_id`
- `premise`
- `source_fact_ids`
- `odd_implication`
- `comic_leap`
- `character_exposure`
- `unsupported_inference`
- `swap_test`
- `duplicate_family`
- scores

A raw premise is allowed to fail.

That is useful diagnostic information.

---

# WHAT A COMIC PREMISE IS

A comic premise is a surprising interpretation of a concrete event fact.

It answers:

"What weird thing becomes true because this happened?"

Examples of SHAPE only:

- a supposedly temporary thing has lasted long enough to qualify as history
- the facility is unavailable precisely when its purpose matters
- new students know the old normal only through older students
- fixing one tiny visible symptom makes the underlying problem look even larger
- an exception has survived long enough to become tradition
- the institution has accidentally created the opposite of what the thing exists to provide

These are PREMISES.

They are not captions.

---

# WHAT A COMIC PREMISE IS NOT

These are usually execution devices, NOT premises:

- rename the problem
- make an FAQ
- issue a cheerful announcement
- mark the complaint resolved
- confidently deny the obvious
- call the failure a success
- press the same button again
- unveil the problem as the solution

Do not begin with one of these devices and search for an event detail to attach to it.

A device is allowed later only if a specific premise naturally invites it.

---

# STEP 3 — CHARACTER ROLE

Explicitly analyze what role the supplied character plays in THIS premise space.

THIS ANALYSIS MUST APPEAR IN THE OUTPUT under:

`character_role`

Output:

## baseline_flaw

The supplied character's underlying comic flaw.

Keep this broad.

## event_specific_exposure

What THIS event reveals about that flaw.

This should change from event to event.

## role_in_jokes

What job the character performs in the comedy.

Examples:

- person benefiting from the absurd arrangement
- institution normalizing the new reality
- actor whose policy created the visible contradiction
- authority treating the result as ordinary
- target exposed by the consequence

## must_not_assume

What unsupported behavior, motive, statement, or intention the joke writer must NOT invent.

## useful_attitude

ONE comic attitude that could amplify the eventual joke.

This is performance guidance, NOT the premise itself.

Examples:

- serene confidence
- oblivious pride
- casual acceptance
- total lack of embarrassment
- confused insistence that nothing changed

---

# CHARACTER ROLE RULE

The character is a LENS, not a premise generator.

Use the character context to answer:

"What does this event accidentally reveal about this character?"

GOOD:

FACT:
New students have never experienced unrestricted gates.

IMPLICATION:
A recently lost norm already sounds historical.

CHARACTER EXPOSURE:
Columbia can manufacture a new normal simply by maintaining a restriction long enough.

COMIC LEAP:
Treat unrestricted access like folklore, oral history, archaeology, or a vanished civilization.

The funny idea begins with the EVENT.

BAD:

Columbia likes euphemisms.

Therefore make a euphemism joke about the gates.

That begins with the character template.

---

# STEP 4 — FACT / IMPLICATION GATE

For every raw premise, explicitly record:

`unsupported_inference`

Use `null` when none is required.

If the premise requires invented:

- motive
- intent
- knowledge
- deliberate targeting
- official statement
- official explanation
- causal behavior not contained in the event

then factual support must score 1–2 and the premise cannot be selected.

A comic exaggeration should grow outward from an observed fact.

It should not depend on secret information about what the character was thinking.

VALID:

The restriction has lasted so long that open gates now sound like campus folklore.

INVALID:

Columbia noticed students enjoying open gates and deliberately took them away.

---

# STEP 5 — EVENT-GENERATEDNESS SWAP TEST

For EVERY raw premise output:

`swap_test`

with:

- `result`: "passes" or "fails"
- `explanation`

Test:

"If I replace the distinctive event detail with another random Columbia annoyance, does basically the same premise still work?"

BAD:

Columbia responds to complaints with bureaucracy.

Works for:

- financial aid
- Wi-Fi
- dining
- registration
- housing
- gates

FAIL.

BETTER:

Incoming students have never experienced the unrestricted gates older students remember.

That idea depends on THIS event's duration and before/after structure.

PASS.

---

# STEP 6 — NO MAD-LIB SATIRE

Identify whether each raw premise belongs to a generic satire family.

Output this as:

`generic_device_risk`

Values:

- `none`
- `low`
- `medium`
- `high`

High-risk families include:

- Columbia rebrands X
- Columbia makes an FAQ about X
- Columbia ignores complaints about X
- Columbia marks X resolved
- Columbia calls X a feature
- Columbia releases a statement about X
- Columbia says "actually..."

These can be executions later.

They are weak premises unless the event itself contains a distinctive detail involving that exact behavior.

---

# STEP 7 — PREMISE DIVERSITY

Assign every raw premise a:

`duplicate_family`

This is a short semantic description of the underlying comic idea.

Examples:

- "old normal becomes history"
- "temporary becomes permanent"
- "purpose defeated by availability"
- "exception becomes tradition"

Two premises are duplicates if they reduce to the same strange implication.

These are ONE family:

- open gates become folklore
- open gates become ancient history
- open gates enter the archives
- freshmen hear legends about open gates

Different metaphor is NOT premise diversity.

Only one should survive.

These ARE different:

- old normal becomes historical memory
- temporary has become effectively permanent
- restriction contradicts the meaning of open campus
- new students inherit an exception as their baseline

---

# CROSS-BATCH DEDUPLICATION

If {{PREVIOUS_PREMISES}} is provided, compare ideas semantically.

Output for every raw premise:

`previous_premise_overlap`

with:

- `overlaps`: true or false
- `previous_premise`: string or null

Reject a new premise if it expresses essentially the same comic implication as a previous premise, even with:

- different wording
- different metaphor
- different emotional reaction
- different GIF
- different grammatical structure

---

# SCORE EACH RAW PREMISE 1–5

## event_generatedness

5 = the peculiar facts of THIS event create the premise

4 = strongly dependent on this event

3 = event meaningfully improves a reusable idea

2 = generic character joke with an event detail inserted

1 = could attach to almost any complaint

## comic_leap

5 = surprising but instantly makes sense once stated

4 = fresh interpretation of the event

3 = solid but familiar analogy

2 = predictable satire mechanism

1 = merely describes why the event is bad

## factual_support

5 = grows entirely from explicit event facts

4 = contains only a harmless obvious implication

3 = requires a mild assumption

2 = depends on unsupported behavior or claim

1 = depends on invented motive or intent

Any premise scoring 1–2 on factual_support cannot be selected.

## character_exposure

5 = the premise specifically makes THIS character ridiculous

4 = strong fit

3 = character helps but is not essential

2 = character feels attached afterward

1 = no meaningful character relationship

## execution_range

5 = several substantially different funny executions are obvious

4 = multiple good executions available

3 = probably one good joke

2 = premise already feels like a finished caption

1 = only works as one exact wording

---

# STEP 8 — SELECT

Select the five strongest DISTINCT premises.

Prefer:

1. high event_generatedness
2. high comic_leap
3. high factual_support
4. strong character exposure
5. high execution range

Do NOT select five merely because five are requested.

If fewer than five genuinely strong, distinct premises exist, return fewer.

For every selected premise output:

- `premise_id`
- `premise`
- `source_fact_ids`
- `why_selected`
- `execution_space`

`execution_space` should name 2–4 possible TYPES of comic frames without writing captions.

Example:

[
  "academic career lifecycle",
  "aging milestone",
  "permanent-status comparison"
]

This proves that the premise has room for Step 2 to explore.

---

# OUTPUT

Return ONLY valid JSON.

{
  "persona": {
    "persona_baseline": ""
  },

  "event_analysis": {
    "event_core": "",
    "hard_facts": [
      {
        "fact_id": "f1",
        "fact": "",
        "why_comically_useful": ""
      }
    ],
    "distinctive_structure": ""
  },

  "character_role": {
    "baseline_flaw": "",
    "event_specific_exposure": "",
    "role_in_jokes": "",
    "must_not_assume": [
      ""
    ],
    "useful_attitude": ""
  },

  "raw_premises": [
    {
      "premise_id": "p1",
      "premise": "",
      "source_fact_ids": [
        "f1"
      ],
      "odd_implication": "",
      "comic_leap": "",
      "character_exposure": "",
      "unsupported_inference": null,
      "swap_test": {
        "result": "passes",
        "explanation": ""
      },
      "generic_device_risk": "none",
      "duplicate_family": "",
      "previous_premise_overlap": {
        "overlaps": false,
        "previous_premise": null
      },
      "scores": {
        "event_generatedness": 0,
        "comic_leap": 0,
        "factual_support": 0,
        "character_exposure": 0,
        "execution_range": 0
      },
      "decision": "select | reject",
      "rejection_reason": null
    }
  ],

  "selected_premises": [
    {
      "premise_id": "",
      "premise": "",
      "source_fact_ids": [
        ""
      ],
      "why_selected": "",
      "execution_space": [
        ""
      ]
    }
  ]
}

---

# FINAL VALIDATION

Before responding:

1. `hard_facts` contains only facts directly supported by the event.

2. `raw_premises` contains 10–15 candidates whenever the event provides enough material.

3. Weak and rejected raw premises remain visible in the output.

4. No finished captions appear anywhere.

5. Every premise identifies which hard fact or facts generated it.

6. Every premise records its odd implication, comic leap, and character exposure separately.

7. Every premise explicitly reports unsupported inference.

8. No selected premise requires invented motive, intent, knowledge, statement, or action.

9. Every raw premise performs the swap test.

10. Generic satire-device risk is explicitly reported.

11. Duplicate semantic families are explicitly labeled.

12. Different metaphor alone does not count as premise diversity.

13. `character_role.event_specific_exposure` describes THIS event, not merely the generic persona.

14. Selected premises are distinct semantic ideas.

15. Each selected premise has multiple plausible execution frames.

16. Return only valid JSON.
