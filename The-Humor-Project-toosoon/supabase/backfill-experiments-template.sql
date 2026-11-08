-- Backfill: link the staging ops runs to the quick studies they became, as
-- retroactive experiments rows. Run AFTER 20260811000000_experiments.sql, in
-- the crackd STAGING SQL editor. One-time helper, not a migration.
--
-- Staging has three quick studies (fetched 2026-08-11):
--   45 | quick-31img-aug5  | 2026-08-05
--   44 | quick-8img-jul31  | 2026-07-31
--   43 | quick-8img-jul29  | 2026-07-29
-- (quick-…-sad-girl-4-26img-aug7 is on PROD — out of scope for staging v1.)

-- STEP 1 · Propose matches: same-day runs and studies whose caption counts
-- line up. Eyeball this — it's a proposal, not a verdict.
with runs as (
  select r.id as ops_run_id, r.flavor_slug, r.study_image_set_slug,
         r.image_count, r.caption_count,
         r.started_datetime_utc::date as run_date
  from public.ops_runs r
  where r.status = 'done'
),
quick_studies as (
  select s.id as study_id, s.slug,
         s.created_datetime_utc::date as study_date,
         count(scm.id) as n_captions
  from public.studies s
  left join public.study_caption_mappings scm on scm.study_id = s.id
  where s.slug like 'quick-%'
  group by s.id
)
select q.study_id, q.slug, q.n_captions,
       r.ops_run_id, r.flavor_slug, r.caption_count, r.run_date,
       (q.n_captions = r.caption_count) as counts_match
from quick_studies q
left join runs r on r.run_date = q.study_date
order by q.study_date desc, counts_match desc;

-- STEP 2 · For each pair you accept, insert one experiments row. Retro-write
-- the hypothesis honestly — what WAS being tested that day. Fill in the
-- ops_run_id from step 1; study ids are already real:

-- insert into public.experiments (hypothesis, goal_metric, ops_run_id, study_id, env, status)
-- values ('RETRO: <flavor_slug> on <set_slug> clears 50% funny',
--         '{"metric":"funny_rate","target":0.5}',
--         '<ops_run_id from step 1>', 45, 'staging', 'generated');

-- insert into public.experiments (hypothesis, goal_metric, ops_run_id, study_id, env, status)
-- values ('RETRO: …', '{"metric":"funny_rate","target":0.5}',
--         '<ops_run_id>', 44, 'staging', 'generated');

-- insert into public.experiments (hypothesis, goal_metric, ops_run_id, study_id, env, status)
-- values ('RETRO: …', '{"metric":"funny_rate","target":0.5}',
--         '<ops_run_id>', 43, 'staging', 'generated');

-- A study with no matching run (e.g. built by hand before ops_runs existed)
-- can still get a row — leave ops_run_id null; the scorecard only needs study_id.

-- STEP 3 · Read your first scorecards — these studies already have votes:
select * from public.experiment_scorecards order by experiment_id;

-- STEP 4 (optional) · Stamp the computed result back onto each experiment:
update public.experiments e
set result = jsonb_build_object(
      'funny_rate', s.funny_rate, 'up', s.up, 'down', s.down,
      'voters', s.voters, 'n_captions', s.n_captions,
      'votes_are_study_only', s.votes_are_study_only,
      'target', s.target, 'target_met', s.target_met,
      'computed_at', now()),
    status = 'rated'
from public.experiment_scorecards s
where s.experiment_id = e.id and e.status = 'generated' and s.funny_rate is not null;
