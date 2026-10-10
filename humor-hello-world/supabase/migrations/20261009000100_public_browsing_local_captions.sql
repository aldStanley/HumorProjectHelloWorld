begin;

-- Public browsing; ballot, vote, draft, profile and trophy permissions stay private.
grant select on public.jokes, public.jury_rounds, public.jury_entries to anon;
grant select (id, user_id, storage_path, description, status) on public.caption_images to anon;
create policy "Visitors read published captions" on public.jokes for select to anon using (image_id is null or exists (select 1 from public.caption_images i where i.id = image_id and i.status = 'ready'));
create policy "Visitors read published images" on public.caption_images for select to anon using (status = 'ready');
create policy "Visitors read rounds" on public.jury_rounds for select to anon using (true);
create policy "Visitors read exhibits" on public.jury_entries for select to anon using (true);
create policy "Visitors read published photos" on storage.objects for select to anon using (
  bucket_id = 'caption-images' and exists (select 1 from public.caption_images i where i.storage_path = name and i.status = 'ready')
);
create or replace function public.caption_scores(caption_ids uuid[])
returns table(caption_id uuid, score bigint, votes bigint)
language sql stable security definer set search_path = '' as $$
  select v.caption_id, sum(v.value)::bigint, count(*)
  from public.caption_votes v join public.jokes j on j.id = v.caption_id
  where v.caption_id = any(caption_ids[1:60])
    and (j.image_id is null or exists (select 1 from public.caption_images i where i.id = j.image_id and i.status = 'ready'))
  group by v.caption_id;
$$;
grant execute on function public.caption_scores(uuid[]) to anon;

-- Replace only the original assignment fixtures, including their jury snapshots.
with local_captions(picture, caption) as (values
  ('/jokes/joke-1.svg', 'My Columbia meal plan covers this banana. The emotional support is billed separately.'),
  ('/jokes/joke-2.svg', 'This coffee has attended more 8:40 lectures than I have.'),
  ('/jokes/joke-3.svg', 'My big idea at Butler: go home. Unfortunately, my bag is holding the seat hostage.'),
  ('/jokes/joke-4.svg', 'The 1 train and my group project have the same ETA: eventually.'),
  ('/jokes/joke-5.svg', 'At Butler, an empty chair is just a backpack taking a gap semester.'),
  ('/jokes/joke-6.svg', 'Opened my laptop to study. Twenty minutes later, I had ranked every bagel near campus.')
), updated as (
  update public.jokes j set text = c.caption from local_captions c
  where j.picture = c.picture and j.image_id is null returning j.id, j.text
)
update public.jury_entries e set caption_text = u.text from updated u where e.caption_id = u.id;

commit;
