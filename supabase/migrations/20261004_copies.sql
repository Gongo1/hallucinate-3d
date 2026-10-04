-- Hallucinate: collectible copies (phase 1).
--
-- A track in the audio catalog (records) is not a collectible. Each distinct
-- track has exactly three numbered copies across the whole game. A copy sits
-- in its crate (owner_id null) until one player claims it; then it is theirs
-- and gone from the crate for everyone. Sombra Radio never looks at any of
-- this: it plays the catalog.
--
-- Additive: one generated column on records, two new tables (RLS on, no
-- policies: only the server touches them), a minting trigger, and the claim /
-- fold functions (service_role only). Safe to re-run.

-- One canonical key per audio source, so a track filed in two crates is still
-- one track (and shares one set of three copies). SoundCloud URLs are
-- normalized: no scheme, no www./m., no query/fragment, no trailing slash.
create or replace function hallu_track_key(yt text, sc text)
returns text
language sql
immutable
as $$
  select case
    when nullif(btrim(yt), '') is not null then 'yt:' || btrim(yt)
    when nullif(btrim(sc), '') is not null then 'sc:' || lower(
      regexp_replace(
        regexp_replace(regexp_replace(btrim(sc), '^https?://(www\.|m\.)?', '', 'i'), '[?#].*$', ''),
        '/+$', ''
      )
    )
  end
$$;

alter table records add column if not exists track_key text
  generated always as (hallu_track_key(yt_id, sc_url)) stored;
create index if not exists records_track_key_idx on records (track_key);

create table if not exists hallu_copies (
  id uuid primary key default gen_random_uuid(),
  track_key text not null,
  serial smallint not null check (serial between 1 and 3),
  -- what the copy is, as of minting: a collection survives catalog edits
  title text not null default '',
  artist text not null default '',
  yt_id text,
  sc_url text,
  -- null = still in its crate. A deleted member's copies go back to the crate.
  owner_id uuid references hallu_members(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (track_key, serial)
);
create index if not exists hallu_copies_owner_idx on hallu_copies (owner_id) where owner_id is not null;
-- one copy of a track per player
create unique index if not exists hallu_copies_one_per_track_idx
  on hallu_copies (track_key, owner_id) where owner_id is not null;
alter table hallu_copies enable row level security;

-- Every change of hands, append-only. Trading / DJ phases add their own kinds.
create table if not exists hallu_copy_events (
  id bigint generated always as identity primary key,
  copy_id uuid not null references hallu_copies(id) on delete cascade,
  kind text not null check (kind in ('mint', 'claim', 'fold')),
  from_member uuid,
  to_member uuid,
  at timestamptz not null default now()
);
create index if not exists hallu_copy_events_copy_idx on hallu_copy_events (copy_id);
alter table hallu_copy_events enable row level security;

-- Mint a track's three copies (no-op for the ones that already exist).
create or replace function hallu_mint_copies(p_key text, p_title text, p_artist text, p_yt text, p_sc text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  minted int;
begin
  if p_key is null then
    return 0;
  end if;
  with ins as (
    insert into hallu_copies (track_key, serial, title, artist, yt_id, sc_url)
    select p_key, s, coalesce(p_title, ''), coalesce(p_artist, ''), p_yt, p_sc
      from generate_series(1, 3) s
    on conflict (track_key, serial) do nothing
    returning id
  )
  insert into hallu_copy_events (copy_id, kind) select id, 'mint' from ins;
  get diagnostics minted = row_count;
  return minted;
end
$$;

-- New / re-sourced records mint their track's copies. Never lets a minting
-- problem take an insert down: the copies can be backfilled later.
create or replace function hallu_records_mint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform hallu_mint_copies(new.track_key, new.title, new.artist, new.yt_id, new.sc_url);
  exception when others then
    raise warning 'hallu_records_mint: % (%)', sqlerrm, new.track_key;
  end;
  return new;
end
$$;

drop trigger if exists hallu_records_mint on records;
create trigger hallu_records_mint
  after insert or update of yt_id, sc_url on records
  for each row execute function hallu_records_mint();

-- Backfill: three copies for every track already in the catalog (the earliest
-- record of a track names it).
select hallu_mint_copies(track_key, title, artist, yt_id, sc_url)
  from (
    select distinct on (track_key) track_key, title, artist, yt_id, sc_url
      from records
     where track_key is not null
     order by track_key, created_at
  ) t;

-- Claim one specific copy for a member. Returns:
--   ok        it's yours
--   gone      someone else has it (or there's no such copy)
--   owned     you already hold a copy of this track
--   full      your collection is at p_cap
--   no_member unknown member
-- The member row lock serializes one player's claims (two tabs can't both pass
-- the capacity check); the conditional update means only one player can take
-- a copy, however many race for it.
create or replace function hallu_claim_copy(p_member uuid, p_copy uuid, p_cap int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_owner uuid;
  held int;
begin
  perform 1 from hallu_members where id = p_member for update;
  if not found then
    return 'no_member';
  end if;
  select track_key, owner_id into v_key, v_owner from hallu_copies where id = p_copy;
  if not found then
    return 'gone';
  end if;
  if v_owner = p_member
     or exists (select 1 from hallu_copies where owner_id = p_member and track_key = v_key) then
    return 'owned';
  end if;
  select count(*) into held from hallu_copies where owner_id = p_member;
  if held >= p_cap then
    return 'full';
  end if;
  update hallu_copies set owner_id = p_member, claimed_at = now()
   where id = p_copy and owner_id is null;
  if not found then
    return 'gone';
  end if;
  insert into hallu_copy_events (copy_id, kind, to_member) values (p_copy, 'claim', p_member);
  return 'ok';
exception when unique_violation then
  return 'owned';
end
$$;

-- A throwaway membership folds into another (profile sign-in, hand-off): its
-- copies move with it. A track both already hold goes back to its crate.
create or replace function hallu_fold_copies(p_from uuid, p_to uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  moved int;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return 0;
  end if;
  with back as (
    update hallu_copies c set owner_id = null, claimed_at = null
     where c.owner_id = p_from
       and exists (select 1 from hallu_copies o where o.owner_id = p_to and o.track_key = c.track_key)
    returning c.id
  )
  insert into hallu_copy_events (copy_id, kind, from_member) select id, 'fold', p_from from back;
  with mv as (
    update hallu_copies set owner_id = p_to where owner_id = p_from returning id
  )
  insert into hallu_copy_events (copy_id, kind, from_member, to_member) select id, 'fold', p_from, p_to from mv;
  get diagnostics moved = row_count;
  return moved;
end
$$;

revoke execute on function hallu_mint_copies(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function hallu_claim_copy(uuid, uuid, int) from public, anon, authenticated;
revoke execute on function hallu_fold_copies(uuid, uuid) from public, anon, authenticated;
grant execute on function hallu_mint_copies(text, text, text, text, text) to service_role;
grant execute on function hallu_claim_copy(uuid, uuid, int) to service_role;
grant execute on function hallu_fold_copies(uuid, uuid) to service_role;
