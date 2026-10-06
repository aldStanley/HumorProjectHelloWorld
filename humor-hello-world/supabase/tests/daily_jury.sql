-- Run after the daily-jury and co-winners migrations. Test identities, ballots, rewards, and clock
-- changes are isolated in this transaction and are all rolled back.
begin;
select set_config('jury_test.a', gen_random_uuid()::text, true);
select set_config('jury_test.b', gen_random_uuid()::text, true);
insert into auth.users(id) values(current_setting('jury_test.a')::uuid), (current_setting('jury_test.b')::uuid);
select set_config('request.jwt.claim.sub', current_setting('jury_test.a'), true);
set local role authenticated;
select public.prepare_daily_jury();
do $$
declare d date := (clock_timestamp() at time zone 'America/New_York')::date; ids uuid[]; ratings jsonb;
begin
  select array_agg(caption_id order by position) into ids from public.jury_entries where round_day = d;
  if cardinality(ids) <> 5 then raise exception 'FAIL needs five eligible images'; end if;
  select jsonb_object_agg(id::text, case when n=1 then 1 else -1 end) into ratings from unnest(ids) with ordinality t(id,n);
  begin perform public.submit_jury_ballot(d, '{}'::jsonb, ids[1]); raise exception 'FAIL incomplete ballot accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.submit_jury_ballot(d, jsonb_set(ratings,array[ids[1]::text],'"1"'::jsonb),ids[1]); raise exception 'FAIL string rating accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.submit_jury_ballot(d, ratings,gen_random_uuid()); raise exception 'FAIL outside pick accepted'; exception when invalid_parameter_value then null; end;
  perform public.submit_jury_ballot(d,ratings,ids[1]);
  begin perform public.submit_jury_ballot(d,ratings,ids[2]); raise exception 'FAIL duplicate ballot accepted'; exception when sqlstate 'P0002' then null; end;
  if exists(select 1 from public.jury_rounds where round_day=d and (results is not null or winner_id is not null)) then raise exception 'FAIL standings leaked before close'; end if;
  begin insert into public.golden_laughs(round_day,user_id,caption_id) values(d,auth.uid(),ids[1]); raise exception 'FAIL forged reward'; exception when insufficient_privilege then null; end;
  begin update public.jury_ballots set pick_id=ids[2] where round_day=d; raise exception 'FAIL edited sealed ballot'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', current_setting('jury_test.b'), true);
set local role authenticated;
do $$
declare d date := (clock_timestamp() at time zone 'America/New_York')::date; ids uuid[]; ratings jsonb;
begin
  select array_agg(caption_id order by position) into ids from public.jury_entries where round_day=d;
  select jsonb_object_agg(id::text,case when n<=2 then 1 else -1 end) into ratings from unnest(ids) with ordinality t(id,n);
  perform public.submit_jury_ballot(d,ratings,ids[2]);
  if (select count(*) from public.jury_ballots where round_day=d) <> 1 then raise exception 'FAIL another juror ballot exposed'; end if;
end $$;
reset role;
-- Preserve any real current ballots; test finalization on a separate closed day.
insert into public.jury_rounds(round_day,closes_at) values('2000-01-01','2000-01-02T05:00:00Z'),('2000-01-02','2000-01-03T05:00:00Z'),('2000-01-03','2000-01-04T05:00:00Z');
insert into public.jury_entries
 select dates.day,e.caption_id,e.position,e.caption_text,e.picture,e.private_image,e.description
 from public.jury_entries e cross join (values('2000-01-01'::date),('2000-01-02'::date),('2000-01-03'::date)) dates(day)
 where e.round_day=(clock_timestamp() at time zone 'America/New_York')::date;
insert into public.jury_ballots(round_day,user_id,ratings,pick_id)
 select '2000-01-01',user_id,ratings,pick_id from public.jury_ballots
 where round_day=(clock_timestamp() at time zone 'America/New_York')::date
 and user_id in(current_setting('jury_test.a')::uuid,current_setting('jury_test.b')::uuid);
-- All five entries in a five-way tie must win. The third fixture has zero ballots.
insert into public.jury_ballots(round_day,user_id,ratings,pick_id)
 select '2000-01-02',u.id,jsonb_object_agg(e.caption_id::text,1),(array_agg(e.caption_id order by e.position))[u.pick_position]
 from public.jury_entries e cross join (values(current_setting('jury_test.a')::uuid,1),(current_setting('jury_test.b')::uuid,2)) u(id,pick_position)
 where e.round_day='2000-01-02' group by u.id,u.pick_position;
select set_config('request.jwt.claim.sub', current_setting('jury_test.a'), true);
set local role authenticated;
do $$ begin
  begin perform public.submit_jury_ballot('2000-01-03','{}'::jsonb,gen_random_uuid()); raise exception 'FAIL late ballot accepted'; exception when sqlstate 'P0001' then null; end;
end $$;
select public.prepare_daily_jury();
select public.prepare_daily_jury();
do $$
declare expected uuid;
begin
  select caption_id into expected from public.jury_entries where round_day='2000-01-01' and position=1;
  if (select winner_id from public.jury_rounds where round_day='2000-01-01') is distinct from expected then raise exception 'FAIL wrong winner'; end if;
  if (select winner_ids from public.jury_rounds where round_day='2000-01-01') is distinct from array[expected] then raise exception 'FAIL unique winner list'; end if;
  if (select count(*) from public.golden_laughs where round_day='2000-01-01') <> 1 then raise exception 'FAIL reward missing or duplicated'; end if;
  if (select cardinality(winner_ids) from public.jury_rounds where round_day='2000-01-02') <> 5 then raise exception 'FAIL missing co-winners'; end if;
  if (select count(*) from public.golden_laughs where round_day='2000-01-02') <> 1 then raise exception 'FAIL co-winner reward missing or duplicated'; end if;
  if exists(select 1 from public.jury_rounds where round_day='2000-01-03' and (winner_id is not null or cardinality(winner_ids) <> 0 or ballot_count <> 0 or finalized_at is null)) then raise exception 'FAIL quiet day'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', current_setting('jury_test.b'), true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.golden_laughs where round_day='2000-01-02' and caption_id=(select caption_id from public.jury_entries where round_day='2000-01-02' and position=2)) <> 1 then raise exception 'FAIL second co-winner pick did not earn its own trophy'; end if;
  if exists(select 1 from public.golden_laughs where round_day='2000-01-01') then raise exception 'FAIL losing pick earned reward or private reward leaked'; end if;
end $$;
reset role;
-- Raw ballot writes, direct reward claims, and access without login stay blocked.
set local role anon;
do $$ begin
  begin perform public.prepare_daily_jury(); raise exception 'FAIL anon prepare'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.jury_ballots; raise exception 'FAIL anon ballots'; exception when insufficient_privilege then null; end;
  begin perform public.submit_jury_ballot(current_date,'{}',gen_random_uuid()); raise exception 'FAIL anon submit'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (timestamp '2026-11-02' at time zone 'America/New_York') - (timestamp '2026-11-01' at time zone 'America/New_York') <> interval '25 hours' then raise exception 'FAIL fall DST boundary'; end if;
  if (timestamp '2026-03-09' at time zone 'America/New_York') - (timestamp '2026-03-08' at time zone 'America/New_York') <> interval '23 hours' then raise exception 'FAIL spring DST boundary'; end if;
end $$;
select 'PASS: sealed ballots, ownership, hidden scores, cutoff, winner, ties, quiet days, one-time rewards, and DST' as result;
rollback;
