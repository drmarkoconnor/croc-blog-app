-- Phase 5: Songcraft core schema
-- Ensure auth extension exists in your Supabase project

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  owner_id uuid not null default auth.uid(),
  visitor_id text,
  title text not null default 'Untitled',
  key text not null default 'C',
  mode text not null default 'major',
  bpm int not null default 90,
  autoscale_name text not null default 'auto',
  body_chordpro text not null default '',
  summary jsonb
);

create table if not exists public.song_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  song_id uuid not null references public.songs(id) on delete cascade,
  label text,
  body_chordpro text not null default ''
);

create table if not exists public.audio_ideas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  song_id uuid not null references public.songs(id) on delete cascade,
  storage_path text not null,
  duration_sec int,
  note text,
  linked_line int,
  transcript text,
  waveform jsonb
);

-- Indexes
create index if not exists songs_owner_updated_idx on public.songs (owner_id, updated_at desc);
create index if not exists songs_updated_idx on public.songs (updated_at desc);
create index if not exists songs_visitor_updated_idx on public.songs (visitor_id, updated_at desc);
create index if not exists audio_ideas_song_idx on public.audio_ideas (song_id, created_at desc);

-- RLS
alter table public.songs enable row level security;
alter table public.song_versions enable row level security;
alter table public.audio_ideas enable row level security;

drop policy if exists songs_owner_rw on public.songs;
create policy songs_owner_rw on public.songs
  for all
  using (
    auth.uid() = owner_id OR (
      -- allow service role to operate with visitor_id set via function
      current_setting('request.jwt.claims', true) is not null
    )
  )
  with check (
    auth.uid() = owner_id OR (
      current_setting('request.jwt.claims', true) is not null
    )
  );

drop policy if exists song_versions_owner_rw on public.song_versions;
create policy song_versions_owner_rw on public.song_versions
  for all
  using (
    exists(select 1 from public.songs s where s.id = song_id and s.owner_id = auth.uid())
  )
  with check (
    exists(select 1 from public.songs s where s.id = song_id and s.owner_id = auth.uid())
  );

drop policy if exists audio_ideas_owner_rw on public.audio_ideas;
create policy audio_ideas_owner_rw on public.audio_ideas
  for all
  using (
    exists(select 1 from public.songs s where s.id = song_id and s.owner_id = auth.uid())
  )
  with check (
    exists(select 1 from public.songs s where s.id = song_id and s.owner_id = auth.uid())
  );

-- Storage bucket for audio ideas (name: audio_ideas)
-- Create this bucket in Supabase Storage and set RLS/storage policies accordingly.
