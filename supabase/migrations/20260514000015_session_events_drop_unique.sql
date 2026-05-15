-- ollie · session_events — drop UNIQUE on session_id
--
-- The client tracker emits TWO rows per session, both keyed by the same
-- session_id (one with started_at filled, the other with ended_at +
-- duration_seconds + summary fields). The original migration constrained
-- session_id UNIQUE which blocks the second INSERT. Analytics coalesces
-- by session_id at read time (`ended_at IS NULL` discriminator), so we
-- intentionally allow multiple rows per session_id.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-14
-- Rollback: see 20260514000015_session_events_drop_unique.down.sql

-- Drop the implicit unique index Postgres created for the column-level
-- UNIQUE constraint. The constraint name follows the
-- `<table>_<column>_key` convention.
alter table public.session_events
  drop constraint if exists session_events_session_id_key;

-- Replace it with a non-unique index so queries that filter by
-- session_id (analytics coalescing) still hit an index.
create index if not exists session_events_session_id_idx
  on public.session_events (session_id);
