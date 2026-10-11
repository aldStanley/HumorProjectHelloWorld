-- Run after 20261010000300_caption_source.sql. All test data rolls back.
begin;
select set_config('source.uid', gen_random_uuid()::text, true);
insert into auth.users(id) values(current_setting('source.uid')::uuid);
select set_config('request.jwt.claim.sub', current_setting('source.uid'), true);
set local role authenticated;
select set_config('source.ai', (public.reserve_caption_image('png')).id::text, true);
select set_config('source.human', (public.reserve_caption_image('png')).id::text, true);
select set_config('source.legacy', (public.reserve_caption_image('png')).id::text, true);
select public.save_caption_draft(current_setting('source.ai')::uuid, 'Test photo', array['One','Two','Three']);
select public.save_caption_draft(current_setting('source.human')::uuid, 'Test photo', array['One','Two','Three']);
reset role;
insert into storage.objects(bucket_id,name) select 'caption-images',storage_path from public.caption_images
where id in (current_setting('source.ai')::uuid,current_setting('source.human')::uuid,current_setting('source.legacy')::uuid);
set local role authenticated;
select public.publish_selected_caption(current_setting('source.ai')::uuid, ' Two ');
select public.publish_selected_caption(current_setting('source.ai')::uuid, 'Two');
select public.publish_selected_caption(current_setting('source.human')::uuid, 'My own punchline');
select public.publish_caption_image(current_setting('source.legacy')::uuid, 'Legacy photo', array['Old one','Old two','Old three']);
do $$ begin
  if (select caption_source from public.jokes where image_id=current_setting('source.ai')::uuid) <> 'ai' then raise exception 'AI suggestion mislabeled'; end if;
  if (select caption_source from public.jokes where image_id=current_setting('source.human')::uuid) <> 'human' then raise exception 'Custom joke mislabeled'; end if;
  if exists(select 1 from public.jokes where image_id=current_setting('source.legacy')::uuid and caption_source <> 'ai') then raise exception 'Legacy generated jokes mislabeled'; end if;
  if (select count(*) from public.jokes where image_id=current_setting('source.ai')::uuid) <> 1 then raise exception 'Retry duplicated joke'; end if;
end $$;
reset role;
-- Untracked imported jokes are not asserted to be human-written.
do $$ declare source text; begin
  insert into public.jokes(picture,text,caption_source) values('/test.svg','Unknown source','human') returning caption_source into source;
  if source <> 'unknown' then raise exception 'Unknown provenance mislabeled'; end if;
end $$;
select 'PASS: AI suggestions, custom writing, legacy AI publication, retries, and unknown provenance' as result;
rollback;
