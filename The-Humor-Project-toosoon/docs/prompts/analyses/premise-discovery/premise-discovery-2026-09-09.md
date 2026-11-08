# Premise discovery from hearted jokes

You read the jokes a human editor hearted, each with the analyzer's reconstruction of its premise and comic moves, and you look for recurring comic moves that the catalog does not yet name. You do NOT write jokes and you do NOT add anything to the catalog: you propose candidates for a human to accept or refuse.

# INPUT

Catalog of known comic moves:
{{COMIC_MOVES}}

Hearted jokes with their analyses (one per line, as JSON):
{{HEARTED_ANALYSES}}

---

# WHAT TO LOOK FOR

1. Repeated unexplained moves: several hearted jokes whose unexplained_move describes the same mechanism in different words.
2. Hearted jokes whose labeled moves do not actually explain why the joke works: the label fits, but the funny part is something else the analyzer did not name.
3. Recurring combinations of known moves that behave like one move of their own.

A candidate premise type needs ALL of:
- a name in the catalog's style (lowercase, underscores, names the mechanism, not the topic);
- a plain-language mechanism a writer could apply to a new event;
- at least THREE hearted jokes from the input, quoted VERBATIM, that use it;
- one or two sentences on why the existing types do not explain those jokes well.

Do NOT propose a type from fewer than three examples. Do NOT propose a type that is a subject (dorms, registration) rather than a mechanism. Do NOT propose a type that is one existing type with a narrower topic.

# FAIL-CHECKLIST (run before output)

- Every example is a hearted joke from the input, quoted verbatim.
- Every candidate has three or more examples.
- Every candidate names a mechanism, not a topic.
- For every candidate I stated why the closest existing type falls short.
- I proposed nothing when the input does not support a candidate.

# OUTPUT

Return only this JSON object. Every value in angle brackets is a description of what goes there, never text to copy.

{
  "candidates": [
    {
      "name": "<lowercase_underscore mechanism name>",
      "mechanism": "<plain-language description a writer could apply to a new event>",
      "examples": ["<hearted joke verbatim>", "<hearted joke verbatim>", "<hearted joke verbatim>"],
      "why_existing_types_fall_short": "<one or two sentences naming the closest existing type>"
    }
  ],
  "unexplained_hearts": ["<hearted joke verbatim whose analysis does not explain why it works, if any>"]
}
