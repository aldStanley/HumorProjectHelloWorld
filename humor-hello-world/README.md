# The Humor Project

Next.js app with a Google-gated, Supabase-backed joke collection at `/jokes`.

## Local setup

1. Run `npm ci` in this directory.
2. Copy `.env.example` to `.env.local` and set the Supabase project URL, publishable key, and your Google OAuth client ID.
3. Configure Google and Supabase as described below.
4. Run `npm run dev` and open http://localhost:3000/jokes.

The existing `jokes` table and RLS policies are unchanged. Do not run or edit database migrations for this auth assignment. The application gates the page and its server-side data loader; the existing public-read database policy remains in effect.

## Google sign-in without a client secret

This app uses Google Identity Services in **redirect** mode. Google posts an ID token to the application's `/auth/callback`. The server validates Google's double-submit CSRF cookie, calls `supabase.auth.signInWithIdToken`, saves the Supabase session in cookies via `@supabase/ssr`, and redirects to `/jokes`.

No Google client secret is used or stored. This is not the Supabase-hosted OAuth authorization-code flow.

1. In Google Cloud, configure the OAuth consent screen and create an OAuth client of type **Web application** for this project. Only basic sign-in identity is needed.
2. Add each app origin to **Authorized JavaScript origins**, including `http://localhost:3000`, the production origin, and the exact deployment-specific Vercel origin you will submit.
3. For each origin, add exactly `<origin>/auth/callback` to **Authorized redirect URIs**. No query parameters, trailing slash, or alternate callback route. For example: `http://localhost:3000/auth/callback`.
4. In Supabase → Authentication → Sign In / Providers → Google, enable Google and register the Google client ID. Leave the client secret empty for ID-token sign-in. Keep nonce checking and email verification safeguards at their defaults. Do not change any RLS policy.
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
