begin;
set local role anon;
do $$
begin
  perform 1 from public.jokes;
  perform 1 from public.caption_images;
  perform 1 from public.jury_rounds;
  perform 1 from public.jury_entries;
  perform public.caption_scores(array(select id from public.jokes limit 5));
  if exists(select 1 from public.caption_images where status <> 'ready') then
    raise exception 'FAIL visitors can read unpublished images';
  end if;
  begin perform suggestions from public.caption_images; raise exception 'FAIL visitors can read unchosen suggestions'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.caption_votes; raise exception 'FAIL visitors can read individual votes'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.jury_ballots; raise exception 'FAIL visitors can read ballots'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.golden_laughs; raise exception 'FAIL visitors can read trophies'; exception when insufficient_privilege then null; end;
  begin perform public.reserve_caption_image('png'); raise exception 'FAIL visitors can upload'; exception when insufficient_privilege then null; end;
end $$;
rollback;
