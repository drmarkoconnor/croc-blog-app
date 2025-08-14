-- Phase 4: Structured analysis for song snippets (summary, todos, songwriting suggestions)
-- Run in Supabase SQL editor. Requires Phase 1 tables already created.

-- Table to store structured analysis derived from transcripts
create table if not exists public.transcript_analyses (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.transcripts(id) on delete cascade,
  summary text,
  todos text[],
  rhymes text[],
  genres text[],
  chord_progressions text[],
  inspirations jsonb, -- array of objects: [{title, url}]
  raw jsonb, -- full JSON payload returned by the LLM
  model text,
  created_at timestamptz default now()
);

-- Helpful indexes
create index if not exists transcript_analyses_transcript_id_idx on public.transcript_analyses (transcript_id);
create index if not exists transcript_analyses_genres_gin on public.transcript_analyses using gin (genres);
create index if not exists transcript_analyses_rhymes_gin on public.transcript_analyses using gin (rhymes);
create index if not exists transcript_analyses_chords_gin on public.transcript_analyses using gin (chord_progressions);
create index if not exists transcript_analyses_inspirations_gin on public.transcript_analyses using gin ((inspirations));

-- RLS: mirror transcripts policies via ownership of underlying snippet
alter table public.transcript_analyses enable row level security;

drop policy if exists "analyses_owner_select" on public.transcript_analyses;
create policy "analyses_owner_select" on public.transcript_analyses
  for select using (
    exists (
      select 1
      from public.transcripts t
      join public.song_snippets s on s.id = t.snippet_id
      where t.id = transcript_analyses.transcript_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "analyses_owner_insert" on public.transcript_analyses;
create policy "analyses_owner_insert" on public.transcript_analyses
  for insert with check (
    exists (
      select 1
      from public.transcripts t
      join public.song_snippets s on s.id = t.snippet_id
      where t.id = transcript_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "analyses_owner_update" on public.transcript_analyses;
create policy "analyses_owner_update" on public.transcript_analyses
  for update using (
    exists (
      select 1
      from public.transcripts t
      join public.song_snippets s on s.id = t.snippet_id
      where t.id = transcript_analyses.transcript_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "analyses_owner_delete" on public.transcript_analyses;
create policy "analyses_owner_delete" on public.transcript_analyses
  for delete using (
    exists (
      select 1
      from public.transcripts t
      join public.song_snippets s on s.id = t.snippet_id
      where t.id = transcript_analyses.transcript_id and s.user_id = auth.uid()
    )
  );

-- Optional: add small audio metadata to song_snippets for display (no breaking change)
alter table public.song_snippets
  add column if not exists storage_mime text,
  add column if not exists storage_size_bytes bigint;
