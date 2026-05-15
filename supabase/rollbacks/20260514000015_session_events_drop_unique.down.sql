-- Rollback for 20260514000015_session_events_drop_unique.sql
-- Restores the UNIQUE constraint on session_id. NOTE: will fail if any
-- session has more than one row (the expected post-migration shape).

drop index if exists public.session_events_session_id_idx;

alter table public.session_events
  add constraint session_events_session_id_key unique (session_id);
