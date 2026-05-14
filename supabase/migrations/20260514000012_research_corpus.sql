-- ollie · research_corpus table + RLS
-- Anonymized opt-in corpus: scrubbed text + Anthropic-labeled JSON.
-- NO user_id, NO device_id — the row is fully anonymized at write time.
-- Designed B2B-portal-aware: sortable by sector, exportable to CSV.
--
-- Sprint B' (consent + pii-scrub + labeling pipeline) — 2026-05-14
-- Pivot context: original server-blind default abandoned; opt-in anonymized
-- data collection is the new posture. See `project_ollie_b2b_pivot.md`.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Rollback: see 20260514_000012_research_corpus.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.research_corpus (
  -- Surrogate key — UUID generated worker-side so we can return it in the
  -- /label response without a round-trip.
  corpus_id        uuid primary key,
  scrubbed_text    text not null,
  -- Free-form JSON keyed to the v1 label schema:
  --   mood_signal, content_type, urgency_tier, adhd_pattern_tag,
  --   sector_relevance, confidence.
  label_json       jsonb not null,
  -- Locked enum — see @ollie/research-cache SECTORS constant.
  sector           text not null check (sector in (
    'tech','law','med','fin','edu','creative',
    'parenting','hospitality','gov','other'
  )),
  locale           text not null,
  prompt_version   int not null default 1,
  created_at       timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. indexes — B2B portal queries
-- ─────────────────────────────────────────────────────────────────────────

-- Most-common access path: "show me the last N rows in sector X".
create index if not exists research_corpus_sector_created_at_idx
  on public.research_corpus (sector, created_at desc);

-- Range queries by date (used by getCorpusSnapshot date-range pulls).
create index if not exists research_corpus_created_at_idx
  on public.research_corpus (created_at);

-- Pattern aggregation: group by adhd_pattern_tag within a sector.
-- GIN on label_json for ad-hoc B2B queries; cheap since corpus stays small
-- in v0 (few k rows / week ceiling at full beta opt-in rate).
create index if not exists research_corpus_label_gin_idx
  on public.research_corpus using gin (label_json);

-- Sector + locale combo for "show me tech / es-locale only" pitches.
create index if not exists research_corpus_sector_locale_idx
  on public.research_corpus (sector, locale);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS — service_role only
-- ─────────────────────────────────────────────────────────────────────────

alter table public.research_corpus enable row level security;
alter table public.research_corpus force row level security;

-- Anonymized data, but still service-role-only at the DB level. The future
-- B2B portal will read via a dedicated read-only role with its own SELECT
-- policy (out of scope this sprint).
revoke all on public.research_corpus from anon, authenticated;
grant insert, select, update, delete on public.research_corpus to service_role;
