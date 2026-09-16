-- Run this once (or re-run after updates).
-- Best place: Supabase Dashboard → SQL Editor
-- (https://supabase.com/dashboard/project/wockvuodtrxslvegdzpr/sql/new)
--
-- If you run it in DBeaver / DataGrip against a normal Postgres URL,
-- the Supabase roles "anon" / "authenticated" often do not exist.
-- This script no longer requires those roles for table policies.

create table if not exists public.bugs (
  id text primary key,
  title text not null,
  description text default '',
  module text default '',
  severity text not null default 'Medium'
    check (severity in ('Critical', 'High', 'Medium', 'Low')),
  status text not null default 'Open'
    check (status in ('Open', 'In Progress', 'Resolved', 'Closed')),
  reporter text default '',
  assignee text default '',
  screenshot_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Existing projects: add column if the table already exists without it.
alter table public.bugs
  add column if not exists screenshot_urls jsonb not null default '[]'::jsonb;

alter table public.bugs enable row level security;

-- Intentionally open: anyone with the dashboard URL can read/write/delete.
-- Policies apply to all roles (no TO anon), so they work without those roles.
drop policy if exists "bugs_select_public" on public.bugs;
create policy "bugs_select_public"
on public.bugs for select
using (true);

drop policy if exists "bugs_insert_public" on public.bugs;
create policy "bugs_insert_public"
on public.bugs for insert
with check (true);

drop policy if exists "bugs_update_public" on public.bugs;
create policy "bugs_update_public"
on public.bugs for update
using (true)
with check (true);

drop policy if exists "bugs_delete_public" on public.bugs;
create policy "bugs_delete_public"
on public.bugs for delete
using (true);

grant usage on schema public to public;
grant select, insert, update, delete on table public.bugs to public;

-- Extra grants when this is a real Supabase project (roles already exist).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant usage on schema public to anon;
    grant select, insert, update, delete on table public.bugs to anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on table public.bugs to authenticated;
  end if;
end $$;

-- Live updates (Supabase Realtime). Harmless if the publication is missing.
do $$
begin
  alter publication supabase_realtime add table public.bugs;
exception
  when undefined_object then null;
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Screenshots: use Supabase Storage (not Vercel). Free plan includes ~1 GB.
-- Bucket is public-read so <img> tags work with the anon key.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bug-screenshots',
  'bug-screenshots',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "bug_screenshots_select_public" on storage.objects;
create policy "bug_screenshots_select_public"
on storage.objects for select
using (bucket_id = 'bug-screenshots');

drop policy if exists "bug_screenshots_insert_public" on storage.objects;
create policy "bug_screenshots_insert_public"
on storage.objects for insert
with check (bucket_id = 'bug-screenshots');

drop policy if exists "bug_screenshots_update_public" on storage.objects;
create policy "bug_screenshots_update_public"
on storage.objects for update
using (bucket_id = 'bug-screenshots')
with check (bucket_id = 'bug-screenshots');

drop policy if exists "bug_screenshots_delete_public" on storage.objects;
create policy "bug_screenshots_delete_public"
on storage.objects for delete
using (bucket_id = 'bug-screenshots');
