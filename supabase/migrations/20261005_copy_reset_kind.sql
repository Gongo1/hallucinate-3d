-- 20261005: let the copy event log record a "reset" (an approved owner
-- action that puts a claimed copy back in its crate). Metadata only: no rows
-- change. Safe to re-run.
set lock_timeout = '5s';

alter table hallu_copy_events drop constraint if exists hallu_copy_events_kind_check;
alter table hallu_copy_events
  add constraint hallu_copy_events_kind_check check (kind in ('mint', 'claim', 'fold', 'reset'));

reset lock_timeout;
