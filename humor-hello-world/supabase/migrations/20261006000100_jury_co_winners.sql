begin;

-- Preserve winner_id for compatibility while recording every top-scoring entry.
alter table public.jury_rounds add column winner_ids uuid[] not null default '{}';

-- Apply the co-winner rule to completed rounds, including yesterday's tie.
update public.jury_rounds r set winner_ids = coalesce((
  select array_agg((x ->> 'caption_id')::uuid order by (x ->> 'position')::integer)
  from jsonb_array_elements(r.results) x
  where (x ->> 'score')::integer = (
    select max((t ->> 'score')::integer) from jsonb_array_elements(r.results) t
  )
), '{}'::uuid[]) where r.finalized_at is not null and r.ballot_count > 0;

-- Each predictor earns at most one trophy per round, for their own winning pick.
insert into public.golden_laughs(round_day, user_id, caption_id)
select b.round_day, b.user_id, b.pick_id
from public.jury_ballots b join public.jury_rounds r using(round_day)
where r.finalized_at is not null and b.pick_id = any(r.winner_ids)
on conflict (round_day, user_id) do nothing;

create or replace function public.prepare_daily_jury() returns date
language plpgsql security definer set search_path = '' as $$
declare today date; previous public.jury_rounds; tallies jsonb; winner uuid; voters integer; chosen uuid[]; winners uuid[];
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('daily-comedy-jury', 0));
  today := (clock_timestamp() at time zone 'America/New_York')::date;
  for previous in select * from public.jury_rounds
    where closes_at <= clock_timestamp() and finalized_at is null order by round_day for update
  loop
    select count(*) into voters from public.jury_ballots where round_day = previous.round_day;
    if voters > 0 then
      select jsonb_agg(to_jsonb(t) order by t.position) into tallies from (
        select e.caption_id, e.position,
          sum((b.ratings ->> e.caption_id::text)::integer) as score,
          count(*) filter (where b.ratings ->> e.caption_id::text = '1') as funny_votes,
          count(*) filter (where b.pick_id = e.caption_id) as picks
        from public.jury_entries e join public.jury_ballots b on b.round_day = e.round_day
        where e.round_day = previous.round_day group by e.caption_id, e.position
      ) t;
      select array_agg((x ->> 'caption_id')::uuid order by (x ->> 'position')::integer)
        into winners from jsonb_array_elements(tallies) x
        where (x ->> 'score')::integer = (
          select max((r ->> 'score')::integer) from jsonb_array_elements(tallies) r
        );
      -- Keep the first ID for older clients; winner_ids contains every co-winner.
      winner := winners[1];
      update public.jury_rounds set finalized_at = clock_timestamp(), winner_id = winner,
        winner_ids = winners, ballot_count = voters, results = tallies where round_day = previous.round_day;
      insert into public.golden_laughs(round_day, user_id, caption_id)
        select round_day, user_id, pick_id from public.jury_ballots
        where round_day = previous.round_day and pick_id = any(winners)
        on conflict (round_day, user_id) do nothing;
    else
      update public.jury_rounds set finalized_at = clock_timestamp(), results = '[]'::jsonb
        where round_day = previous.round_day;
    end if;
  end loop;

  if not exists(select 1 from public.jury_rounds where round_day = today) then
    -- Prefer never/recently-unseen captions and use at most one caption per image.
    select array_agg(id order by last_seen nulls first, shuffle) into chosen from (
      select distinct on (coalesce(j.image_id, j.id)) j.id,
        (select max(e.round_day) from public.jury_entries e where e.caption_id = j.id) as last_seen,
        md5(today::text || j.id::text) as shuffle
      from public.jokes j left join public.caption_images i on i.id = j.image_id
      where j.image_id is null or i.status = 'ready'
      order by coalesce(j.image_id, j.id), last_seen nulls first, shuffle
    ) candidates;
    chosen := chosen[1:5];
    if cardinality(chosen) = 5 then
      insert into public.jury_rounds(round_day, closes_at)
        values(today, (today + 1)::timestamp at time zone 'America/New_York');
      insert into public.jury_entries(round_day, caption_id, position, caption_text, picture, private_image, description)
        select today, j.id, c.ordinality::smallint, j.text, j.picture, j.image_id is not null,
          coalesce(i.description, 'Illustration from the original joke collection')
        from unnest(chosen) with ordinality c(id, ordinality)
        join public.jokes j on j.id = c.id left join public.caption_images i on i.id = j.image_id;
    end if;
  end if;
  return today;
end;
$$;

commit;
