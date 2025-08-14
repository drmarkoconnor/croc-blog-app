-- Phase 4b: Saved/discard status for song snippets
alter table public.song_snippets
  add column if not exists is_saved boolean not null default false;

-- Optional helpful index
create index if not exists song_snippets_is_saved_idx on public.song_snippets (is_saved, created_at);
