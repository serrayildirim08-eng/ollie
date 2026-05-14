-- rollback for 20260514_000005_module_events.sql
drop index if exists public.module_events_module_opened_at_idx;
drop index if exists public.module_events_user_hash_opened_at_idx;
drop table if exists public.module_events;
