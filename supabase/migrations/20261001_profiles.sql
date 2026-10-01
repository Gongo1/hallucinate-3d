-- Hallucinate: profiles — a username + verified email on top of the anonymous
-- membership, so a player's save (progress + fit) follows them to a new device.
--
-- Additive, like the members migration: one new table, RLS on with NO policies,
-- so only the server (service role) touches it. Email ownership is proven by a
-- Supabase Auth email link; `auth_user` is that Auth user, set when the link is
-- opened. Safe to re-run.

create table if not exists hallu_profiles (
  member_id uuid primary key references hallu_members(id) on delete cascade,
  username text not null,
  email text not null,                 -- stored lowercased
  auth_user uuid unique,               -- the Supabase Auth user, once verified
  verified_at timestamptz,
  email_sent_at timestamptz,           -- throttles the link emails
  progress jsonb not null default '{}'::jsonb,
  fit jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- usernames are unique ignoring case (unverified claims expire in the app after a day)
create unique index if not exists hallu_profiles_username_idx on hallu_profiles (lower(username));
-- one verified profile per email; a pending one doesn't block anyone
create unique index if not exists hallu_profiles_email_verified_idx on hallu_profiles (email) where verified_at is not null;
create index if not exists hallu_profiles_email_idx on hallu_profiles (email);

alter table hallu_profiles enable row level security;
