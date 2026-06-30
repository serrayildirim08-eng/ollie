-- ollie · routing_cache PER-USER namespace (S2 cross-user-leakage fix)
-- Audit finding S2 · 2026-07-01
--
-- ── PROBLEM ───────────────────────────────────────────────────────────────────
-- The /route/:module + /feed-me/:user cache (public.routing_cache, read/written
-- by workers/ai-proxy/src/router/route.ts + feed-me.ts) keyed every row on
-- (module, embedding) ONLY — there was NO user dimension. The lookup RPC
-- (routing_cache_lookup, 20260618000003) did a module-scoped pgvector kNN with
-- no per-user filter, so two DIFFERENT users with similar text matched each
-- other's cached classifications:
--     user A dumps "buy milk"  → row written (module='grocery')
--     user B dumps "buy milk"  → cosine match on A's row → B gets A's result
-- That is a privacy leak (one user's routed interpretation served to another)
-- AND it blocks per-user personalization (the cache cannot learn a person's
-- own phrasing if everyone shares one global pool).
--
-- ── FIX ───────────────────────────────────────────────────────────────────────
-- Add a `user_hash` column and make it part of the cache key. The worker now
-- threads a salted SHA-256 user_hash (telemetry.ts deriveUserHash — the SAME
-- derivation every user-keyed Supabase table already uses; the raw Clerk id is
-- never stored in this DB) into both the write and the lookup, and the lookup
-- RPC filters `rc.user_hash = p_user_hash`. A lookup can therefore ONLY return
-- the caller's own rows. Cold-start is fine: a new user simply gets no hit until
-- they build their own history; the LLM still classifies normally.
--
-- ── EXACT RPC SIGNATURE (must match route.ts + feed-me.ts cacheLookup) ─────────
-- POST body: { p_module text, p_embedding number[], p_threshold double,
--              p_user_hash text }  →  /rest/v1/rpc/routing_cache_lookup
-- Returns: array of { id uuid, classification jsonb, language text } (worker
-- takes rows[0]). The new 4-arg overload REPLACES the old 3-arg one, which is
-- dropped so no caller (or manual query) can ever do the unfiltered, cross-user
-- lookup again (defense in depth).
--
-- ── SAFETY / IDEMPOTENCY ──────────────────────────────────────────────────────
--   • ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS +
--     CREATE OR REPLACE FUNCTION + DROP FUNCTION IF EXISTS → safe to re-run.
--   • Pre-existing rows get user_hash = NULL. The lookup filter
--     `rc.user_hash = p_user_hash` never matches NULL (NULL = x is unknown),
--     so legacy global rows become invisible and age out naturally — exactly
--     the desired "no cross-user match" guarantee. Expected, acceptable
--     one-time cache-cold transition (hit-rate dips until users re-warm their
--     own rows). No data is deleted.
--   • The worker tolerates a 404 from the lookup RPC (treats it as no-hit), so
--     until this migration is APPLIED the cache-hit path is just cold — never a
--     cross-user hit, no regression.
--   • routing_cache is service_role-only; the function is SECURITY DEFINER with
--     EXECUTE granted to service_role only — no new public surface.
--   • ⚠️ SERRA / DB-OWNER: apply against the prod Supabase project
--     (ykxzfzkfsolwgmheiwpx) — same project as the routing_cache revive +
--     increment + medication-CHECK migrations. NOT auto-applied.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Column — user_hash
-- ═══════════════════════════════════════════════════════════════════════════════
-- Salted SHA-256 (hex) of the verified user id. Nullable so any pre-existing
-- global rows stay valid (they simply never match a per-user lookup again).

alter table public.routing_cache
  add column if not exists user_hash text;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. Index — (user_hash, module)
-- ═══════════════════════════════════════════════════════════════════════════════
-- The lookup filters on BOTH user_hash and module before the pgvector ORDER BY,
-- so a composite btree lets Postgres cut to this user's rows for this module
-- before the cosine scan. user_hash leads (highest selectivity per query).

create index if not exists routing_cache_user_module_idx
  on public.routing_cache (user_hash, module);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. RPC — routing_cache_lookup (per-user 4-arg overload)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Same as 20260618000003 but with the mandatory per-user filter. p_embedding
-- arrives as a JSON number[] → real[] here → cast ::vector (pgvector accepts a
-- real[]→vector cast). p_user_hash is compared with `=`, so a row with a NULL
-- user_hash (legacy global row) can never satisfy the predicate.

create or replace function public.routing_cache_lookup(
  p_module    text,
  p_embedding real[],
  p_threshold double precision,
  p_user_hash text
)
returns table (
  id             uuid,
  classification jsonb,
  language       text
)
language sql
stable
security definer
set search_path = public
as $$
  select rc.id, rc.classification, rc.language
  from public.routing_cache rc
  where rc.module = p_module
    and rc.user_hash = p_user_hash          -- per-user isolation (S2)
    and rc.embedding is not null
    and 1 - (rc.embedding <=> p_embedding::vector) > p_threshold
  order by rc.embedding <=> p_embedding::vector
  limit 1;
$$;

-- Only the CF worker (service_role) may call it.
revoke all on function
  public.routing_cache_lookup(text, real[], double precision, text) from public;
grant execute on function
  public.routing_cache_lookup(text, real[], double precision, text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Drop the old, user-blind 3-arg overload
-- ═══════════════════════════════════════════════════════════════════════════════
-- Defense in depth: remove the only function that could do a cross-user
-- lookup. The worker no longer calls it (it always sends p_user_hash). If it
-- is somehow still referenced, the caller gets a 404 → treated as no-hit, never
-- a cross-user row.

drop function if exists public.routing_cache_lookup(text, real[], double precision);
