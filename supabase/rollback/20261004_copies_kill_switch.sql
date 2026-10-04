-- EMERGENCY, 20261004_copies: record inserts are failing because of the mint
-- trigger. Instant, metadata-only, reversible; touches no rows. Inserts go
-- straight back to how they were before the migration. New tracks simply
-- don't get copies until the trigger is back on (then backfill: see below).
alter table records disable trigger hallu_records_mint;

-- To restore, once fixed:
--   alter table records enable trigger hallu_records_mint;
--   -- mint copies for any track added while it was off (idempotent):
--   select hallu_mint_copies(track_key, title, artist, yt_id, sc_url)
--     from (select distinct on (track_key) track_key, title, artist, yt_id, sc_url
--             from records where track_key is not null order by track_key, created_at) t;
