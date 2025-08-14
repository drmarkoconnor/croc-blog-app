-- Phase 1: Storage and basic tables for song snippets and transcripts
-- Run in Supabase SQL editor. RLS will be enabled; policies follow.

-- Extensions
create extension if not exists pgcrypto;

-- Buckets
insert into storage.buckets (id, name, public) values ('snippets', 'snippets', false)
  on conflict (id) do nothing;

-- Audio snippets table
create table if not exists public.song_snippets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  title text,
  notes text,
  storage_path text not null, -- e.g., snippets/{user_id}/{id}.m4a
  duration_seconds numeric,
  created_at timestamptz default now()
);

-- Transcripts table
create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  snippet_id uuid references public.song_snippets(id) on delete cascade,
  text text,
  language text,
  model text,
  confidence numeric,
  created_at timestamptz default now()
);

-- RLS
alter table public.song_snippets enable row level security;
alter table public.transcripts enable row level security;

-- Policies: owners can CRUD their rows
create policy if not exists "song_snippets_owner_select" on public.song_snippets
  for select using (auth.uid() = user_id);
create policy if not exists "song_snippets_owner_insert" on public.song_snippets
  for insert with check (auth.uid() = user_id);
create policy if not exists "song_snippets_owner_update" on public.song_snippets
  for update using (auth.uid() = user_id);
create policy if not exists "song_snippets_owner_delete" on public.song_snippets
  for delete using (auth.uid() = user_id);

create policy if not exists "transcripts_owner_select" on public.transcripts
  for select using (exists (
    select 1 from public.song_snippets s where s.id = transcripts.snippet_id and s.user_id = auth.uid()
  ));
create policy if not exists "transcripts_owner_insert" on public.transcripts
  for insert with check (exists (
    select 1 from public.song_snippets s where s.id = snippet_id and s.user_id = auth.uid()
  ));
create policy if not exists "transcripts_owner_update" on public.transcripts
  for update using (exists (
    select 1 from public.song_snippets s where s.id = snippet_id and s.user_id = auth.uid()
  ));
create policy if not exists "transcripts_owner_delete" on public.transcripts
  for delete using (exists (
    select 1 from public.song_snippets s where s.id = snippet_id and s.user_id = auth.uid()
  ));

-- Helper index
create index if not exists transcripts_snippet_id_idx on public.transcripts (snippet_id);

-- Storage RLS policies for 'snippets' bucket
-- Folder convention: {user_id}/<filename>
-- Select: owner can read their own files
create policy if not exists "snippets_select_own" on storage.objects
  for select using (
    bucket_id = 'snippets' and (
      auth.role() = 'service_role' or name like (auth.uid()::text || '/%')
    )
  );

-- Insert: only into own folder
create policy if not exists "snippets_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'snippets' and name like (auth.uid()::text || '/%')
  );

-- Update/Delete: only own files
create policy if not exists "snippets_update_own" on storage.objects
  for update using (
    bucket_id = 'snippets' and name like (auth.uid()::text || '/%')
  );
create policy if not exists "snippets_delete_own" on storage.objects
  for delete using (
    bucket_id = 'snippets' and name like (auth.uid()::text || '/%')
  );
