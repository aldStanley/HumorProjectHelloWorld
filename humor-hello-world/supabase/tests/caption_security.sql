-- Run after the migration. All test writes are rolled back.
begin;
-- Reuse one real account only inside this rolled-back transaction.
select set_config('request.jwt.claim.sub', (select id::text from auth.users limit 1), true);
set local role authenticated;
do $$
declare cid uuid; reserved public.caption_images; n integer;
begin
  if auth.uid() is null then raise exception 'Sign in to the app once before running this test'; end if;
  select id into cid from public.jokes limit 1;
  if cid is null then raise exception 'Seed one caption before running this test'; end if;
  -- No persisted vote changes: everything below is transactional.
  if not exists(select 1 from public.caption_votes where caption_id = cid and user_id = auth.uid()) then
    insert into public.caption_votes(caption_id,user_id,value) values(cid,auth.uid(),1);
  end if;
  begin
    insert into public.caption_votes(caption_id,user_id,value) values(cid,auth.uid(),1);
    raise exception 'FAIL duplicate vote accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.caption_votes(caption_id,user_id,value) values(cid,gen_random_uuid(),1);
    raise exception 'FAIL spoofed voter accepted';
  exception when insufficient_privilege then null; end;
  begin
    update public.caption_votes set value = 0 where caption_id = cid and user_id = auth.uid();
    raise exception 'FAIL invalid vote accepted';
  exception when check_violation then null; end;
  update public.caption_votes set value = -1 where caption_id = cid and user_id = auth.uid();
  if not exists(select 1 from public.caption_votes where caption_id = cid and user_id = auth.uid() and value = -1) then raise exception 'FAIL vote change'; end if;
  if exists(select 1 from public.caption_votes where user_id <> auth.uid()) then raise exception 'FAIL voter identities leaked'; end if;
  if exists(select 1 from public.profiles where id <> auth.uid()) then raise exception 'FAIL profile leak'; end if;
  begin
    insert into public.caption_images(user_id,storage_path) values(auth.uid(),'bypass');
    raise exception 'FAIL quota bypass';
  exception when insufficient_privilege then null; end;
  reserved := public.reserve_caption_image('png');
  if reserved.user_id <> auth.uid() then raise exception 'FAIL reservation ownership'; end if;
  begin
    perform public.publish_caption_image(reserved.id,'A test image',array['One','Two','Three']);
    raise exception 'FAIL published without photo';
  exception when raise_exception then
    if sqlerrm <> 'Upload missing' then raise; end if;
  end;
  perform public.fail_caption_image(reserved.id);
  -- Every failed attempt still consumes quota. Stop at the configured limit.
  for n in 1..10 loop
    begin
      perform public.reserve_caption_image('jpg');
    exception when raise_exception then
      if sqlerrm <> 'Daily limit reached' then raise; end if;
    end;
  end loop;
  begin
    perform public.reserve_caption_image('jpg');
    raise exception 'FAIL quota exceeded';
  exception when raise_exception then
    if sqlerrm <> 'Daily limit reached' then raise; end if;
  end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.jokes; raise exception 'FAIL anonymous caption access'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.caption_votes; raise exception 'FAIL anonymous vote access'; exception when insufficient_privilege then null; end;
  begin perform public.reserve_caption_image('png'); raise exception 'FAIL anonymous generation'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: ownership, duplicate votes, invalid values, quota, and anonymous access' as result;
rollback;
