-- Phase 3: Links (large responsive cards)
create extension if not exists pgcrypto;

create table if not exists public.links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  url text not null,
  title text,
  favicon_url text,
  created_at timestamptz default now()
);

create index if not exists links_created_idx on public.links (created_at desc);

alter table public.links enable row level security;

-- Owner-only policies for future Auth; service role bypasses these for API
drop policy if exists "links_owner_select" on public.links;
create policy "links_owner_select" on public.links
  for select using (auth.uid() = user_id);

drop policy if exists "links_owner_insert" on public.links;
create policy "links_owner_insert" on public.links
  for insert with check (auth.uid() = user_id);

drop policy if exists "links_owner_delete" on public.links;
create policy "links_owner_delete" on public.links
  for delete using (auth.uid() = user_id);
