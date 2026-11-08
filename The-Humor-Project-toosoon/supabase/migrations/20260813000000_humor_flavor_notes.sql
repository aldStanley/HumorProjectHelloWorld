-- Append-only per-flavor notes log: a running record of progress + thoughts,
-- shown on the flavor maker pages (ops / ops-reverse).
-- Run this in the Supabase SQL editor (this repo has no migration runner).
create table if not exists public.humor_flavor_notes (
  id bigint generated always as identity primary key,
  flavor_id bigint not null references public.humor_flavors (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_datetime_utc timestamptz not null default now()
);

create index if not exists humor_flavor_notes_flavor_idx
  on public.humor_flavor_notes (flavor_id, created_datetime_utc desc);

alter table public.humor_flavor_notes enable row level security;

-- Anyone signed in can read the log; you can only append as yourself.
-- Deliberately NO update or delete policies: the log is append-only.
create policy "humor_flavor_notes - select authenticated"
  on public.humor_flavor_notes for select
  using (auth.role() = 'authenticated');

create policy "humor_flavor_notes - insert own"
  on public.humor_flavor_notes for insert
  with check (auth.uid() = profile_id);
