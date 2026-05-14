-- rollback for 20260514_000003_retention_events.sql
drop index if exists public.retention_events_event_type_event_at_idx;
drop index if exists public.retention_events_user_hash_event_at_idx;
drop table if exists public.retention_events;
