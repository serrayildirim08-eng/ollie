-- ollie · consent_audit table + RLS
-- Legal trail of consent state changes. One row per change event.
-- ip_country stored separately from user-supplied country for jurisdictional proof.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-14
-- Rollback: see 20260514_000007_consent_audit.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.consent_audit (
  id                  uuid primary key default gen_random_uuid(),
  user_hash           text not null,
  consent_necessary   bool not null,
  consent_marketing   bool not null,
  consented_at        timestamptz not null,
  event_source        text not null check (event_source in ('signup', 'settings_change', 'delete_account')),
  ip_country          text,
  user_agent          text,
  app_version         text not null
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. indexes
-- ─────────────────────────────────────────────────────────────────────────

create index if not exists consent_audit_user_hash_consented_at_idx
  on public.consent_audit (user_hash, consented_at);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.consent_audit enable row level security;
alter table public.consent_audit force row level security;

-- No SELECT policy for end-users. Only service_role (worker) can write.
revoke all on public.consent_audit from anon, authenticated;
