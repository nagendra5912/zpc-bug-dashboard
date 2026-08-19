  -- Run this once in Supabase SQL Editor.

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

-- This version is intentionally open so employees can use the shared link
-- without creating accounts. Anyone who has the URL can read/write/delete.
drop policy if exists "bugs_select_public" on public.bugs;
create policy "bugs_select_public"
on public.bugs for select
to anon, authenticated
using (true);

drop policy if exists "bugs_insert_public" on public.bugs;
create policy "bugs_insert_public"
on public.bugs for insert
to anon, authenticated
with check (true);

drop policy if exists "bugs_update_public" on public.bugs;
create policy "bugs_update_public"
on public.bugs for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "bugs_delete_public" on public.bugs;
create policy "bugs_delete_public"
on public.bugs for delete
to anon, authenticated
using (true);

-- Enable live updates for the dashboard.
do $$
begin
  alter publication supabase_realtime add table public.bugs;
exception
  when duplicate_object then null;
end $$;
