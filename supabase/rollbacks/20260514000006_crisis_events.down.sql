-- rollback for 20260514_000006_crisis_events.sql
drop index if exists public.crisis_events_country_idx;
drop index if exists public.crisis_events_event_at_idx;
drop table if exists public.crisis_events;
