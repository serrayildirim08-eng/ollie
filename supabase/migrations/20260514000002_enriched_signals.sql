-- ollie · enriched_signals table + RLS
-- Anthropic-tagged signals derived from raw_dumps. Primary B2B revenue table.
-- One row per raw_dumps row; FK cascades on raw_dumps delete.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-14
-- Rollback: see 20260514_000002_enriched_signals.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.enriched_signals (
  id                    uuid primary key default gen_random_uuid(),
  dump_id               uuid not null references public.raw_dumps(id) on delete cascade,
  user_hash             text not null,
  created_at            timestamptz not null default now(),
  sectors               text[] not null,
  brands                text[],
  topic                 text,
  sentiment             text check (sentiment in ('joyful', 'calm', 'neutral', 'frustrated', 'anxious', 'sad', 'angry', 'overwhelmed')),
  intent                text check (intent in ('cancel', 'remind', 'vent', 'plan', 'purchase', 'research', 'log', 'seek_help')),
  urgency               text check (urgency in ('low', 'medium', 'high')),
  demographic_hints     jsonb,
  enrichment_model      text not null,
  enrichment_cost_usd   numeric(10,6) not null,
  enrichment_latency_ms int
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. indexes
-- ─────────────────────────────────────────────────────────────────────────

create index if not exists enriched_signals_user_hash_created_at_idx
  on public.enriched_signals (user_hash, created_at);

create index if not exists enriched_signals_sectors_gin_idx
  on public.enriched_signals using gin (sectors);

create index if not exists enriched_signals_brands_gin_idx
  on public.enriched_signals using gin (brands);

create index if not exists enriched_signals_topic_idx
  on public.enriched_signals (topic);

create index if not exists enriched_signals_sentiment_created_at_idx
  on public.enriched_signals (sentiment, created_at);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.enriched_signals enable row level security;
alter table public.enriched_signals force row level security;

-- No SELECT policy for end-users. Only service_role (worker) can write.
revoke all on public.enriched_signals from anon, authenticated;
