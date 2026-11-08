-- The experiment spine: one row per turn of the humor improvement crank
-- (hypothesis → ops run → study → votes → verdict → findings), joining the
-- generation side (ops_runs, 20260731000000) to the evaluation side
-- (studies → study_caption_mappings → captions → caption_votes).
-- Full I/O spec: see the "Experiment Loop — Complete Build Specification" page.
-- Run this in the Supabase SQL editor (this repo has no migration runner).

create table if not exists public.experiments (
  id                    uuid primary key default gen_random_uuid(),
  -- the science
  hypothesis            text not null,
  goal_metric           jsonb not null default '{"metric":"funny_rate","target":0.5}'::jsonb,
  -- the pins (ids, not copies — ops_runs.spec already snapshots the recipe)
  ops_run_id            uuid references public.ops_runs (id) on delete set null,
  study_id              bigint,   -- studies.id; no cross-env FK — ids collide across
  env                   text not null default 'staging',  -- staging | prod
  -- the outcome
  status                text not null default 'open',  -- open | generated | rated | decided | abandoned
  result                jsonb,    -- stamped from experiment_scorecards, see spec
  verdict               text,
  decided_by            uuid references public.profiles (id),
  created_datetime_utc  timestamptz not null default now(),
  decided_datetime_utc  timestamptz
);
create index if not exists experiments_run_idx   on public.experiments (ops_run_id);
create index if not exists experiments_study_idx on public.experiments (study_id);

-- Findings ledger: claims that outlive single experiments. The same claim text
-- across experiments is that claim's evidence trail — read this table before
-- writing the next hypothesis.
create table if not exists public.experiment_findings (
  id                    uuid primary key default gen_random_uuid(),
  claim                 text not null,
  experiment_id         uuid not null references public.experiments (id) on delete cascade,
  direction             text not null default 'supports',  -- supports | contradicts
  strength              text not null default 'weak',      -- weak | moderate | strong
  notes                 text,
  created_by            uuid references public.profiles (id),
  created_datetime_utc  timestamptz not null default now()
);
create index if not exists experiment_findings_claim_idx on public.experiment_findings (claim);

-- Scorecard: experiment → study → captions → votes. Vote semantics are
-- up/down (vote_value > 0 up, < 0 down, 0/null ignored). Study votes
-- (is_from_study) when any exist, else ambient site votes — the same fallback
-- rule the resource registry uses.
create or replace view public.experiment_scorecards as
with vote_tallies as (
  select e.id as experiment_id,
    count(*) filter (where cv.vote_value > 0 and cv.is_from_study)  as up_study,
    count(*) filter (where cv.vote_value < 0 and cv.is_from_study)  as down_study,
    count(*) filter (where cv.vote_value > 0)                       as up_all,
    count(*) filter (where cv.vote_value < 0)                       as down_all,
    count(distinct cv.profile_id) filter (where cv.is_from_study)   as voters_study,
    count(distinct cv.profile_id)                                   as voters_all,
    count(distinct scm.caption_id)                                  as n_captions
  from public.experiments e
  join public.study_caption_mappings scm on scm.study_id = e.study_id
  left join public.caption_votes cv on cv.caption_id = scm.caption_id
  where e.study_id is not null
  group by e.id
),
resolved as (
  select t.*,
    case when t.up_study + t.down_study > 0 then t.up_study   else t.up_all   end as up,
    case when t.up_study + t.down_study > 0 then t.down_study else t.down_all end as down,
    case when t.up_study + t.down_study > 0 then t.voters_study else t.voters_all end as voters,
    (t.up_study + t.down_study > 0) as votes_are_study_only
  from vote_tallies t
)
select e.id as experiment_id, e.hypothesis, e.goal_metric, e.status,
  r.n_captions, r.up, r.down, r.voters, r.votes_are_study_only,
  case when r.up + r.down = 0 then null
       else round(r.up::numeric / (r.up + r.down), 3) end as funny_rate,
  (e.goal_metric->>'target')::numeric as target,
  case when r.up + r.down = 0 then null
       else round(r.up::numeric / (r.up + r.down), 3)
            >= (e.goal_metric->>'target')::numeric end as target_met
from public.experiments e
join resolved r on r.experiment_id = e.id;

-- Experiments are shared team infrastructure, same policy as ops_runs.
alter table public.experiments enable row level security;
alter table public.experiment_findings enable row level security;

drop policy if exists "experiments - all authenticated" on public.experiments;
create policy "experiments - all authenticated"
  on public.experiments for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "experiment_findings - all authenticated" on public.experiment_findings;
create policy "experiment_findings - all authenticated"
  on public.experiment_findings for all
  to authenticated
  using (true)
  with check (true);
