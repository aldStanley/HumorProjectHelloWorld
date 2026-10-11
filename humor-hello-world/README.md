# The Humor Project

Next.js app with a public, Supabase-backed Caption Lab at `/`. Google sign-in is required for voting and uploading.

## Local setup

1. Run `npm ci` in this directory.
2. Copy `.env.example` to `.env.local` and set the Supabase project URL and publishable key.
3. Configure Google and Supabase as described below.
4. Run `npm run dev` and open http://localhost:3000/jokes.

## Assignment 4: Caption Lab

The `/jokes` page now combines a photo upload studio with a caption voting board. Existing jokes remain as the original collection. Each new upload generates three private suggestions. The user chooses one or writes a custom joke; only that final joke is published.

### Required setup

1. Apply `supabase/migrations/20261001000100_caption_lab.sql` to the existing Supabase project with the SQL Editor or `supabase db push` from an authenticated, linked CLI. Apply only unapplied migrations. This also makes the existing avatar bucket private: deploy the matching app update immediately afterward so profile photos use signed URLs.
2. Set `GEMINI_API_KEY` in `.env.local` and in Vercel's Production and Preview environment settings. Never prefix this secret with `NEXT_PUBLIC_`. `GEMINI_MODEL` defaults to `gemini-3.1-flash-lite` and can be overridden with a compatible vision + structured-output model.
   Keep the Google AI Studio project on Free Tier with billing disabled to avoid API charges. The app does not enable billing or fall back to another provider. Quota exhaustion returns an error. Google may use free-tier inputs and outputs to improve its products.
3. Restart/redeploy after adding the key. If the key is missing, the upload endpoint reports an actionable configuration error; it never pretends to generate captions.

The first [Gemini API](https://ai.google.dev/gemini-api/docs/image-understanding) call describes the uploaded image. A separate call receives only that description and returns three captions using [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output). The writer is prompted to generate Columbia campus or NYC jokes using natural local references. There is no theme keyword filter or automatic retry based on topic; the server checks caption format and saves a private draft. A separate authenticated publication request saves exactly one selected or custom caption atomically. No service-role key is required.

### Data and security

- `jokes` stores captions, with an optional `image_id` pointing to `caption_images`.
- `caption_images` records the authenticated owner, private Storage path, description, processing status, and creation time.
- `caption_votes` stores a new row on the first vote and permits changing only the owner's vote value. The composite primary key prevents duplicate votes; only `-1` and `1` are valid.
- All public application tables have RLS enabled. Anonymous access to captions is revoked, profiles and individual votes are owner-only, and members can read published caption images. Only aggregate scores expose other users' votes.
- All RPCs use an empty search path, explicit authentication checks, and authenticated-only execution grants. The quota RPC serializes requests for the same account and allows 10 upload attempts per rolling 24 hours, including failures.
- Caption images and avatars are private buckets. Caption photos use one-hour signed URLs. Upload paths must match a reserved image owned by the caller; published images cannot be overwritten or deleted by clients. Unpublished files are removed on handled generation failures. A hard process termination can leave an unpublished file for admin cleanup.
- Uploads accept JPG, PNG, and WebP up to 3 MB; server checks both MIME type and file signatures. Both mutation endpoints verify the session with Supabase Auth and require a same-origin request.
- Pagination fetches 30 captions at a time. The interface shows saved vote state, upload preview, generation progress, and recoverable errors.

### Validation

Run `npm run lint` and `npm run build`, then start the production app with `npm run start`:

```sh
npm run test:auth
npm run test:captions
npm run test:chain
```

`test:chain` verifies the real prompt-chain implementation with mocked HTTP responses (no paid calls). `test:captions` checks image signatures, malformed and duplicate model output, signed-out mutation requests, and origin checks. Requires Node 22.6+ for TypeScript stripping. Run `supabase/tests/caption_security.sql` in the SQL Editor after migrating; it checks database ownership, constraints, quota, and anonymous access in a rolled-back transaction. Requires one existing signed-in user and a seeded caption.

Manual end-to-end acceptance: sign in, upload a real photo, choose a suggestion or write a custom joke, then verify exactly one new caption with the photo, vote and reload, switch the vote, then sign in as a second account and verify independent votes. Test image rejection and the missing-key error. In Incognito, `/` and `/jokes` must show public captions; mutation requests must be rejected.

## Google sign-in across Vercel deployments

Sign-in uses Supabase OAuth with PKCE. The browser starts `signInWithOAuth` with its current origin plus `/auth/callback`. Google always returns to Supabase's fixed callback; Supabase returns a code to the original deployment. The app exchanges that code using the same-host verifier cookie, saves session cookies, and sends the user home or to onboarding. No Google secret belongs in this app, `.env.local`, or Vercel.

One-time configuration:

1. In the existing Google Cloud Web application OAuth client, add this **Authorized redirect URI**: `https://mvxvwvjxokhrtlprtpwq.supabase.co/auth/v1/callback`. Preserve existing entries if older immutable deployments still use direct Google sign-in.
2. In Supabase → Authentication → Sign In / Providers → Google, enable Google and configure the existing web client ID and its client secret. Keep nonce checks and email safeguards enabled. The secret stays in Supabase.
3. In Supabase → Authentication → URL Configuration, set Site URL to the production home URL. Add these **Redirect URLs**:
   - `http://localhost:3000/auth/callback`
   - `https://humor-project-hello-world-aldstanleys-projects.vercel.app/auth/callback`
   - `https://humor-project-hello-world-eta.vercel.app/auth/callback` (existing production alias).
   - `https://humor-project-hello-world-*-aldstanleys-projects.vercel.app/auth/callback`

The wildcard is restricted to this Vercel project and team. New commit deployments using this flow need no additional Google registration. Old immutable deployments keep their old implementation. If the Vercel project/team slug or Supabase project changes, update the corresponding callback configuration.

If Google accepts the redirect but Supabase reports `invalid_client` / `The provided client secret is invalid`, correct the Google provider secret in Supabase. Google's console may not reveal previously created secrets; add a new secret to the same OAuth client if needed, then store it in Supabase. Never commit a secret or place it in a `NEXT_PUBLIC_` variable.

References: [Supabase Google OAuth](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase redirect wildcards](https://supabase.com/docs/guides/auth/redirect-urls), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

## Validation

- Run `npm run lint`, `npm run build`, and `npm run test:oauth`. OAuth tests exercise the real Supabase SSR exchange with mocked HTTP responses, checking verifier handling, session cookies, home/onboarding redirects, and failed codes.
- Run `npm run start` in one terminal, then `npm run test:auth` in another. The HTTP checks verify public browsing, authenticated actions, and rejection of missing/invalid OAuth codes, provider errors, and obsolete POST callbacks. Set `TEST_BASE_URL` to test a deployed origin.
- In a fresh Incognito session, visit `/jokes`: it must show the caption board without requiring sign-in.
- Complete Google sign-in: Google must return through the fixed Supabase callback and then GET the starting deployment’s `/auth/callback?code=…`; the home page must show your account and a Sign out button.
- Reload to check session persistence. Sign out, then revisit `/jokes` to confirm browsing still works and voting requests sign-in.

`getUser()` verifies identity with Supabase before protected data is fetched. The Next.js proxy refreshes sessions and prevents shared caching. Sign-out uses a same-origin Server Action.

## Vercel and submission

Use Next.js with Root Directory `humor-hello-world`. The existing Supabase integration supplies the Supabase variables for Production. Google client credentials are configured in Supabase, not Vercel. Ensure the public Supabase variables are also available to Preview deployments.

Deployment Protection must allow public access so Incognito visitors can reach the app's own Google sign-in gate. Submit the **deployment-specific URL** associated with the final Git commit (not the moving production or branch alias), ending in `/jokes`. The Supabase redirect pattern above covers new commit deployment URLs; test sign-in on the exact URL you submit.

## Daily Comedy Jury

Apply `supabase/migrations/20261004000100_daily_comedy_jury.sql` after the caption-lab migration. It adds four RLS-protected tables and two authenticated RPCs; no new environment variables or paid services are needed.

Apply `supabase/migrations/20261006000100_jury_co_winners.sql` to enable co-winners and award missing trophies for past tied rounds.

Every member receives the same five daily exhibits, favoring captions not recently shown, with repeated photos allowed. Members choose one joke and seal one immutable vote per daily round. Each vote adds one point only to that joke. Daily votes are separate from the optional caption board. Other people's ballots and daily standings stay hidden until closing.

Rounds close at midnight in `America/New_York`. The first authenticated visit after closing finalizes results and automatically awards one Golden Laugh to each winning predictor, even if that person misses the next day. No scheduled job is required. Highest rating score wins; all entries tied for the highest score are co-winners. Picking any co-winner earns one Golden Laugh for that round. A day without ballots has no winner. The next visit shows the latest completed round, and `/jokes/trophies` preserves earned captions, photos, and dates. Deleted source photos display a fallback.

Run `npm run test:jury` for request validation, or `TEST_BASE_URL=http://localhost:3000 npm run test:jury` to include signed-out/origin HTTP checks. Run `supabase/tests/daily_jury.sql` in Supabase SQL Editor for rolled-back integration tests of ballot validation, ownership, sealing, cutoffs, winner selection, ties, quiet days, reward idempotency, anonymous access, and daylight-saving boundaries. Requires five eligible captions. All test identities and fixtures are rolled back.

### Local winner-reveal demonstration

Run `npm run dev`, then open `http://localhost:3000/demo/jury`. Choose Winning pick, Co-winners, Losing pick, Didn’t participate, or No votes. Use Stage the reveal followed by Open the verdict for a presentation, or Replay reveal to replay the reward animation. The trophy link scrolls to a sample trophy on the same page. All data is fictional and local: no login, Supabase requests, Gemini calls, ballot writes, or real rewards. This page reuses the app’s actual reveal component and returns 404 in production builds, including Vercel deployments.

### Choose one caption

Apply `supabase/migrations/20261005000100_caption_selection.sql` before deploying the selection flow. Generation reserves and uploads the image, then saves three private suggestions with its description. `/api/captions/publish` publishes one selected or custom text (1–240 characters). Row locking and idempotent retries prevent duplicate publication. Unchosen drafts stay unpublished; a page reload currently abandons the in-browser selection, and administrators may clean up abandoned images later. Existing three-caption uploads are preserved. The legacy publication RPC remains during rollout for the previous deployed app. Run `supabase/tests/caption_selection.sql` for rolled-back database checks.

### Public browsing and campus captions

Before deploying this version, apply `supabase/migrations/20261009000100_public_browsing_local_captions.sql`. The home page includes the jury and caption board. Anonymous visitors can read published captions, photos, scores, and existing jury rounds. Draft images, individual votes, ballots, profiles, and trophies retain their private permissions. Round preparation and settlement still run on authenticated visits. Clicking vote, predict, or upload requests Google sign-in.

This migration replaces the six original assignment fixtures and their jury caption snapshots with Columbia/NYC captions. It preserves caption IDs, vote totals, winning picks, and trophies. Existing user-uploaded captions are unchanged.

Caption Lab is the main entrance at `/`; `/jokes` remains a public compatibility URL. Navigation, Google sign-in completion, onboarding completion, and sign-out return to the home page. The Caption Lab charcoal/acid-yellow palette and editorial typography are shared by sign-in, profile, onboarding, loading, and recovery screens.

The public-browsing migration was applied to the connected Supabase project through SQL Editor on October 9, 2026, and `supabase/tests/public_browsing.sql` passed there. Migration history in that database only tracks the original September migrations; subsequent migrations were applied manually. Do not rerun the public policy creation statements on that project. Other environments still need the migration before this app version is deployed.

### Repeated photos

Photo uploads do not check image hashes, original filenames, or matching content; every upload receives a new storage path. Apply `supabase/migrations/20261010000100_allow_repeated_jury_photos.sql` to remove the daily jury’s one-caption-per-image filter. Future rounds may include multiple captions from the same photo. Existing rounds retain their selected exhibits. Run `supabase/tests/repeated_jury_photos.sql` to verify this in a rolled-back transaction.

The repeated-photo migration was applied to the connected Supabase project on October 10, 2026. The five-captions/one-photo regression test passed with all fixture changes rolled back.

### Board-first home page

The home page uses a compact heading and an always-visible upload studio above the public Punchline board. Funny/Meh caption voting is the main experience. The optional daily jury now lives at `/jokes/jury`, linked between the upload studio and the board; its verdict no longer occupies the home page. Cards share the charcoal palette and omit decorative stamps, photo labels, and numbering. Upload preview, generation, selection, and publication remain in the studio.

### One joke vote per daily jury

Apply `supabase/migrations/20261010000200_single_jury_vote.sql` before deploying this change. The jury now offers one radio choice and one sealed vote per user per daily round. The API constructs the single-vote payload, and the database rejects multiple joke votes and repeat submissions. Existing ballots in unfinalized rounds become a single vote for their saved pick. Finalized results and earned trophies remain unchanged. Run `supabase/tests/single_jury_vote.sql` to verify database enforcement in a rolled-back transaction.

## Caption source tags

Apply `supabase/migrations/20261010000300_caption_source.sql` before deploying this version. Published AI suggestions show **AI-generated**; the custom-writing option shows **Human-written**. The database derives `jokes.caption_source` from saved suggestions during publication, so the tag also works with existing app versions. Existing uploaded jokes are backfilled using their stored suggestions; old AI-only publications are marked AI. Imported jokes with no source record stay unlabeled rather than being assumed human-written. Tags appear in the upload choices, punchline board, My creations, daily jury, and trophies.

Run `supabase/tests/caption_source.sql` in the SQL editor to check suggestion/custom provenance, legacy publication, retries, and unknown sources. Test data rolls back.
