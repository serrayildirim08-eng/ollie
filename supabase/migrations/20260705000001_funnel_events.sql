-- ollie · funnel_events table + RLS
-- Activation-funnel events (onboarding → first dump → habit loop) for
-- conversion analysis. Companion to retention_events (same write path:
-- ai-proxy /ingest-event, service-role only, user_hash server-derived).
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-07-05

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.funnel_events (
  id                    uuid primary key default gen_random_uuid(),
  user_hash             text not null,
  app                   text not null default 'ollie' check (app in ('ollie', 'roomie')),
  event_type            text not null check (event_type in ('onboarding_completed', 'first_dump', 'dump_submitted', 'route_corrected', 'notif_permission', 'account_deleted')),
  value                 text,
  minutes_since_install numeric(10,1),
  app_version           text,
  event_at              timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. indexes
-- ─────────────────────────────────────────────────────────────────────────

create index if not exists funnel_events_event_type_event_at_idx
  on public.funnel_events (event_type, event_at);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.funnel_events enable row level security;
alter table public.funnel_events force row level security;

-- No SELECT policy for end-users. Only service_role (worker) can write.
revoke all on public.funnel_events from anon, authenticated;
