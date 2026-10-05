begin;

create table public.jury_rounds (
  round_day date primary key,
  closes_at timestamptz not null,
  finalized_at timestamptz,
  winner_id uuid,
  ballot_count integer not null default 0 check (ballot_count >= 0),
  results jsonb,
  check (finalized_at is not null or (winner_id is null and results is null and ballot_count = 0))
);

-- A durable snapshot keeps each day's exhibits and trophies intact as the feed changes.
create table public.jury_entries (
  round_day date not null references public.jury_rounds(round_day),
  caption_id uuid not null,
  position smallint not null check (position between 1 and 5),
  caption_text text not null,
  picture text not null,
  private_image boolean not null,
  description text not null,
  primary key (round_day, caption_id),
  unique(round_day, position)
);
alter table public.jury_rounds add foreign key (round_day, winner_id)
  references public.jury_entries(round_day, caption_id);
create index jury_entries_history on public.jury_entries(caption_id, round_day desc);

create table public.jury_ballots (
  round_day date not null references public.jury_rounds(round_day),
  user_id uuid not null references auth.users(id) on delete cascade,
  ratings jsonb not null check (jsonb_typeof(ratings) = 'object'),
  pick_id uuid not null,
  submitted_at timestamptz not null default clock_timestamp(),
  primary key (round_day, user_id),
  foreign key (round_day, pick_id) references public.jury_entries(round_day, caption_id)
);
create index jury_ballots_owner on public.jury_ballots(user_id, round_day desc);

create table public.golden_laughs (
  round_day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  caption_id uuid not null,
  awarded_at timestamptz not null default clock_timestamp(),
  primary key (round_day, user_id),
  foreign key (round_day, caption_id) references public.jury_entries(round_day, caption_id)
);
create index golden_laughs_owner on public.golden_laughs(user_id, round_day desc);

alter table public.jury_rounds enable row level security;
alter table public.jury_entries enable row level security;
alter table public.jury_ballots enable row level security;
alter table public.golden_laughs enable row level security;
revoke all on public.jury_rounds, public.jury_entries, public.jury_ballots, public.golden_laughs from public, anon, authenticated;
grant select on public.jury_rounds, public.jury_entries, public.jury_ballots, public.golden_laughs to authenticated;
create policy "Members read daily rounds" on public.jury_rounds for select to authenticated using(true);
create policy "Members read daily exhibits" on public.jury_entries for select to authenticated using(true);
create policy "Jurors read own sealed ballot" on public.jury_ballots for select to authenticated using(user_id = (select auth.uid()));
create policy "Jurors read own trophies" on public.golden_laughs for select to authenticated using(user_id = (select auth.uid()));

-- One preparation lock ensures simultaneous first visitors see the same exhibits.
-- Finalization is lazy, but the database clock seals voting exactly at midnight ET.
-- No cron, browser clock, service-role key, or client-triggered reward claim is needed.
create function public.prepare_daily_jury() returns date
language plpgsql security definer set search_path = '' as $$
declare today date; previous public.jury_rounds; tallies jsonb; winner uuid; voters integer; chosen uuid[];
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
      -- Tied scores go to the earlier exhibit number, a rule visible before voting.
      select (x ->> 'caption_id')::uuid into winner from jsonb_array_elements(tallies) x
        order by (x ->> 'score')::integer desc, (x ->> 'position')::integer limit 1;
      update public.jury_rounds set finalized_at = clock_timestamp(), winner_id = winner,
        ballot_count = voters, results = tallies where round_day = previous.round_day;
      insert into public.golden_laughs(round_day, user_id, caption_id)
        select round_day, user_id, winner from public.jury_ballots
        where round_day = previous.round_day and pick_id = winner
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
revoke all on function public.prepare_daily_jury() from public, anon;
grant execute on function public.prepare_daily_jury() to authenticated;

create function public.submit_jury_ballot(target_day date, new_ratings jsonb, winner_pick uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare current_round public.jury_rounds; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  -- Same row lock as finalization: a late ballot cannot slip into a settled round.
  select * into current_round from public.jury_rounds where round_day = target_day for update;
  if not found or current_round.finalized_at is not null or current_round.closes_at <= clock_timestamp()
    or target_day <> (clock_timestamp() at time zone 'America/New_York')::date
  then raise exception 'This round has closed. Refresh for today''s jury.' using errcode = 'P0001'; end if;
  if exists(select 1 from public.jury_ballots where round_day = target_day and user_id = uid) then
    raise exception 'Your verdict is already sealed.' using errcode = 'P0002';
  end if;
  if new_ratings is null or jsonb_typeof(new_ratings) <> 'object' then
    raise exception 'Rate all five captions and choose a winner.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(new_ratings)) <> 5
    or exists(select 1 from jsonb_each(new_ratings) r where r.value not in ('1'::jsonb, '-1'::jsonb))
    or (select count(*) from public.jury_entries where round_day = target_day) <> 5
    or exists(select 1 from public.jury_entries e where e.round_day = target_day and not new_ratings ? e.caption_id::text)
    or winner_pick is null or not exists(select 1 from public.jury_entries where round_day = target_day and caption_id = winner_pick)
  then raise exception 'Rate all five captions and choose a winner.' using errcode = '22023'; end if;
  insert into public.jury_ballots(round_day, user_id, ratings, pick_id) values(target_day, uid, new_ratings, winner_pick);
end;
$$;
revoke all on function public.submit_jury_ballot(date,jsonb,uuid) from public, anon;
grant execute on function public.submit_jury_ballot(date,jsonb,uuid) to authenticated;

commit;
