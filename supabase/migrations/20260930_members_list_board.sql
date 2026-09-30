-- Hallucinate: members, keys, the Sombra list, and the weekly board.
-- Spec: KB/Sombra/outputs/html/2026-09-29-hallucinate-next-phase.html
--
-- Additive to the shared Sombra Supabase project: new tables only, Sombra's own
-- tables are untouched. RLS is ON with NO anon/authenticated policies, so the
-- public (anon) key can neither read nor write any of this. Only the server
-- (SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS) touches these tables.
-- Safe to re-run.

-- ---------------------------------------------------------------- members
-- Anonymous membership: a number, handed out in order on the first knock.
-- #001 (Gongo) and #002 (Elixir Pau) are reserved rows; strangers start at #003.
create sequence if not exists hallu_member_number_seq start 3;

create table if not exists hallu_members (
  id uuid primary key default gen_random_uuid(),
  number int not null unique default nextval('hallu_member_number_seq'),
  invited_by uuid references hallu_members(id),
  keys_earned int not null default 0, -- +1 per ON AIR set attended
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter sequence hallu_member_number_seq owned by hallu_members.number;

insert into hallu_members (number) values (1), (2) on conflict (number) do nothing;

-- ---------------------------------------------------------------- keys
-- A key is a personal invite link: /k/<code>. Redeeming it makes a new member
-- (invited_by = owner). An owner-made key with claims_member set instead hands
-- that EXISTING membership to the device that opens it (how #002 reaches Paula).
create table if not exists hallu_keys (
  code text primary key,
  owner_id uuid references hallu_members(id) on delete cascade,
  claims_member uuid references hallu_members(id) on delete cascade,
  redeemed_by uuid references hallu_members(id),
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hallu_keys_owner_idx on hallu_keys (owner_id);

-- ---------------------------------------------------------------- the list
-- "Stay close to the room." Sombra's own list (exported to Substack for sending).
create table if not exists sombra_list (
  id uuid primary key default gen_random_uuid(),
  email text not null unique, -- stored lowercased
  member_id uuid references hallu_members(id) on delete set null,
  source text not null default 'hallucinate',
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- the board
-- Scored actions, one row per (member, kind, thing, drop-week): digging the same
-- record twice in a week scores once. `week` = lib/bar/week.ts weekKey().
create table if not exists hallu_events (
  id bigint generated always as identity primary key,
  member_id uuid not null references hallu_members(id) on delete cascade,
  kind text not null check (kind in ('dig', 'keep', 'gift', 'secret', 'badge', 'set')),
  ref text not null,
  week int not null,
  points int not null,
  created_at timestamptz not null default now(),
  unique (member_id, kind, ref, week)
);
create index if not exists hallu_events_week_idx on hallu_events (week);

-- The week's leaders: digs, trinkets (gifts) and total score per member number.
create or replace function hallu_board(w int)
returns table (number int, digs bigint, trinkets bigint, score bigint)
language sql stable as $$
  select m.number,
         count(*) filter (where e.kind = 'dig'),
         count(*) filter (where e.kind = 'gift'),
         sum(e.points)
  from hallu_events e
  join hallu_members m on m.id = e.member_id
  where e.week = w
  group by m.number
  order by 4 desc, 2 desc
  limit 20;
$$;

-- ---------------------------------------------------------------- lock it down
alter table hallu_members enable row level security;
alter table hallu_keys enable row level security;
alter table sombra_list enable row level security;
alter table hallu_events enable row level security;
revoke all on hallu_members, hallu_keys, sombra_list, hallu_events from anon, authenticated;
revoke execute on function hallu_board(int) from public, anon, authenticated;
grant execute on function hallu_board(int) to service_role;
