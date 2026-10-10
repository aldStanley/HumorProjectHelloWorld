-- All fixture edits, including replacement of today's round, are rolled back.
begin;
select set_config('repeated_photo.user', gen_random_uuid()::text, true);
select set_config('repeated_photo.image', gen_random_uuid()::text, true);
insert into auth.users(id) values(current_setting('repeated_photo.user')::uuid);
insert into public.caption_images(id, user_id, storage_path, status)
values(current_setting('repeated_photo.image')::uuid, current_setting('repeated_photo.user')::uuid, 'repeated-photo-test.jpg', 'ready');
-- All eligible captions use the same image, so the old filter cannot open a round.
update public.jokes set image_id = current_setting('repeated_photo.image')::uuid;
insert into public.jokes(picture, text, image_id)
select 'repeated-photo-test.jpg', 'Columbia test caption ' || n, current_setting('repeated_photo.image')::uuid
from generate_series(1,5) n;
delete from public.golden_laughs where round_day = (clock_timestamp() at time zone 'America/New_York')::date;
delete from public.jury_ballots where round_day = (clock_timestamp() at time zone 'America/New_York')::date;
update public.jury_rounds set winner_id = null where round_day = (clock_timestamp() at time zone 'America/New_York')::date;
delete from public.jury_entries where round_day = (clock_timestamp() at time zone 'America/New_York')::date;
delete from public.jury_rounds where round_day = (clock_timestamp() at time zone 'America/New_York')::date;
select set_config('request.jwt.claim.sub', current_setting('repeated_photo.user'), true);
set local role authenticated;
select public.prepare_daily_jury();
do $$
declare today date := (clock_timestamp() at time zone 'America/New_York')::date;
begin
  if (select count(*) from public.jury_entries where round_day = today) <> 5 then
    raise exception 'FAIL: repeated photos prevented a five-caption round';
  end if;
  if (select count(distinct j.image_id) from public.jury_entries e join public.jokes j on j.id = e.caption_id where e.round_day = today) <> 1 then
    raise exception 'FAIL: expected all five captions to share a photo';
  end if;
end $$;
reset role;
rollback;
select 'PASS: five captions sharing one photo can open a jury round' as result;
