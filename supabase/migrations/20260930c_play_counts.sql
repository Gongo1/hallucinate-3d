-- Hallucinate: how many times each record has played in the room.
-- Counting starts when this ships (there's no play history before it).
-- The room's host reports each new track once; the server ignores repeat
-- reports for the same record within 3 minutes (host handoffs, re-broadcasts).
-- Safe to re-run.
alter table records add column if not exists play_count int not null default 0;
alter table records add column if not exists last_played_at timestamptz;

create or replace function hallu_note_play(rid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update records
     set play_count = play_count + 1,
         last_played_at = now()
   where id = rid
     and (last_played_at is null or last_played_at < now() - interval '3 minutes');
$$;
revoke execute on function hallu_note_play(uuid) from public, anon, authenticated;
grant execute on function hallu_note_play(uuid) to service_role;
