begin;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text null check (first_name is null or char_length(first_name) <= 50),
  last_name text null check (last_name is null or char_length(last_name) <= 50),
  avatar_path text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select, update on table public.profiles to authenticated;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Avatar images are publicly readable"
  on storage.objects for select to public
  using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users can update their own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and owner_id = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and owner_id = (select auth.uid())::text);

create policy "Users can delete their own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and owner_id = (select auth.uid())::text);

commit;
