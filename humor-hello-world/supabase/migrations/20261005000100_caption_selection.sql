begin;
alter table public.caption_images add column suggestions text[];

create function public.save_caption_draft(target_id uuid, image_description text, alternatives text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare image public.caption_images;
begin
  select * into image from public.caption_images where id=target_id and user_id=auth.uid() for update;
  if not found or image.status <> 'processing' then raise exception 'Image unavailable'; end if;
  if image_description is null or char_length(trim(image_description)) not between 1 and 4000
    or alternatives is null or cardinality(alternatives) <> 3
    or exists(select 1 from unnest(alternatives) c where c is null or char_length(trim(c)) not between 1 and 240)
  then raise exception 'Invalid suggestions'; end if;
  update public.caption_images set description=trim(image_description), suggestions=alternatives where id=target_id;
end $$;
revoke all on function public.save_caption_draft(uuid,text,text[]) from public, anon;
grant execute on function public.save_caption_draft(uuid,text,text[]) to authenticated;

create function public.publish_selected_caption(target_id uuid, selected_text text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare image public.caption_images; joke_id uuid; previous_text text;
begin
  select * into image from public.caption_images where id=target_id and user_id=auth.uid() for update;
  if not found then raise exception 'Image unavailable'; end if;
  if selected_text is null or char_length(trim(selected_text)) not between 1 and 240 then raise exception 'Write a joke between 1 and 240 characters'; end if;
  if image.status='ready' then
    select id,text into joke_id,previous_text from public.jokes where image_id=target_id order by created_at,id limit 1;
    if previous_text=trim(selected_text) then return joke_id; end if;
    raise exception 'This photo already has a published joke';
  end if;
  if image.status <> 'processing' or image.description is null or image.suggestions is null then raise exception 'Generate suggestions first'; end if;
  if not exists(select 1 from storage.objects where bucket_id='caption-images' and name=image.storage_path) then raise exception 'Upload missing'; end if;
  insert into public.jokes(picture,text,image_id) values(image.storage_path,trim(selected_text),target_id) returning id into joke_id;
  update public.caption_images set status='ready' where id=target_id;
  return joke_id;
end $$;
revoke all on function public.publish_selected_caption(uuid,text) from public, anon;
grant execute on function public.publish_selected_caption(uuid,text) to authenticated;
-- Keep the old publication RPC during rollout so the currently deployed app still works.
commit;
