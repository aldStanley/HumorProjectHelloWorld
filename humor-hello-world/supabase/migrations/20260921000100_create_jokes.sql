begin;

create table public.jokes (
  id uuid primary key default gen_random_uuid(),
  picture text not null check (length(trim(picture)) > 0),
  text text not null check (length(trim(text)) > 0)
);

comment on column public.jokes.picture is
  'URL of the joke image; the image file is stored separately.';

alter table public.jokes enable row level security;

revoke all on table public.jokes from anon, authenticated;
grant select on table public.jokes to anon, authenticated;

create policy "Anyone can read jokes"
  on public.jokes
  for select
  to anon, authenticated
  using (true);

commit;
