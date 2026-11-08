<!-- Snapshot of flavor 1560 (1560-lydia-9-5-26-broad-character-reaction-memes-from-1559) step 2 "S2: Punchy reaction-meme captions from ONE character — kernel first, 5-14 words, GIF chosen after the joke (one call per character)" (step id 3459), taken 2026-09-05T19:12:48.682Z from the DB, which is the source of truth. Lydia's "Generic Step 2 — Punchy Reaction-Meme Captions", installed verbatim (it carries its own output block). The page fills {{EVENT}}, {{PERSONA}}, and {{PERSONA_CONTEXT}}. System prompt: "" -->

You write short reaction-meme captions from ONE broad character's point of view about a real event.

INPUT

Event:
{{EVENT}}

Character:
{{PERSONA}}

Character context:
{{PERSONA_CONTEXT}}

The character context is ANALYSIS, not copy.

Your job is to compress that analysis into jokes that make sense in one glance.

# CORE MODEL

EVENT → ONE FUNNY IDEA → SHORT CAPTION → GIF REACTION

Do NOT try to preserve the whole contradiction, pathology, causal chain, or character analysis inside the caption.

The reader already has some event context.

The caption needs only enough information to activate the joke.

---

# STEP 1 — FIND TINY COMIC KERNELS

Before writing captions, internally generate 8–12 comic kernels.

Each kernel is ONE simple funny thought, at most 8 words.

Useful kernel families include:

- temporary thing quietly becomes permanent
- obvious thing gets renamed
- character discovers another euphemism
- emergency or exception keeps getting renewed
- cosmetic fix presented as real fix
- obvious criticism met with confident denial
- character proudly unveils the problem as the solution
- character ignores the obvious question
- character doubles down after criticism
- consequence gets treated as a feature
- failure gets reclassified as success
- character acts surprised by a consequence they caused
- tiny concession gets presented as major victory
- character keeps doing the thing everyone is criticizing

A kernel is NOT a caption yet.

Reject kernels that require a paragraph to explain.

---

# STEP 2 — WRITE THE CAPTION

Write 5 captions from the strongest DISTINCT kernels.

Default target: 5–14 words.

15–18 words is acceptable only when the extra words materially improve the joke.

Prefer captions understood immediately while scrolling.

The caption will usually contain:

- the character
- ONE loaded event reference
- ONE comic move

But these do NOT need to appear as three explicit components.

A single loaded word or phrase may carry the event context.

THE CONTRADICTION MAY BE IMPLIED.

Do NOT explicitly explain both:
- what the character claims
- and what everyone can see

when the joke already makes the contradiction obvious.

Punchline compression is more important than analytical completeness.

---

# ALLOWED CAPTION SHAPES

Use whichever structure makes the individual joke shortest and funniest.

Common shapes:

"<Character> + absurd action"

"<Character>: <short fake quote>"

"<Character> discovering <absurd thing>"

"<Character> when <short trigger>: <reaction>"

"<Character>'s <thing> entering <absurd state>"

"<Event object>: <short status update>"

"<Character> proudly introducing <obviously bad thing>"

These are options, not quotas.

Do NOT mechanically distribute structures across the five captions.

---

# OBSERVATIONAL JOKES ARE ALLOWED

The character does NOT need to perform the main grammatical verb.

A joke may simply expose the character through the state of the event.

Valid SHAPES:

"<Character>'s temporary solution entering year three."

"<Character> discovering another synonym for 'failure.'"

"<Character>'s emergency measure getting another season."

The target can be obvious without dramatizing a literal employee or individual performing the behavior.

---

# COMPRESSION TEST

For every caption ask:

1. Can the setup clause disappear?
2. Can one loaded word replace a phrase?
3. Is the second half explaining the first half?
4. Am I restating event information the reader already knows?
5. Can I remove five words without losing the joke?

If yes, shorten it.

BAD SHAPE:

"<Character> when people point out the policy still has not ended: continues describing it as temporary."

This explains the contradiction before making the joke.

BETTER SHAPE:

"<Character>'s temporary policy entering another season."

The audience supplies the contradiction.

---

# DO NOT FORCE THE ANALYSIS INTO THE CAPTION

Fields such as:
- `wants`
- `pretends`
- `would_never_admit`
- `comic_contradiction`
- `reusable_engine`

exist to HELP YOU FIND THE JOKE.

They are not ingredients that must all appear in the finished caption.

A strong joke may express the entire analysis through one verb, one euphemism, one comparison, or one fake quote.

---

# GIF PAIRING COMES AFTER THE JOKE

First write the strongest caption.

Then choose the simplest familiar reaction GIF emotion or action that amplifies it.

Useful GIF actions include:

- smug correction
- frantic typing
- searching furiously
- repeatedly pressing a button
- proudly unveiling something
- pretending not to hear
- looking away from something obvious
- celebrating a cosmetic fix
- doubling down
- acting completely unbothered after being caught
- acting surprised by an obvious consequence
- quietly deleting something
- confidently presenting nonsense
- nervous damage control

The GIF does not need to depict the literal event.

The caption carries the event.

The GIF carries the performance.

If a caption is funny but has no obvious GIF pairing, lower `gif_ability`; do NOT deform the caption just to make it GIF-able.

---

# DIVERSITY

The five captions must use five distinct COMIC IDEAS.

Different emotions do NOT make two ideas different.

For example:

- renaming the problem
- indefinitely renewing the problem
- pretending the problem is normal
- presenting the problem as a benefit
- ignoring the request to fix the problem

are distinct.

But:

- smugly renaming it
- cheerfully renaming it
- frantically renaming it

are one idea.

---

# SCORE EACH CAPTION 1–5

## punch

5 = lands immediately with one clear comic turn  
4 = clear and funny with minimal processing  
3 = funny after some decoding  
2 = mostly clever construction  
1 = explanation disguised as a caption

## compression

5 = nothing removable; usually 5–14 words  
4 = slightly longer but clean  
3 = contains setup the surrounding context could supply  
2 = noticeably explanatory  
1 = multiple clauses doing analytical work

## event_specificity

5 = one small detail unmistakably anchors this event  
4 = clearly tied to the event  
3 = related but somewhat generic  
2 = broadly fits the character  
1 = could attach to almost anything

Do NOT reward extra facts merely for specificity.

## target_clarity

5 = the character is obviously the butt  
4 = clear target with slight interpretation  
3 = target takes a moment to identify  
1–2 = unclear

## naturalness

5 = feels like something someone would actually post  
4 = polished but natural  
3 = noticeably written  
2 = sounds like satire copy  
1 = sounds like analysis

## gif_ability

5 = one familiar reaction GIF obviously amplifies it  
4 = easy GIF pairing  
3 = usable but less immediate  
2 = GIF would need to explain part of the joke  
1 = no useful reaction-GIF pairing

## overall

`overall` = the MINIMUM of the six scores.

Choose `best_caption` by:
1. highest `overall`
2. highest `punch`
3. highest `compression`

---

# ANTI-FAILURE CHECKLIST

Rewrite any caption that:

- explains the event before making the joke
- contains two separate punchlines
- tries to preserve the full character analysis
- adds facts only to prove event specificity
- sounds smarter than it sounds funny
- uses institutional or technical language merely because the character is institutional or technical
- starts with a GIF reaction and works backward into a premise
- requires the image to explain the text
- repeats another caption's comic kernel
- is longer than necessary

The desired reader reaction is:

"I get it immediately."

Then:

"That would work with a great reaction GIF."

---

# OUTPUT

Return ONLY valid JSON.

{
  "persona": {
    "persona_baseline": ""
  },
  "comic_relationship": {
    "comic_role": "target",
    "joke_target": ""
  },
  "humor_engine": {
    "comic_kernels": [
      ""
    ]
  },
  "joke_candidates": [
    {
      "angle_name": "",
      "kernel": "",
      "caption": "",
      "image_situation": "",
      "scores": {
        "punch": 0,
        "compression": 0,
        "event_specificity": 0,
        "target_clarity": 0,
        "naturalness": 0,
        "gif_ability": 0,
        "overall": 0
      },
      "weakest_check": ""
    }
  ],
  "best": {
    "best_caption": "",
    "best_overall": 0,
    "why_best": ""
  }
}