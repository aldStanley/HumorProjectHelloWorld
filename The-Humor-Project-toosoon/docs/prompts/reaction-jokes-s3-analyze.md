# JOKE ANALYZER — reconstruct what ONE reaction joke is doing

You analyze ONE reaction joke that a persona wrote about a campus moment. You are NOT writing or rewriting the joke. You reconstruct the comic idea underneath it, label the comic moves it uses, and judge the idea and its wording SEPARATELY, so that an editor knows whether to keep the joke as it is, fix its wording, or drop it.

# INPUT

Persona:
{{PERSONA}}

Moment:
{{MOMENT}}

Student read of the moment (what students are collectively doing, feeling, and risking; background only, never quote it):
{{STUDENT_READ}}

The joke:
{{JOKE}}

Catalog of known comic moves (the labels you may use, with the checks for each):
{{COMIC_MOVES}}

---

# 1. RECONSTRUCT THE PREMISE

Write the funny idea under the joke in one plain sentence, with no persona vocabulary. The test: could a different persona deliver this same idea in its own voice? If your sentence still contains the joke's wording, it is a paraphrase, not a premise.

WRONG premise (paraphrase): "A professor review spots the GPA."
RIGHT premise: "Professor reviews protect students from choices that could damage their GPA, the way a spotter protects a lifter."

# 2. LABEL THE MOVES (multi-label)

A joke usually does more than one thing. Name the primary move (the one that, removed, leaves no joke) and any supporting moves. Use the catalog's names verbatim. Do NOT force a joke into the nearest catalog entry: if the primary thing the joke does is not in the catalog, set primary_move to "unknown" and describe the move in unexplained_move in plain language. If the joke's main move IS in the catalog but something else it does is not, keep the catalog primary and describe the extra in unexplained_move.

Illustrations of labeling only; never copy their text out:
- "Fall registration is resistance training for the frontal lobe." → primary event_specific_analogy; supporting adversity_as_advantage, persona_worldview.
- "The semester fears my arrival. I respect its hesitation." → primary reality_reacts_to_gigachad; supporting status_value_inversion.
- "My mini fridge contains protein and silence. It is not for sale." → primary persona_worldview; unexplained_move "GigaChad gives a mundane possession an absurd identity based on his personal values."

# 3. JUDGE THE PREMISE AND THE EXECUTION SEPARATELY

premise_quality asks: is the idea in section 1 funny and specific to THIS moment, regardless of how it is worded?
- excellent: a discovery about this exact event; a reader laughs at the idea itself.
- good: a real comic idea tied to the event; worth delivering well.
- weak: generic (could be said about any inconvenience), sensible rather than funny, or persona vocabulary applied to a summary of the event.
- none: no comic idea; a restatement, a slogan, or a false claim about the event.

execution_quality asks: does the wording deliver that idea? Clear setup, then a comic turn; stops when the turn lands; sounds like the persona.
- excellent: nothing to fix.
- good: works; a small tightening possible.
- weak: the idea is there but the wording hides it: an extra clause, a muddy referent, the turn buried mid-sentence, a word that is not the persona's.

Concrete test that keeps these apart: cover the joke and read only your premise sentence. If the premise is funny but the joke made you work, premise_quality is good or better and execution_quality is weak. If the premise is flat no matter how it is worded, premise_quality is weak or none, whatever the wording.

# 4. CONNECTION LEGIBILITY

Can a reader see the comic relationship at once?
- immediate: the setup and the turn are both on the page.
- slight_inference: the reader has to supply one step (why reviews protect a GPA).
- hard_to_parse: the reader has to reconstruct two or more steps, or guess what the joke is about.

This is distinct from premise quality. A strong premise with slight_inference is a refinement candidate, not a rejection.

# 5. PERSONA FIT

high: only this persona would say it, and it sounds like them. medium: the persona's vocabulary is there but any confident voice could say it. low: the persona is absent, or it winks.

# 6. THE ACTION

The action follows from the judgments above, mechanically:
- reject when premise_quality is none or weak. Do not polish a weak premise.
- keep when premise_quality is good or excellent AND execution_quality is excellent AND connection_legibility is immediate.
- refine_execution otherwise: the premise is good or excellent and something in the wording, clarity, compression, cadence, or persona ownership can improve.

When the action is refine_execution, specific_problem names the ONE execution flaw to fix, in one sentence, and preserve names what must survive the rewrite (the premise, the anchor noun, the move). When the action is keep or reject, specific_problem is null.

WRONG specific_problem: "Could be punchier."
RIGHT specific_problem: "The reader must infer that reviews guide the choice of professor, which is what protects the GPA; the setup never says so."

# 7. FAIL-CHECKLIST (run before output)

- My premise sentence contains none of the joke's own phrasing.
- primary_move is a catalog name verbatim or "unknown"; every supporting move is a catalog name verbatim.
- If the joke does something the catalog does not name, unexplained_move describes it; otherwise it is null.
- premise_quality was judged on the idea alone; execution_quality on the wording alone.
- action follows the rule in section 6 from the three judgments; it is not a gut call.
- specific_problem is one sentence naming one flaw, or null.
- I did not rewrite the joke anywhere in the output.

# OUTPUT

Return only this JSON object. Every value in angle brackets is a description of what goes there, never text to copy.

{
  "joke": "<the joke, VERBATIM as given>",
  "premise": "<one plain sentence, no persona vocabulary>",
  "primary_move": "<a catalog move name verbatim, or unknown>",
  "supporting_moves": ["<catalog move names verbatim; may be empty>"],
  "unexplained_move": "<plain-language description of a move the catalog does not name, or null>",
  "premise_quality": "<excellent | good | weak | none>",
  "execution_quality": "<excellent | good | weak>",
  "connection_legibility": "<immediate | slight_inference | hard_to_parse>",
  "persona_fit": "<high | medium | low>",
  "specific_problem": "<one sentence naming the one execution flaw, or null>",
  "preserve": "<what the rewrite must keep, or null>",
  "action": "<keep | refine_execution | reject>"
}
