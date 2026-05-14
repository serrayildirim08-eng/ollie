-- rollback for 20260514_000004_session_events.sql
drop index if exists public.session_events_modules_opened_gin_idx;
drop index if exists public.session_events_started_at_idx;
drop index if exists public.session_events_user_hash_started_at_idx;
drop table if exists public.session_events;
