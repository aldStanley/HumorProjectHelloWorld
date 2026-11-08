-- Workshop chats from the Reaction Joke Maker (flavor 1564's pane): one row
-- per conversation about ONE joke, rewritten after every answer, so every
-- chat is kept even if the browser record is cleared (Lydia, 2026-09-09:
-- "I want to save all the chats"). "Start over" on the page begins a new
-- conversation, a new row; the old one stays.
-- Run this in the Supabase SQL editor (this repo has no migration runner).
create table if not exists public.reaction_joke_workshops (
  -- The page's id for the conversation (chat_id in the browser record).
  id text primary key,
  flavor_id bigint not null references public.humor_flavors (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  persona text not null,
  moment text not null,
  joke text not null,
  -- The page's heart id for the joke (persona + moment + joke), so rows join
  -- to hearts and to run files without string matching.
  joke_key text not null,
  -- The joke's analysis at the time (premise, moves, judgments, action), if any.
  analysis jsonb,
  -- The conversation: [{role, content, at}], user and assistant turns.
  messages jsonb not null default '[]'::jsonb,
  -- Rewrites hearted from this chat: [{caption, note, asked_for, hearted_at}].
  hearted jsonb not null default '[]'::jsonb,
  model text,
  reasoning_effort text,
  created_datetime_utc timestamptz not null default now(),
  modified_datetime_utc timestamptz not null default now()
);

create index if not exists reaction_joke_workshops_flavor_idx
  on public.reaction_joke_workshops (flavor_id, modified_datetime_utc desc);
create index if not exists reaction_joke_workshops_joke_idx
  on public.reaction_joke_workshops (joke_key);

alter table public.reaction_joke_workshops enable row level security;

create policy "reaction_joke_workshops - select authenticated"
  on public.reaction_joke_workshops for select
  using (auth.role() = 'authenticated');

create policy "reaction_joke_workshops - insert own"
  on public.reaction_joke_workshops for insert
  with check (auth.uid() = profile_id);

create policy "reaction_joke_workshops - update own"
  on public.reaction_joke_workshops for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);
