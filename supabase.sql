-- Run this once.
-- Best place: Supabase Dashboard → SQL Editor
-- (https://supabase.com/dashboard/project/wockvuodtrxslvegdzpr/sql/new)
--
-- If you run it in DBeaver / DataGrip against a normal Postgres URL,
-- the Supabase roles "anon" / "authenticated" often do not exist.
-- This script no longer requires those roles.

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
