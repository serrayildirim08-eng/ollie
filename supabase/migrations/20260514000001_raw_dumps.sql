-- ollie · raw_dumps table + RLS
-- PII-scrubbed brain-dump text (voice / typed / paste).
-- Every brain-dump after worker-side PII scrub lands here.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-14
-- Rollback: see 20260514_000001_raw_dumps.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.raw_dumps (
  id               uuid primary key default gen_random_uuid(),
  user_hash        text not null,
  device_id        text not null,
  created_at       timestamptz not null default now(),
  event_ts         timestamptz not null,
  locale           text not null,
  country          text not null,
  modality         text not null check (modality in ('voice', 'text', 'paste')),
  scrubbed_text    text not null,
  char_count       int not null,
  routing_module   text,
  app_version      text not null
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. indexes
-- ─────────────────────────────────────────────────────────────────────────

create index if not exists raw_dumps_user_hash_created_at_idx
  on public.raw_dumps (user_hash, created_at desc);

create index if not exists raw_dumps_country_created_at_idx
  on public.raw_dumps (country, created_at);

create index if not exists raw_dumps_routing_module_idx
  on public.raw_dumps (routing_module);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.raw_dumps enable row level security;
alter table public.raw_dumps force row level security;

-- No SELECT policy for end-users. Only service_role (worker) can write.
revoke all on public.raw_dumps from anon, authenticated;
