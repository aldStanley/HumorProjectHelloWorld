-- Shared runs from the Reaction Joke Maker: one row per "Share this run by
-- link" press, holding a frozen copy of the run as the page had it (moments,
-- persona, jokes with their scores and analyses, student reads, hearts), so
-- a link can show someone else exactly that set (Lydia, 2026-09-17: "is
-- there a way the URL could have this specific set of moments/jokes/hearts
-- in it so I can send it to someone else?"). The run otherwise lives only in
-- the sharer's browser. A snapshot never changes; sharing again makes a
-- new row.
-- Run this in the Supabase SQL editor (this repo has no migration runner).
create table if not exists public.reaction_joke_shares (
  -- Short random id; the ?share= value in the link.
  id text primary key,
  flavor_id bigint not null references public.humor_flavors (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  persona text not null,
  moment_count integer not null default 0,
  hearted_count integer not null default 0,
  -- The page's run record: {moments, personaName, jokeCount, jobs, readJobs, studentReads, hearted}.
  snapshot jsonb not null,
  created_datetime_utc timestamptz not null default now()
);

create index if not exists reaction_joke_shares_flavor_idx
  on public.reaction_joke_shares (flavor_id, created_datetime_utc desc);

alter table public.reaction_joke_shares enable row level security;

create policy "reaction_joke_shares - select authenticated"
  on public.reaction_joke_shares for select
  using (auth.role() = 'authenticated');

create policy "reaction_joke_shares - insert own"
  on public.reaction_joke_shares for insert
  with check (auth.uid() = profile_id);
