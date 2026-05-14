-- ollie · crisis_events table + RLS
-- Anonymous count-only table. No user_hash, no device_id, no content.
-- Pure population-level signal for hotline-shown metrics.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-14
-- Rollback: see 20260514_000006_crisis_events.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.crisis_events (
  id             uuid primary key default gen_random_uuid(),
  event_at       timestamptz not null,
  country        text not null,
  hotline_shown  text not null,
  app_version    text not null
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. indexes
-- ─────────────────────────────────────────────────────────────────────────

create index if not exists crisis_events_event_at_idx
  on public.crisis_events (event_at);

create index if not exists crisis_events_country_idx
  on public.crisis_events (country);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.crisis_events enable row level security;
alter table public.crisis_events force row level security;

-- No SELECT policy for end-users. Only service_role (worker) can write.
revoke all on public.crisis_events from anon, authenticated;
