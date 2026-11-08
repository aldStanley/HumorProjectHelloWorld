-- Batch runs from the ops page (/humor-flavor/<id>/ops): one row per "run the
-- whole pipeline over these N images", plus a row per image and a row per LLM
-- call. Everything needed to analyze a run later — or to recreate it — is
-- stored: the rendered prompts exactly as sent, the resolved input slots, the
-- raw output, model/temperature, timings, and a spec snapshot of the pipeline.
-- Run this in the Supabase SQL editor (this repo has no migration runner).

create table if not exists public.ops_runs (
  id uuid primary key default gen_random_uuid(),
  humor_flavor_id bigint not null references public.humor_flavors (id) on delete cascade,
  flavor_slug text,
  study_image_set_id bigint references public.study_image_sets (id) on delete set null,
  study_image_set_slug text,
  label text,
  -- running | done | error | canceled
  status text not null default 'running',
  image_count int not null default 0,
  caption_count int not null default 0,
  -- the Quick Study export array for the whole batch (all images concatenated)
  export_json jsonb,
  -- set when the final step's output was not a caption list
  export_warning text,
  -- snapshot for recreating the run: every op's key/title/model/temperature and
  -- its system+user prompt TEMPLATES, plus bindings, pinned outputs and hidden
  -- keys as they were when the batch started
  spec jsonb not null default '{}'::jsonb,
  profile_id uuid references public.profiles (id),
  started_datetime_utc timestamptz not null default now(),
  finished_datetime_utc timestamptz
);

create index if not exists ops_runs_flavor_idx
  on public.ops_runs (humor_flavor_id, started_datetime_utc desc);

create table if not exists public.ops_run_images (
  id uuid primary key default gen_random_uuid(),
  ops_run_id uuid not null references public.ops_runs (id) on delete cascade,
  image_id uuid references public.images (id) on delete set null,
  image_url text,
  position int not null default 0,
  -- running | done | error
  status text not null default 'running',
  error text,
  -- opKey -> that op's output value for this image (the whole result blob, so
  -- the run can be reloaded into the ops cards without re-running anything)
  outputs jsonb not null default '{}'::jsonb,
  -- raw text of the final step (the best-captions JSON) and the captions pulled
  -- out of it, in order
  final_output text,
  captions jsonb,
  started_datetime_utc timestamptz not null default now(),
  finished_datetime_utc timestamptz
);

create index if not exists ops_run_images_run_idx
  on public.ops_run_images (ops_run_id, position);

create table if not exists public.ops_run_steps (
  id uuid primary key default gen_random_uuid(),
  ops_run_id uuid not null references public.ops_runs (id) on delete cascade,
  ops_run_image_id uuid not null references public.ops_run_images (id) on delete cascade,
  op_key text not null,
  op_title text,
  position int not null default 0,
  -- fan-out branch index/label; null for a single call
  branch_index int,
  branch_label text,
  humor_flavor_step_id bigint references public.humor_flavor_steps (id) on delete set null,
  step_order_by int,
  provider_model_id text,
  llm_temperature numeric,
  include_image boolean,
  -- rendered exactly as sent to the provider (variables already substituted)
  system_prompt text,
  user_prompt text,
  -- the resolved value of each input slot this op read
  prior_outputs jsonb,
  output text,
  error text,
  duration_ms int,
  created_datetime_utc timestamptz not null default now()
);

create index if not exists ops_run_steps_image_idx
  on public.ops_run_steps (ops_run_image_id, position, branch_index);

alter table public.ops_runs enable row level security;
alter table public.ops_run_images enable row level security;
alter table public.ops_run_steps enable row level security;

-- Ops runs are shared team infrastructure (pipeline experiments, not user
-- data): any signed-in user can read and write them.
drop policy if exists "ops_runs - all authenticated" on public.ops_runs;
create policy "ops_runs - all authenticated"
  on public.ops_runs for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "ops_run_images - all authenticated" on public.ops_run_images;
create policy "ops_run_images - all authenticated"
  on public.ops_run_images for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "ops_run_steps - all authenticated" on public.ops_run_steps;
create policy "ops_run_steps - all authenticated"
  on public.ops_run_steps for all
  to authenticated
  using (true)
  with check (true);
