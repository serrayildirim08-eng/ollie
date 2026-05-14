-- ollie · user_consent current-state table + RLS
-- Append-only `consent_audit` table (migration 7) keeps the legal trail.
-- This table holds the CURRENT state per user — the row the orchestrator
-- reads on every research-data write to gate the pipeline.
--
-- Sprint B' (consent + pii-scrub + labeling pipeline) — 2026-05-14
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Rollback: see 20260514_000013_user_consent.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.user_consent (
  -- user_hash matches the same anonymization scheme used by raw_dumps +
  -- consent_audit. NOT a Supabase auth user_id — that lives client-side
  -- and we don't want to deanonymize.
  user_hash          text primary key,
  -- Always true in practice (app refuses to boot if false); persisted for
  -- audit symmetry with the audit table.
  consent_necessary  bool not null default true,
  -- Default false. Set true on explicit opt-in.
  consent_marketing  bool not null default false,
  -- Three-state tristate: null = never asked (legacy or pivot re-prompt),
  -- true = opted in, false = opted out. Nullability is the load-bearing
  -- piece — the orchestrator gates on `is not null and = true`.
  research_optin     bool,
  set_at             timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Last app build seen — useful for "old client never saw the new prompt"
  -- diagnostics.
  app_version        text
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. update trigger
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.user_consent_touch_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_consent_touch_updated_at on public.user_consent;
create trigger user_consent_touch_updated_at
  before update on public.user_consent
  for each row execute function public.user_consent_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. indexes
-- ─────────────────────────────────────────────────────────────────────────

-- Partial index for the hot path: "is this user opted in to research".
-- Most rows won't match (default-deny), keeping the index small.
create index if not exists user_consent_research_optin_idx
  on public.user_consent (user_hash)
  where research_optin = true;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RLS — service_role only
-- ─────────────────────────────────────────────────────────────────────────

alter table public.user_consent enable row level security;
alter table public.user_consent force row level security;

revoke all on public.user_consent from anon, authenticated;
grant insert, select, update, delete on public.user_consent to service_role;
