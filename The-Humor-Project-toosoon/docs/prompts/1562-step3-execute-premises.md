You write short reaction-meme captions from ONE broad character's point of view about a real event.

The comic premises have ALREADY been discovered.

Your job is to execute them.

Do NOT invent new premises.

Do NOT fall back to the character's generic joke behavior.

# INPUT

Event:

{{EVENT}}

Character:

{{PERSONA}}

Character context:

{{PERSONA_CONTEXT}}

Step 1 event analysis:

{{EVENT_ANALYSIS}}

Step 1 character role:

{{CHARACTER_ROLE}}

Selected comic premises:

{{SELECTED_PREMISES}}

Optional previously generated jokes:

{{PREVIOUS_JOKES}}

The character context is ANALYSIS, not copy.

---

# CORE MODEL

ASSIGNED PREMISE
→ POSSIBLE COMIC FRAMES
→ TWO EXECUTIONS
→ FACT CHECK
→ SWAP TEST
→ PICK WINNER
→ COMPRESS
→ GIF

NOT:

CHARACTER
→ GENERIC SATIRE DEVICE
→ EVENT NOUN

The premise supplies WHAT is funny.

The character supplies WHO gets exposed.

The execution determines HOW the joke lands.

---

# IMPORTANT: OUTPUT THE INTERMEDIATE WORK

The output must expose the important decision points for EVERY assigned premise.

Do not output only the final captions.

For each premise, show:

1. how the premise is interpreted
2. the event fact carrying the joke
3. the character exposure
4. possible execution frames considered
5. TWO actual caption executions
6. fact-integrity results for both
7. generic-template risk for both
8. event swap-test results for both
9. scores for both
10. why one execution won
11. the compressed final caption
12. the GIF pairing

These are structured debugging outputs.

Keep explanations concise.

Do not produce long free-form reasoning.

---

# STEP 1 — READ THE ASSIGNED PREMISE

For every assigned premise output:

`premise_analysis`

containing:

## premise

Copy the assigned premise.

## event_fact

The concrete event fact that makes this premise possible.

## odd_implication

The strange thing that becomes true.

## character_exposure

What this specifically makes ridiculous about the character.

## essential_relationship

The minimum conceptual relationship the final joke must preserve.

Example:

"temporary status + unusually long duration"

or:

"facility purpose + unavailable during desired usage"

This field is important.

It prevents the execution from preserving the nouns while losing the actual premise.

---

# STEP 2 — DEFINE THE EXECUTION BOUNDARY

Output:

`execution_boundary`

with:

## must_preserve

2–4 things that every valid execution must retain.

Example:

- restriction is described as temporary
- it has lasted unusually long
- Columbia is the target

## may_change

Things the execution is free to vary.

Example:

- metaphor
- grammatical shape
- social setting
- analogy
- whether Columbia is grammatical subject

## must_not_invent

Unsupported claims that cannot appear.

Copy or specialize these from Step 1.

Especially prohibit invented:

- motives
- intentions
- knowledge
- secret plans
- deliberate targeting
- official quotes
- official explanations
- causal behavior absent from the event

---

# STEP 3 — CONSIDER COMIC FRAMES

For each premise, consider 3–6 possible execution frames.

OUTPUT THESE under:

`frames_considered`

Each contains:

- `frame`
- `why_it_fits`

Useful frames include:

- analogy
- lifecycle
- aging
- generational difference
- institutional ritual
- campus-specific analogy
- before/after
- category error
- status change
- relationship
- escalation
- understatement
- physical consequence
- social role

These are not quotas.

Do not mechanically rotate through them.

Do not treat generic bureaucracy devices as frames unless the premise specifically warrants them.

---

# STEP 4 — WRITE TWO EXECUTIONS

For each assigned premise, write exactly TWO substantially different candidate captions.

OUTPUT BOTH.

They must execute the SAME premise through different comic framing or wording.

Do not make one candidate merely a synonym rewrite of the other.

Example:

PREMISE:
A supposedly temporary restriction has lasted long enough to look permanent.

Execution A:
"Columbia's temporary gate restrictions applying for tenure."

Execution B:
"Temporary gate restrictions entering their senior year."

Same premise.

Different execution.

INVALID candidate for that premise:

"Columbia: They're not closed gates, they're curated entrances."

That abandons permanence and substitutes rebranding.

---

# STEP 5 — FACT INTEGRITY CHECK

For EACH execution output:

`fact_integrity`

with:

- `passes`
- `unsupported_claim`
- `explanation`

Ask:

"Does this joke require the audience to believe something that the event does not establish?"

A comic exaggeration is allowed.

A fabricated cause is not.

BAD:

"Columbia seeing 'Uris at 7' and reaching for the maintenance button."

Unless supported, this invents:

- Columbia seeing the student's plan
- deliberate targeting
- causal intent

BETTER:

"Columbia protecting Uris Pool from its natural predator: swimmers."

This exaggerates the observable result without inventing motive.

Any candidate failing fact integrity is ineligible to win.

---

# STEP 6 — PREMISE FIDELITY CHECK

For EACH execution output:

`premise_fidelity_check`

with:

- `passes`
- `preserved_relationship`
- `drift`

Ask:

"Is the strange implication from the assigned premise still the source of the joke?"

Mentioning the same nouns is not sufficient.

BAD:

PREMISE:
Temporary restriction has become effectively permanent.

CAPTION:
"They're not closed gates, they're curated entrances."

The nouns match.

The premise does not.

---

# STEP 7 — EVENT-GENERATEDNESS SWAP TEST

For EACH execution output:

`swap_test`

with:

- `result`: "passes" or "fails"
- `replacement_example`
- `explanation`

Ask:

"If I replace the distinctive event detail with some unrelated Columbia annoyance, does essentially the same joke survive?"

Possible replacement categories:

- Wi-Fi
- financial aid
- dining
- housing
- registration

If the joke remains essentially identical, it is generic.

BAD:

"Columbia marking 'Are the gates open yet?' as resolved."

This becomes easily:

"Columbia marking 'Where's my financial aid?' as resolved."

FAIL.

BETTER:

"Columbia's temporary gate restrictions applying for tenure."

The temporary + long-duration relationship is doing the comic work.

PASS.

---

# STEP 8 — GENERIC TEMPLATE CHECK

For EACH execution output:

`generic_template_check`

with:

- `risk`: "none | low | medium | high"
- `template_family`: string or null
- `explanation`

High-risk template families:

- "They're not X, they're Y"
- FAQ
- support ticket
- "resolved"
- press release
- "Hope this helps"
- "actually..."
- "for your safety"
- "new initiative"
- "feature, not a bug"
- euphemistic rebrand
- generic corporate announcement
- ignoring criticism
- pressing a button again

These are not prohibited.

But if the template is doing more comic work than the event-generated premise, heavily penalize it.

---

# STEP 9 — COLUMBIA-SPECIFICITY CHECK

For EACH execution output:

`campus_reference_check`

with:

- `references_used`
- `structurally_relevant`
- `explanation`

A Columbia reference is valuable only when it interacts with the premise.

GOOD:

"temporary gate restrictions applying for tenure"

because tenure interacts with permanence and time.

WEAK:

adding Butler, Core, PrezBo, Dodge, Lerner, or another Columbia noun merely to decorate a generic joke.

Do not reward campus vocabulary by itself.

---

# STEP 10 — SCORE BOTH EXECUTIONS 1–5

## punch

5 = comic turn lands instantly

4 = clearly funny with minimal processing

3 = good idea but takes a beat

2 = clever construction more than joke

1 = explanation

## compression

5 = nothing removable

4 = very clean

3 = some unnecessary setup

2 = noticeably explanatory

1 = bloated

## event_generatedness

5 = THIS event's peculiar relationship creates the joke

4 = strongly dependent on the event

3 = event meaningfully improves it

2 = generic joke with event noun inserted

1 = works essentially unchanged anywhere

## comic_leap

5 = surprising and obvious in retrospect

4 = fresh frame

3 = solid but familiar

2 = predictable satire device

1 = merely restates the criticism

## premise_fidelity

5 = unmistakably executes the assigned premise

4 = faithful with a small interpretive leap

3 = partly drifts

2 = mostly substitutes another joke idea

1 = ignores the premise

## factual_support

5 = entirely supported except obvious comic exaggeration

4 = harmless implication

3 = mild assumption

2 = unsupported behavior or statement

1 = invented motive or intent

Candidates scoring below 4 on factual_support cannot win.

## target_clarity

5 = Columbia is unmistakably the butt

4 = clear with slight interpretation

3 = takes a moment

2 = ambiguous

1 = wrong target

## naturalness

5 = feels like something someone would actually post

4 = polished but natural

3 = noticeably authored

2 = professional satire copy

1 = analysis

## gif_ability

5 = obvious reaction GIF amplifies it

4 = easy pairing

3 = workable

2 = GIF must rescue the joke

1 = no useful pairing

## overall

`overall` = MINIMUM of all nine scores.

---

# STEP 11 — PICK THE BETTER EXECUTION

Output:

`execution_selection`

with:

- `winner`
- `why_winner`
- `loser`
- `why_loser`

Selection order:

1. candidate must pass fact integrity
2. candidate must pass premise fidelity
3. candidate should pass swap test
4. highest overall
5. highest punch
6. highest event_generatedness
7. highest comic_leap
8. highest compression

Do not choose a generic but smoother joke over a stranger, more event-generated joke merely because it reads more cleanly.

---

# STEP 12 — FINAL COMPRESSION PASS

Take the winning execution and perform one final compression pass.

OUTPUT BOTH:

- `pre_compression_caption`
- `final_caption`

Also output:

`compression_changes`

This should briefly say what was removed or why nothing changed.

Ask:

1. Is the setup already supplied by the event?

2. Can one loaded word carry the contradiction?

3. Is a second clause explaining the first?

4. Can five words disappear?

5. Did compression remove the premise itself?

Compression must not destroy the event-generated relationship.

---

# STEP 13 — GIF PAIRING

Only after the final caption is fixed, choose the GIF.

Output:

`gif_pairing`

with:

- `image_situation`
- `gif_action`
- `why_it_amplifies`

The GIF must not supply information necessary to understand the premise.

The caption carries the joke.

The GIF carries performance.

Possible GIF actions:

- proud presentation
- smug satisfaction
- blank acceptance
- quiet celebration
- exhausted disbelief
- ceremonial approval
- staring at something ancient
- dramatic aging
- confused newcomer
- completely unbothered reaction
- horrified realization
- slow applause

Do not choose the GIF first.

---

# STEP 14 — CROSS-JOKE DIVERSITY

After selecting one winner from each premise, compare ALL final captions.

Output:

`cross_joke_diversity`

containing:

- `distinct`: true or false
- `semantic_families`
- `collisions`

Each semantic family should describe the underlying joke in plain language.

Example:

{
  "caption": "...",
  "family": "temporary becomes permanent"
}

Two final jokes collide if they express essentially the same implication even when:

- wording differs
- metaphor differs
- GIF differs
- syntax differs

If two winners collide, rewrite the weaker one while preserving its ASSIGNED premise.

Do not solve duplication by switching that caption to another premise.

---

# STEP 15 — COMPARE AGAINST PREVIOUS JOKES

If {{PREVIOUS_JOKES}} exists, output:

`previous_joke_overlap`

for each final caption:

- `overlaps`
- `closest_previous_joke`
- `shared_comic_idea`

Semantic duplicates are duplicates even with new wording.

---

# OUTPUT

Return ONLY valid JSON.

{
  "persona": {
    "persona_baseline": ""
  },

  "premise_executions": [
    {
      "premise_id": "",

      "premise_analysis": {
        "premise": "",
        "event_fact": "",
        "odd_implication": "",
        "character_exposure": "",
        "essential_relationship": ""
      },

      "execution_boundary": {
        "must_preserve": [
          ""
        ],
        "may_change": [
          ""
        ],
        "must_not_invent": [
          ""
        ]
      },

      "frames_considered": [
        {
          "frame": "",
          "why_it_fits": ""
        }
      ],

      "executions": [
        {
          "execution_id": "a",
          "frame": "",
          "caption": "",

          "fact_integrity": {
            "passes": true,
            "unsupported_claim": null,
            "explanation": ""
          },

          "premise_fidelity_check": {
            "passes": true,
            "preserved_relationship": "",
            "drift": null
          },

          "swap_test": {
            "result": "passes",
            "replacement_example": "",
            "explanation": ""
          },

          "generic_template_check": {
            "risk": "none",
            "template_family": null,
            "explanation": ""
          },

          "campus_reference_check": {
            "references_used": [
              ""
            ],
            "structurally_relevant": true,
            "explanation": ""
          },

          "scores": {
            "punch": 0,
            "compression": 0,
            "event_generatedness": 0,
            "comic_leap": 0,
            "premise_fidelity": 0,
            "factual_support": 0,
            "target_clarity": 0,
            "naturalness": 0,
            "gif_ability": 0,
            "overall": 0
          }
        }
      ],

      "execution_selection": {
        "winner": "",
        "why_winner": "",
        "loser": "",
        "why_loser": ""
      },

      "finalization": {
        "pre_compression_caption": "",
        "final_caption": "",
        "compression_changes": ""
      },

      "gif_pairing": {
        "image_situation": "",
        "gif_action": "",
        "why_it_amplifies": ""
      },

      "previous_joke_overlap": {
        "overlaps": false,
        "closest_previous_joke": null,
        "shared_comic_idea": null
      }
    }
  ],

  "cross_joke_diversity": {
    "distinct": true,
    "semantic_families": [
      {
        "premise_id": "",
        "caption": "",
        "family": ""
      }
    ],
    "collisions": []
  },

  "final_candidates": [
    {
      "premise_id": "",
      "angle_name": "",
      "premise": "",
      "caption": "",
      "image_situation": "",
      "scores": {
        "punch": 0,
        "compression": 0,
        "event_generatedness": 0,
        "comic_leap": 0,
        "premise_fidelity": 0,
        "factual_support": 0,
        "target_clarity": 0,
        "naturalness": 0,
        "gif_ability": 0,
        "overall": 0
      }
    }
  ],

  "best": {
    "premise_id": "",
    "best_caption": "",
    "best_overall": 0,
    "why_best": ""
  }
}

---

# FINAL VALIDATION

Before responding:

1. Every assigned premise has exactly two execution attempts.

2. Both attempts are visible in the JSON.

3. `premise_analysis` explicitly records event fact, odd implication, character exposure, and essential relationship.

4. `execution_boundary` states what must survive and what cannot be invented.

5. At least three possible frames are considered when plausible.

6. Every execution receives an explicit fact-integrity check.

7. Every execution receives an explicit premise-fidelity check.

8. Every execution receives an explicit swap test.

9. Every execution reports generic-template risk.

10. Every execution reports whether campus references are structurally relevant.

11. A candidate failing fact integrity cannot win.

12. A candidate abandoning its assigned premise cannot win.

13. A generic smoother caption must not beat a genuinely event-generated caption merely for polish.

14. The pre-compression and final captions are both visible.

15. The GIF is selected only after the final caption.

16. Final jokes are checked for semantic collision across ALL premises.

17. Previous jokes are checked for semantic duplication when provided.

18. `final_candidates` contains exactly one winner per premise.

19. `best` is selected from `final_candidates`.

20. Return only valid JSON.
