-- Phase 2: Calendar events for ICS feed
-- Create events table with RLS. ICS function will use service role for read-only export.

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- If ends_at is before starts_at, coerce via application-level validation.
-- Helpful index for range queries
create index if not exists events_starts_idx on public.events (starts_at);

alter table public.events enable row level security;

-- Owner-only policies (for app UI; ICS uses service role)
drop policy if exists "events_owner_select" on public.events;
create policy "events_owner_select" on public.events
  for select using (auth.uid() = user_id);

drop policy if exists "events_owner_insert" on public.events;
create policy "events_owner_insert" on public.events
  for insert with check (auth.uid() = user_id);

drop policy if exists "events_owner_update" on public.events;
create policy "events_owner_update" on public.events
  for update using (auth.uid() = user_id);

drop policy if exists "events_owner_delete" on public.events;
create policy "events_owner_delete" on public.events
  for delete using (auth.uid() = user_id);
