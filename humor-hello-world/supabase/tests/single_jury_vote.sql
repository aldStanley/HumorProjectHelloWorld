-- All test users and votes are rolled back; no real user vote is submitted.
begin;
select set_config('single_vote.user', gen_random_uuid()::text, true);
insert into auth.users(id) values(current_setting('single_vote.user')::uuid);
select set_config('request.jwt.claim.sub', current_setting('single_vote.user'), true);
set local role authenticated;
select public.prepare_daily_jury();
do $$
declare d date := (clock_timestamp() at time zone 'America/New_York')::date; ids uuid[]; stored jsonb;
begin
  select array_agg(caption_id order by position) into ids from public.jury_entries where round_day=d;
  if cardinality(ids) <> 5 then raise exception 'FAIL needs five jury entries'; end if;
  begin
    perform public.submit_jury_ballot(d,jsonb_build_object(ids[1]::text,1,ids[2]::text,1),ids[1]);
    raise exception 'FAIL multiple votes accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.submit_jury_ballot(d,jsonb_build_object(ids[2]::text,1),ids[1]);
    raise exception 'FAIL vote and pick mismatch accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.submit_jury_ballot(d,jsonb_build_object(ids[1]::text,-1),ids[1]);
    raise exception 'FAIL negative vote accepted';
  exception when invalid_parameter_value then null; end;
  perform public.submit_jury_ballot(d,jsonb_build_object(ids[1]::text,1),ids[1]);
  select ratings into stored from public.jury_ballots where round_day=d and user_id=auth.uid();
  if stored <> jsonb_build_object(ids[1]::text,1) then raise exception 'FAIL incorrect vote stored'; end if;
  begin
    perform public.submit_jury_ballot(d,jsonb_build_object(ids[2]::text,1),ids[2]);
    raise exception 'FAIL second vote accepted';
  exception when sqlstate 'P0002' then null; end;
end $$;
reset role;
select 'PASS: one joke per vote, matching pick, positive vote, and one submission per user per day' as result;
rollback;
