-- ollie · module_events table + RLS
-- Per-module open/close events. Higher cardinality than session_events.
-- US + cycle rows are dropped at worker level before reaching this table.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-14
-- Rollback: see 20260514_000005_module_events.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.module_events (
  id               uuid primary key default gen_random_uuid(),
  user_hash        text not null,
  session_id       uuid not null,
  module           text not null,
  opened_at        timestamptz not null,
  closed_at        timestamptz,
  duration_seconds int,
  actions_count    int default 0,
  country          text not null
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. indexes
-- ─────────────────────────────────────────────────────────────────────────

create index if not exists module_events_user_hash_opened_at_idx
  on public.module_events (user_hash, opened_at);

create index if not exists module_events_module_opened_at_idx
  on public.module_events (module, opened_at);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.module_events enable row level security;
alter table public.module_events force row level security;

-- No SELECT policy for end-users. Only service_role (worker) can write.
revoke all on public.module_events from anon, authenticated;
