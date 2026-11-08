# scene-harness — compare scene models through a whole flavor, jokes included

Runs **flavor 1534** (the scene track snapshotted from 1528: plain read →
scene graph → stance → alignment → casting → caption writer → extraction) on
the four test images, once per scene-model variant, and builds a side-by-side
faceoff page with each column's captions at the top.

```bash
# full default run: flavor 1534, scene steps S2+S3 varied across
# flavor-default / gemini-3.5-flash / gemini-2.5-pro / gpt-5.5
node scripts/scene-harness/harness.mjs

# fewer columns, one image
node scripts/scene-harness/harness.mjs --models flavor,gemini-2.5-pro --images img1

# a different flavor or different scene steps
node scripts/scene-harness/harness.mjs --flavor 1534 --scene-steps 2,3
```

Output: `scripts/scene-harness/faceoff-<flavor>.html` (open in a browser),
plus the captions printed to stdout.

## The tweak loop

1. Edit any step's prompt on flavor 1534 in the flavor editor.
2. Re-run `node scripts/scene-harness/harness.mjs`.
3. Only the edited step **and everything downstream of it** re-runs — every
   call is cached in `cache/` keyed by a hash of (model + fully substituted
   prompts + image), so an upstream change invalidates the chain below it
   automatically and unchanged work is never re-billed. Deleting `cache/`
   forces a fully fresh run.

Notes:
- The "flavor" variant means: run the scene steps on whatever models the
  flavor itself is configured with. Other variant names are provider model
  ids applied to the scene steps only.
- Rendering is shape-based (it finds the step whose JSON has `captions`,
  `parties`, `tldr`, `selected_moments`), so adding or renumbering steps in
  the flavor doesn't break the page.
- Caption steps run at their DB temperatures (the caption writer at 0.7), so
  captions vary between cache misses — compare patterns, not single captions.
- Reads `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, and the Supabase URL/anon key
  from the repo's `.env`. The harness never writes to the database.
