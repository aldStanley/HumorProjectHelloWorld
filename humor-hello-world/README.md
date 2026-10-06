# The Humor Project

Next.js app with a Google-gated, Supabase-backed joke collection at `/jokes`.

## Local setup

1. Run `npm ci` in this directory.
2. Copy `.env.example` to `.env.local` and set the Supabase project URL, publishable key, and your Google OAuth client ID.
3. Configure Google and Supabase as described below.
4. Run `npm run dev` and open http://localhost:3000/jokes.

## Assignment 4: Caption Lab

The `/jokes` page now combines a photo upload studio with a caption voting board. Existing jokes remain as the original collection. Each new upload generates three private suggestions. The user chooses one or writes a custom joke; only that final joke is published.

### Required setup

1. Apply `supabase/migrations/20261001000100_caption_lab.sql` to the existing Supabase project with the SQL Editor or `supabase db push` from an authenticated, linked CLI. Apply only unapplied migrations. This also makes the existing avatar bucket private: deploy the matching app update immediately afterward so profile photos use signed URLs.
2. Set `GEMINI_API_KEY` in `.env.local` and in Vercel's Production and Preview environment settings. Never prefix this secret with `NEXT_PUBLIC_`. `GEMINI_MODEL` defaults to `gemini-3.1-flash-lite` and can be overridden with a compatible vision + structured-output model.
   Keep the Google AI Studio project on Free Tier with billing disabled to avoid API charges. The app does not enable billing or fall back to another provider. Quota exhaustion returns an error. Google may use free-tier inputs and outputs to improve its products.
3. Restart/redeploy after adding the key. If the key is missing, the upload endpoint reports an actionable configuration error; it never pretends to generate captions.

The first [Gemini API](https://ai.google.dev/gemini-api/docs/image-understanding) call describes the uploaded image. A separate call receives only that description and returns three captions using [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output). The server validates and saves a private draft. A separate authenticated publication request saves exactly one selected or custom caption atomically. No service-role key is required.

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

Manual end-to-end acceptance: sign in, upload a real photo, choose a suggestion or write a custom joke, then verify exactly one new caption with the photo, vote and reload, switch the vote, then sign in as a second account and verify independent votes. Test image rejection and the missing-key error. In Incognito, `/jokes` must show the app's sign-in gate and mutation requests must be rejected.

## Google sign-in without a client secret

This app uses Google Identity Services in **redirect** mode. Google posts an ID token to the application's `/auth/callback`. The server validates Google's double-submit CSRF cookie, calls `supabase.auth.signInWithIdToken`, saves the Supabase session in cookies via `@supabase/ssr`, and redirects to `/jokes`.

No Google client secret is used or stored. This is not the Supabase-hosted OAuth authorization-code flow.

1. In Google Cloud, configure the OAuth consent screen and create an OAuth client of type **Web application** for this project. Only basic sign-in identity is needed.
2. Add each app origin to **Authorized JavaScript origins**, including `http://localhost:3000`, the production origin, and the exact deployment-specific Vercel origin you will submit.
3. For each origin, add exactly `<origin>/auth/callback` to **Authorized redirect URIs**. No query parameters, trailing slash, or alternate callback route. For example: `http://localhost:3000/auth/callback`.
4. In Supabase → Authentication → Sign In / Providers → Google, enable Google and register the Google client ID. Leave the client secret empty for ID-token sign-in. Keep nonce checking and email verification safeguards at their defaults. Apply the Assignment 4 RLS migration described above.
5. This project's public Google client ID is configured in `src/lib/google.ts`. For a different client, set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` locally and in Vercel. Redeploy after changing it because Next.js embeds this public value during the build.
6. This app requests only basic Google identity. Google's [basic-identity exception](https://support.google.com/cloud/answer/15549945?hl=en) allows sign-in without a test-user allowlist even with a Testing audience. Revisit publishing and verification requirements if adding Google API scopes.

The callback URL is built from the browser's current origin, so signing in on a deployment-specific URL keeps the session on that deployment. Google origins and redirect URIs must explicitly include that deployment hostname.

References: [Google redirect flow](https://developers.google.com/identity/gsi/web/guides/integrate), [Supabase Google ID-token sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

## Validation

- Run `npm run lint` and `npm run build`.
- Run `npm run start` in one terminal, then `npm run test:auth` in another. The HTTP checks verify the signed-out gate and rejection of missing/mismatched CSRF tokens, unsupported payloads, direct GET callbacks, and callback query strings. Set `TEST_BASE_URL` to test a deployed origin.
- In a fresh Incognito session, visit `/jokes`: it must redirect to the gated `/login` UI without returning joke content.
- Complete Google sign-in: the credential must POST to `/auth/callback` without query parameters, then the collection must show your account and a Sign out button.
- Reload to check session persistence. Sign out, then revisit `/jokes` to confirm the gate returns.

`getUser()` verifies identity with Supabase before protected data is fetched. The Next.js proxy refreshes sessions and prevents shared caching. Sign-out uses a same-origin Server Action.

## Vercel and submission

Use Next.js with Root Directory `humor-hello-world`. The existing Supabase integration supplies the Supabase variables for Production. The registered Google client ID is included in the public app configuration; `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is an optional override.

Deployment Protection must allow public access so Incognito visitors can reach the app's own Google sign-in gate. Submit the **deployment-specific URL** associated with the final Git commit (not the moving production or branch alias), ending in `/jokes`. Register that deployment origin and its exact `/auth/callback` URI in Google before testing and submitting.

## Daily Comedy Jury

Apply `supabase/migrations/20261004000100_daily_comedy_jury.sql` after the caption-lab migration. It adds four RLS-protected tables and two authenticated RPCs; no new environment variables or paid services are needed.

Apply `supabase/migrations/20261006000100_jury_co_winners.sql` to enable co-winners and award missing trophies for past tied rounds.

Every member receives the same five daily exhibits, drawn from different images and favoring captions not recently shown. Members rate all five Funny (+1) or Meh (-1), separately predict the crowd's winner, then seal one immutable ballot. Daily ratings are separate from the optional caption board. Other people's ballots and daily standings stay hidden until closing.

Rounds close at midnight in `America/New_York`. The first authenticated visit after closing finalizes results and automatically awards one Golden Laugh to each winning predictor, even if that person misses the next day. No scheduled job is required. Highest rating score wins; all entries tied for the highest score are co-winners. Picking any co-winner earns one Golden Laugh for that round. A day without ballots has no winner. The next visit shows the latest completed round, and `/jokes/trophies` preserves earned captions, photos, and dates. Deleted source photos display a fallback.

Run `npm run test:jury` for request validation, or `TEST_BASE_URL=http://localhost:3000 npm run test:jury` to include signed-out/origin HTTP checks. Run `supabase/tests/daily_jury.sql` in Supabase SQL Editor for rolled-back integration tests of ballot validation, ownership, sealing, cutoffs, winner selection, ties, quiet days, reward idempotency, anonymous access, and daylight-saving boundaries. Requires five eligible images. All test identities and fixtures are rolled back.

### Local winner-reveal demonstration

Run `npm run dev`, then open `http://localhost:3000/demo/jury`. Choose Winning pick, Co-winners, Losing pick, Didn’t participate, or No votes. Use Stage the reveal followed by Open the verdict for a presentation, or Replay reveal to replay the reward animation. The trophy link scrolls to a sample trophy on the same page. All data is fictional and local: no login, Supabase requests, Gemini calls, ballot writes, or real rewards. This page reuses the app’s actual reveal component and returns 404 in production builds, including Vercel deployments.

### Choose one caption

Apply `supabase/migrations/20261005000100_caption_selection.sql` before deploying the selection flow. Generation reserves and uploads the image, then saves three private suggestions with its description. `/api/captions/publish` publishes one selected or custom text (1–240 characters). Row locking and idempotent retries prevent duplicate publication. Unchosen drafts stay unpublished; a page reload currently abandons the in-browser selection, and administrators may clean up abandoned images later. Existing three-caption uploads are preserved. The legacy publication RPC remains during rollout for the previous deployed app. Run `supabase/tests/caption_selection.sql` for rolled-back database checks.
