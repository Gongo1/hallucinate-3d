-- 2026-10-05 (owner-approved): house records (the Gongo crate + the Sombra
-- Selection, HOUSE_CRATES in lib/collection/rules.ts) are never owned. Copies
-- of them claimed before the rule shipped go back to their crate. History is
-- kept: each release is logged as a 'reset' event naming who held it.
-- Needs 20261005_copy_reset_kind.sql first. Safe to re-run (it only touches
-- house copies someone still holds).

-- 1. LOOK FIRST (read-only): who holds house copies right now
--   select m.number as member, c.serial, c.artist, c.title, c.claimed_at
--     from hallu_copies c
--     join hallu_members m on m.id = c.owner_id
--    where exists (select 1 from records r join shelves s on s.id = r.shelf_id
--                   where r.track_key = c.track_key and s.slug in ('gongo', 'sombra-selection'))
--    order by c.claimed_at;

-- 2. RELEASE
begin;
with target as (
  select c.id, c.owner_id
    from hallu_copies c
   where c.owner_id is not null
     and exists (select 1 from records r join shelves s on s.id = r.shelf_id
                  where r.track_key = c.track_key and s.slug in ('gongo', 'sombra-selection'))
   for update
), back as (
  update hallu_copies c
     set owner_id = null, claimed_at = null
    from target t
   where c.id = t.id
  returning c.id, t.owner_id as from_member
)
insert into hallu_copy_events (copy_id, kind, from_member)
select id, 'reset', from_member from back;
commit;
