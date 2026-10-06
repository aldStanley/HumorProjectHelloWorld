begin;
select set_config('selection.uid',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('selection.uid')::uuid);
select set_config('request.jwt.claim.sub',current_setting('selection.uid'),true);
set local role authenticated;
select set_config('selection.image',(public.reserve_caption_image('png')).id::text,true);
select public.save_caption_draft(current_setting('selection.image')::uuid,'A test image',array['One','Two','Three']);
do $$ begin
 if exists(select 1 from public.jokes where image_id=current_setting('selection.image')::uuid) then raise exception 'Draft published early'; end if;
end $$;
reset role;
insert into storage.objects(bucket_id,name) select 'caption-images',storage_path from public.caption_images where id=current_setting('selection.image')::uuid;
set local role authenticated;
select public.publish_selected_caption(current_setting('selection.image')::uuid,'My custom joke');
select public.publish_selected_caption(current_setting('selection.image')::uuid,'My custom joke');
do $$ begin
 if (select count(*) from public.jokes where image_id=current_setting('selection.image')::uuid) <> 1 then raise exception 'Duplicate publication'; end if;
 begin perform public.publish_selected_caption(current_setting('selection.image')::uuid,'Different joke'); raise exception 'FAIL changed selection'; exception when raise_exception then if sqlerrm='FAIL changed selection' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
do $$ begin
 begin perform public.publish_selected_caption(current_setting('selection.image')::uuid,'My custom joke'); raise exception 'FAIL ownership'; exception when raise_exception then if sqlerrm='FAIL ownership' then raise; end if; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.publish_selected_caption(current_setting('selection.image')::uuid,'My custom joke'); raise exception 'FAIL anonymous'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS draft privacy, one publication, retry idempotency, immutable choice, ownership, anonymous rejection' as result;
rollback;
