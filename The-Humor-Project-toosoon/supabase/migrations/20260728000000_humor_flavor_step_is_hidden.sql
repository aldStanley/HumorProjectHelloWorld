-- Persist the ops-page "hide" toggle on the step row itself, so hidden steps
-- are shared across browsers/machines instead of living in localStorage.
-- Run this in the Supabase SQL editor (this repo has no migration runner).
alter table public.humor_flavor_steps
  add column if not exists is_hidden boolean not null default false;
