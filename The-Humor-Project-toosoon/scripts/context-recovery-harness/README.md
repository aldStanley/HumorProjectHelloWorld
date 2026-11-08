# context-recovery-harness — blind-test whether captions carry their context

Runs **flavor 1544** (read → entities → three register read/moments/caption
triplets, S1–S13) on images from a study set and builds a **blind evaluation
page**: each caption is shown with its image and you decide "do I get the
story?" *before* the hidden context and the model's self-scored
`context_recovery` are revealed. Your rating is therefore uncontaminated by
the model's opinion.

```bash
# default: 5 images from study set 67
node scripts/context-recovery-harness/harness.mjs

# more images, or specific ones (image ids or literal URLs)
node scripts/context-recovery-harness/harness.mjs --count 8
node scripts/context-recovery-harness/harness.mjs --images 3c63d67c-a51c-445d-a3f7-3d2ae1b9d06e

# another flavor / set
node scripts/context-recovery-harness/harness.mjs --flavor 1544 --set 67
```

Output: `scripts/context-recovery-harness/eval-<flavor>.html` (open in a
browser), plus a per-caption score summary on stdout.

## The eval page

- **Rate first**: "Got it" / "Partly" / "Lost" — only then does the card
  reveal the hidden context, the model's `context_recovery` + reason, and an
  agree/mismatch verdict (Got it ↔ ≥ 0.7, Partly ↔ 0.4–0.69, Lost ↔ < 0.4).
- Every card has a **notes box** (saved in localStorage as you type).
  **Download notes for Claude** saves `ctxrec-<flavor>-notes.json` (ratings +
  notes + captions + contexts + model scores) to Downloads — hand that file
  to Claude to act on your notes. **Copy results JSON** puts the same rows on
  the clipboard.
- The header tallies agreement live. If the model's scores saturate near 1.0
  while your ratings don't, the self-score isn't discriminating — that's the
  signal to build an independent blind-judge step instead.

## The tweak loop

Prompts are fetched fresh from the DB each run; every LLM call is cached in
`cache/` by content hash (model + substituted prompts + image), so editing a
step's prompt re-runs only that step and everything downstream. Deleting
`cache/` forces a fresh run. The harness never writes to the database.
