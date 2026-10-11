begin;

alter table public.jokes add column caption_source text not null default 'unknown'
  check (caption_source in ('ai', 'human', 'unknown'));

-- Saved suggestions distinguish model output from the custom-writing option.
-- Before suggestions were saved, all photo captions were published by the AI RPC.
update public.jokes j set caption_source = case
  when i.suggestions is null or exists (
    select 1 from unnest(i.suggestions) suggestion where trim(suggestion) = j.text
  ) then 'ai' else 'human' end
from public.caption_images i where j.image_id = i.id;

-- Derive provenance in the database, including publication from older app versions.
-- The client cannot disguise a selected AI suggestion by sending a different tag.
create function public.set_caption_source() returns trigger
language plpgsql security definer set search_path = '' as $$
declare suggestions text[];
begin
  if new.image_id is not null then
    select i.suggestions into suggestions from public.caption_images i where i.id = new.image_id;
    new.caption_source := case when suggestions is null or exists (
      select 1 from unnest(suggestions) suggestion where trim(suggestion) = trim(new.text)
    ) then 'ai' else 'human' end;
  else
    new.caption_source := 'unknown';
  end if;
  return new;
end $$;
revoke all on function public.set_caption_source() from public, anon, authenticated;
create trigger jokes_caption_source before insert on public.jokes
for each row execute function public.set_caption_source();

commit;
