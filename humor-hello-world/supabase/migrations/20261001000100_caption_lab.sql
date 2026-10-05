begin;

-- Existing artwork remains available to signed-in members only.
drop policy if exists "Anyone can read jokes" on public.jokes;
revoke all on public.jokes from anon, authenticated;
grant select on public.jokes to authenticated;
create policy "Members read captions" on public.jokes for select to authenticated using (true);

create table public.caption_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  description text check (char_length(description) <= 4000),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);
create index caption_images_owner_created on public.caption_images(user_id, created_at);
alter table public.caption_images enable row level security;
revoke all on public.caption_images from anon, authenticated;
grant select on public.caption_images to authenticated;
create policy "Members read published images or their own" on public.caption_images
for select to authenticated using (status = 'ready' or user_id = (select auth.uid()));

alter table public.jokes add column image_id uuid references public.caption_images(id) on delete cascade;
alter table public.jokes add column created_at timestamptz not null default now();
create index jokes_created on public.jokes(created_at desc, id);
create index jokes_image on public.jokes(image_id);

create table public.caption_votes (
  caption_id uuid not null references public.jokes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (caption_id, user_id)
);
create index caption_votes_user on public.caption_votes(user_id);
alter table public.caption_votes enable row level security;
revoke all on public.caption_votes from anon, authenticated;
grant select, insert on public.caption_votes to authenticated;
grant update(value) on public.caption_votes to authenticated;
create policy "Read own votes" on public.caption_votes for select to authenticated using (user_id = (select auth.uid()));
create policy "Insert own votes" on public.caption_votes for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Change own votes" on public.caption_votes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Expose only totals, never the identities of other voters. Bounded to one page.
create function public.caption_scores(caption_ids uuid[])
returns table(caption_id uuid, score bigint, votes bigint)
language sql stable security definer set search_path = '' as $$
  select v.caption_id, sum(v.value)::bigint, count(*)
  from public.caption_votes v
  where (select auth.uid()) is not null and v.caption_id = any(caption_ids[1:60])
  group by v.caption_id;
$$;
revoke all on function public.caption_scores(uuid[]) from public, anon;
grant execute on function public.caption_scores(uuid[]) to authenticated;

-- Serialize quota checks per account, including unsuccessful attempts.
create function public.reserve_caption_image(extension text) returns public.caption_images
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); image public.caption_images; image_id uuid := gen_random_uuid();
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if extension not in ('jpg','png','webp') or extension is null then raise exception 'Invalid format'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  if (select count(*) from public.caption_images where user_id = uid and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'Daily limit reached' using errcode = 'P0001';
  end if;
  insert into public.caption_images(id, user_id, storage_path)
    values(image_id, uid, uid::text || '/' || image_id::text || '.' || extension) returning * into image;
  return image;
end;
$$;
revoke all on function public.reserve_caption_image(text) from public, anon;
grant execute on function public.reserve_caption_image(text) to authenticated;

-- Description, publication, and all three captions commit together.
create function public.publish_caption_image(target_id uuid, image_description text, captions text[])
returns void language plpgsql security definer set search_path = '' as $$
declare image public.caption_images;
begin
  select * into image from public.caption_images where id = target_id and user_id = auth.uid() for update;
  if not found or image.status <> 'processing' then raise exception 'Image unavailable'; end if;
  if image_description is null or char_length(trim(image_description)) not between 1 and 4000
    or captions is null or cardinality(captions) <> 3
    or exists(select 1 from unnest(captions) c where c is null or char_length(trim(c)) not between 1 and 240)
  then raise exception 'Invalid captions'; end if;
  if not exists(select 1 from storage.objects where bucket_id = 'caption-images' and name = image.storage_path) then
    raise exception 'Upload missing';
  end if;
  update public.caption_images set description = image_description, status = 'ready' where id = target_id;
  insert into public.jokes(picture, text, image_id) select image.storage_path, trim(c), target_id from unnest(captions) c;
end;
$$;
revoke all on function public.publish_caption_image(uuid,text,text[]) from public, anon;
grant execute on function public.publish_caption_image(uuid,text,text[]) to authenticated;

create function public.fail_caption_image(target_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.caption_images set status = 'failed'
  where id = target_id and user_id = auth.uid() and status = 'processing';
$$;
revoke all on function public.fail_caption_image(uuid) from public, anon;
grant execute on function public.fail_caption_image(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('caption-images','caption-images',false,3145728,array['image/jpeg','image/png','image/webp']);
create policy "Upload reserved photo" on storage.objects for insert to authenticated with check (
 bucket_id = 'caption-images' and (storage.foldername(name))[1] = (select auth.uid())::text
 and exists(select 1 from public.caption_images i where i.storage_path = name and i.user_id = (select auth.uid()) and i.status = 'processing')
);
create policy "Read caption photos" on storage.objects for select to authenticated using (
 bucket_id = 'caption-images' and exists(select 1 from public.caption_images i where i.storage_path = name and (i.status = 'ready' or i.user_id = (select auth.uid())))
);
create policy "Clean up unpublished photos" on storage.objects for delete to authenticated using (
 bucket_id = 'caption-images' and exists(select 1 from public.caption_images i where i.storage_path = name and i.user_id = (select auth.uid()) and i.status <> 'ready')
);

-- Profile photos only need to be visible to their owner in this app.
update storage.buckets set public = false where id = 'avatars';
drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Read own avatar" on storage.objects for select to authenticated
 using(bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Cover every application table; do not alter Supabase-managed auth/storage schemas.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname = 'public' loop
   execute format('alter table public.%I enable row level security', t.tablename);
 end loop;
end $$;
commit;
