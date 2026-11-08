-- Precomputed per-image "reaction profiles" for the reverse (context → image)
-- pipeline. One row per (image, flavor): the flavor's preprocessing steps
-- (Scene Pack / Interpretive Stance / Punchline Constraint / Search Card) run
-- once per image and their outputs are cached here, so the reverse search can
-- match a moment against many images without re-running vision steps.
-- Run this in the Supabase SQL editor (this repo has no migration runner).
create table if not exists public.image_reaction_profiles (
  id bigint generated always as identity primary key,
  image_id uuid not null references public.images (id) on delete cascade,
  humor_flavor_id bigint not null references public.humor_flavors (id) on delete cascade,
  -- raw text output of each preprocessing step, keyed by order_by ("1".."4")
  step_outputs jsonb not null default '{}'::jsonb,
  -- parsed JSON of the Search Card step — the compact representation the
  -- reverse selection step actually searches over
  search_card jsonb,
  -- hash of the preprocessing steps' prompts at generation time; a mismatch
  -- with the current prompts means the profile is stale and should be re-run
  prompt_hash text not null,
  profile_id uuid references public.profiles (id),
  created_datetime_utc timestamptz not null default now(),
  modified_datetime_utc timestamptz not null default now(),
  -- one profile per (image, flavor) so preprocessing can upsert
  unique (image_id, humor_flavor_id)
);

alter table public.image_reaction_profiles enable row level security;

-- Profiles are shared infrastructure (image preprocessing, not user data):
-- any signed-in user can read and refresh them.
create policy "image_reaction_profiles - select authenticated"
  on public.image_reaction_profiles for select
  to authenticated
  using (true);

create policy "image_reaction_profiles - insert authenticated"
  on public.image_reaction_profiles for insert
  to authenticated
  with check (true);

create policy "image_reaction_profiles - update authenticated"
  on public.image_reaction_profiles for update
  to authenticated
  using (true)
  with check (true);

create policy "image_reaction_profiles - delete authenticated"
  on public.image_reaction_profiles for delete
  to authenticated
  using (true);
