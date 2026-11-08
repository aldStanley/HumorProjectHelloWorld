-- Per-user "favorite" flag + free-text comment for a humor flavor.
-- Run this in the Supabase SQL editor (this repo has no migration runner).
create table if not exists public.humor_flavor_favorites (
  id bigint generated always as identity primary key,
  flavor_id bigint not null references public.humor_flavors (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  is_favorite boolean not null default true,
  comment text,
  created_datetime_utc timestamptz not null default now(),
  modified_datetime_utc timestamptz,
  -- one row per (user, flavor) so we can upsert on toggle / comment save
  unique (flavor_id, profile_id)
);

alter table public.humor_flavor_favorites enable row level security;

-- A user can only see and manage their own favorites.
create policy "humor_flavor_favorites - select own"
  on public.humor_flavor_favorites for select
  using (auth.uid() = profile_id);

create policy "humor_flavor_favorites - insert own"
  on public.humor_flavor_favorites for insert
  with check (auth.uid() = profile_id);

create policy "humor_flavor_favorites - update own"
  on public.humor_flavor_favorites for update
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create policy "humor_flavor_favorites - delete own"
  on public.humor_flavor_favorites for delete
  using (auth.uid() = profile_id);
