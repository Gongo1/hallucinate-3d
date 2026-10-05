-- Hallucinate: tighten two things Supabase's security advisor flagged after
-- 20261004_copies. Neither was exploitable; both should be closed. Safe to re-run.
--
-- 1. hallu_records_mint() kept the default EXECUTE grant to anon/authenticated
--    (/rest/v1/rpc/hallu_records_mint). Postgres refuses to run a trigger
--    function outside a trigger, but it shouldn't be reachable at all.
revoke execute on function hallu_records_mint() from public, anon, authenticated;

-- 2. hallu_track_key had a role-mutable search_path. It only uses built-ins
--    (pg_catalog is always searched first), so pin it to nothing else.
alter function hallu_track_key(text, text) set search_path = pg_catalog;
