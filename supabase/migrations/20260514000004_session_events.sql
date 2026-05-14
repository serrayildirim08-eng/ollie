-- ollie · session_events table + RLS
-- One row per user session; updated on close with duration + summary fields.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-14
-- Rollback: see 20260514_000004_session_events.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.session_events (
  id                 uuid primary key default gen_random_uuid(),
  user_hash          text not null,
  session_id         uuid not null unique,
  started_at         timestamptz not null,
  ended_at           timestamptz,
  duration_seconds   int,
  modules_opened     text[],
  voice_used         bool default false,
  text_used          bool default false,
  brain_dumps_count  int default 0,
  country            text not null,
  device_id          text not null,
  app_version        text not null
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. indexes
-- ─────────────────────────────────────────────────────────────────────────

create index if not exists session_events_user_hash_started_at_idx
  on public.session_events (user_hash, started_at);

create index if not exists session_events_started_at_idx
  on public.session_events (started_at);

create index if not exists session_events_modules_opened_gin_idx
  on public.session_events using gin (modules_opened);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.session_events enable row level security;
alter table public.session_events force row level security;

-- No SELECT policy for end-users. Only service_role (worker) can write.
revoke all on public.session_events from anon, authenticated;
