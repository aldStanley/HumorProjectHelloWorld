-- Saved clusterings from /sidechat-topics: one row per saved run of the
-- bottom-up event clustering — the full result payload verbatim, so a saved
-- clustering reloads without re-running any LLM calls.
-- Run this in the Supabase SQL editor (this repo has no migration runner).

create table if not exists public.sidechat_clusterings (
  id uuid primary key default gen_random_uuid(),
  -- display name, generated at save time: "<run time> — <username>"
  name text not null,
  -- events | brain (only events is saved today; column future-proofs the rest)
  mode text not null default 'events',
  window_days int not null,
  window_start_utc timestamptz,
  post_count int not null default 0,
  -- { clusters: EventCluster[], oneOffs: SidechatPost[], newestPostAt }
  payload jsonb not null default '{}'::jsonb,
  profile_id uuid references public.profiles (id),
  -- denormalized so the name still renders if profiles is unreadable
  created_by_email text,
  created_datetime_utc timestamptz not null default now()
);

create index if not exists sidechat_clusterings_created_idx
  on public.sidechat_clusterings (created_datetime_utc desc);

alter table public.sidechat_clusterings enable row level security;

-- Shared team infrastructure like ops_runs: any signed-in user can read/write.
drop policy if exists "sidechat_clusterings - all authenticated" on public.sidechat_clusterings;
create policy "sidechat_clusterings - all authenticated"
  on public.sidechat_clusterings for all
  to authenticated
  using (true)
  with check (true);
