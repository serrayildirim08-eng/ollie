-- ollie · retention_events table + RLS
-- D1/D7/D30 return events and session-started markers for cohort analysis.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-14
-- Rollback: see 20260514_000003_retention_events.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.retention_events (
  id                  uuid primary key default gen_random_uuid(),
  user_hash           text not null,
  event_type          text not null check (event_type in ('installed', 'session_started', 'd1_returned', 'd7_returned', 'd30_returned')),
  event_at            timestamptz not null,
  session_count       int,
  hours_since_install numeric(10,2),
  country             text not null,
  locale              text not null,
  device_id           text not null,
  app_version         text not null
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. indexes
-- ─────────────────────────────────────────────────────────────────────────

create index if not exists retention_events_user_hash_event_at_idx
  on public.retention_events (user_hash, event_at);

create index if not exists retention_events_event_type_event_at_idx
  on public.retention_events (event_type, event_at);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.retention_events enable row level security;
alter table public.retention_events force row level security;

-- No SELECT policy for end-users. Only service_role (worker) can write.
revoke all on public.retention_events from anon, authenticated;
