# The Humor Project

Next.js app with a public, Supabase-backed jokes collection at `/jokes`.

## Local setup

1. Run `npm ci` in this directory.
2. Copy `.env.example` to `.env.local` and set your Supabase project URL and publishable key.
3. Apply `supabase/migrations/20260921000100_create_jokes.sql` once in your Supabase project (already applied for this project).
4. Add rows using the Supabase Table Editor: `picture` is a public image URL, `text` is the caption, and `id` is automatic.
5. Run `npm run dev` and open http://localhost:3000/jokes.

## Validation

Run `npm run lint` and `npm run build`.

## Vercel

Use Next.js with Root Directory `humor-hello-world`. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the deployment environment. This project's Supabase integration supplies them for Production. Redeploy after environment changes.

The list queries Supabase on each request and handles empty results, request errors, and unavailable images. Row-level security permits public reads only; use the Supabase dashboard to manage content. No service-role key is used.

For submission, verify the deployment-specific URL ending in `/jokes` in Incognito. Deployment Protection must allow public access.
