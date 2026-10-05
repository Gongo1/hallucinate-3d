-- EMERGENCY, 20261004_copies: record inserts are failing because of the mint
-- trigger. Instant, metadata-only, reversible; touches no rows. Inserts go
-- straight back to how they were before the migration. New tracks simply
-- don't get copies until the trigger is back on (then backfill: see below).
alter table records disable trigger hallu_records_mint;

-- To restore, once fixed:
--   alter table records enable trigger hallu_records_mint;
--   -- (if the fix was shipped by re-running 20261004_copies.sql, re-run
--   --  20261004b_copies_hardening.sql after it: create-or-replace resets
--   --  hallu_track_key's pinned search_path)
--   -- mint copies for any track added while it was off (idempotent):
--   select hallu_mint_copies(track_key, title, artist, yt_id, sc_url)
--     from (select distinct on (track_key) track_key, title, artist, yt_id, sc_url
--             from records where track_key is not null order by track_key, created_at) t;
