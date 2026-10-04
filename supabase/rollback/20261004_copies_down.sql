-- Full rollback of 20261004_copies: puts the schema back exactly as before.
--
-- DESTRUCTIVE for collectibles: drops every copy, claim and event. Before
-- launch that is only the minted copies (re-created by re-running the
-- migration). After launch it erases players' collections, so prefer the kill
-- switch (20261004_copies_kill_switch.sql), which keeps them. Records,
-- shelves and members are not touched: the only change to records is
-- dropping the generated track_key column.
set lock_timeout = '5s';
drop trigger if exists hallu_records_mint on records;
drop function if exists hallu_records_mint();
drop function if exists hallu_claim_copy(uuid, uuid, int);
drop function if exists hallu_fold_copies(uuid, uuid);
drop function if exists hallu_mint_copies(text, text, text, text, text);
drop table if exists hallu_copy_events;
drop table if exists hallu_copies;
drop index if exists records_track_key_idx;
alter table records drop column if exists track_key;
drop function if exists hallu_track_key(text, text);
reset lock_timeout;
