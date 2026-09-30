-- Hallucinate: suggested records. Visitors don't add to crates any more; they
-- drop a link in the box (or tell the master) and the owner reviews the list
-- weekly, sending the best to THIS WEEK or the Sombra Selection.
-- Server-only (RLS on, no public policies), like the membership tables.
-- Safe to re-run.
create table if not exists hallu_submissions (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  source text not null check (source in ('youtube', 'soundcloud')),
  hint text,        -- "Artist — Title" if they typed one
  note text,        -- why this one (optional)
  instagram text,   -- their handle, for a shout-out (optional)
  member_id uuid references hallu_members(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'added', 'passed')),
  shelf_slug text,  -- where it went, once added
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists hallu_submissions_status_idx on hallu_submissions (status, created_at);
alter table hallu_submissions enable row level security;
revoke all on hallu_submissions from anon, authenticated;
