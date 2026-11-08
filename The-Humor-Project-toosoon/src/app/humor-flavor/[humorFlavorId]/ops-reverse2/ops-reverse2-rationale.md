# Rationale — Text-first Flavor Inspector (ops-reverse2)

## User narrative (who + goal)

Lydia, the flavor designer, comes to this page after running a text-first
(context → image) batch to **find out why the run produced the captions it
did — and whether her latest prompt edit moved the behavior she cares
about** (currently: alt-POV captions surviving to the final ranking).

The page is strictly **read-only over archived runs**. Editing prompts and
re-running live on the Reverse Flavor Maker (ops-reverse). No edit
affordances here, ever.

## Conceptual groups (top to bottom) and the sub-goal each serves

1. **Header: Flavor being inspected** — orient + switch flavors without
   leaving the Inspector. Dropdown of text-first flavors (those with an R1
   step).
2. **Toolbar: run being inspected / tracing differences vs an earlier run**
   — pick the run under inspection and (optionally) the baseline run its
   prompts are diffed against. Prompts are edited *between runs of the same
   flavor*, so diffs are run-over-run (spec snapshot vs spec snapshot),
   never flavor-vs-flavor, and never the current DB state. Default baseline
   = the run just before the inspected one. Anchor links on the right use
   the exact section names they jump to.
3. **"To see a trace for a caption"** — the selection flow, numbered:
   1. a table of moments (one line each; clicking selects and expands to the
      full moment text),
   2. a table of ALL candidate captions for that moment — ranked and
      dropped — with image thumbnail, caption, entity, POV, alignment,
      verdict, drop reason, and a trace link. This table replaced two
      earlier redundant UIs (a button strip + a ranked-only results table).
4. **Caption trace** — follow the selected caption through every step that
   produced it (R1 analysis → R2 selection with the entity contest → R3
   writing branch → R4 verdict), prompt on the left, output on the right.
5. **Prompt changes** — connect an output change to the prompt edit that
   caused it: side-by-side diff of this run's archived prompts vs the
   baseline run's, matched by step description. The same changed blocks are
   boxed ✚ in place inside trace nodes.

## Decisions worth keeping (and why)

- **One name per thing.** Toolbar anchors say exactly what the section
  headings say ("caption trace", "prompt changes"). A link named
  "diagnostics" pointing at "What the machinery noticed" made the
  connection invisible.
- **Full sentences over pills/shorthand.** Flags and explanations are a
  plain-language category plus a complete sentence. Bracket codes like
  `[pov]` are out.
- **Goal paragraph under every section heading** — what the section helps
  the user do, before any data.
- **Selection highlight is highlighter yellow** (translucent
  `rgb(255 221 0 / 0.4)` + golden left bar) because a grey highlight was
  indistinguishable from the table header banner.
- **Page background** matches the app canvas (light yellow / dark), not the
  ops2 grey — override rides with this surface's stylesheet only.
- **Images for dropped candidates** are resolved positionally
  (`imgN` = Nth url-bearing image of the run's study image set, mapping
  order) because the archive only stores URLs on ranked results. Known
  caveat: editing a set after a run can shift old runs' keys; the durable
  fix is archiving the URL per candidate at run time.
- **Removed as redundant or out-of-scope:** the prompt editor (read-only
  surface), the "Every call, in chain order" section (duplicated the
  trace), the Kermit hero image and run-label header (unlabeled,
  redundant), the moment JSON download button, the green status dots and
  per-card alt-POV counts, and the "Mechanical checks" section (POV funnel
  + rule flags — overly specific to the alt-POV flavor, not something the
  general Inspector UI should carry).
- **Run-to-run output comparison** lives on its own page
  (`ops-reverse2/compare`, "Compare two Text-first Caption Batches",
  linked from the toolbar and the home-page tool directory) — comparing
  outputs is a different task from tracing one run.

## Open questions

- Should the caption table's POV/alignment cells also become sentences, or
  are compact chips acceptable inside dense tables? (Current call: chips
  stay in tables; sentences everywhere else.)
- Archive per-candidate image URLs at run time in the Maker?
