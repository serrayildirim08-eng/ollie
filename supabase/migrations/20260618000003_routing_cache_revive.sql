-- ollie · routing_cache 5A — revive the dead /route/:module cache
-- Audit 2026-06-18 · finding #24 · DECISIONS.md fork 5 (decision A)
--
-- ── PROBLEM ───────────────────────────────────────────────────────────────────
-- The ai-proxy router (workers/ai-proxy/src/router/route.ts) does a pgvector
-- cosine-similarity cache lookup before paying for a Voyage embed + Groq classify.
-- Two pieces it depends on were never created in prod, so the cache is dead and
-- every /route/:module call pays full LLM cost:
--   (a) RPC `routing_cache_lookup` — route.ts cacheLookup() POSTs to
--       /rest/v1/rpc/routing_cache_lookup. It does not exist → the worker gets
--       404 and treats it as "no hit" (route.ts line 409-410), permanently
--       cold. (finding #24, #9, #75 cost.)
--   (b) Column `text_sample` — route.ts cacheWrite() (line 457) inserts
--       `text_sample: text.slice(0,500)`. The routing_cache table
--       (20260521000001) has no such column → PostgREST rejects the insert, so
--       NOTHING is ever cached even if the RPC existed.
-- Fixing both revives the cache end-to-end (feed-me + /route/:module cost wins).
--
-- ── EXACT RPC SIGNATURE (derived from route.ts cacheLookup, lines ~380-419) ───
-- POST body:  { p_module: string, p_embedding: number[], p_threshold: number }
-- The worker passes the 1024-dim Voyage embedding as a JSON number[]; PostgREST
-- maps it to a Postgres array, so the function takes the array and casts it to
-- vector(1024) internally (the SQL the worker comments at line 387-392).
-- Returns an ARRAY of rows shaped { id uuid, classification jsonb, language text }
-- (route.ts CacheRow); the worker takes rows[0].
-- COSINE_THRESHOLD is a similarity (1 - distance) in (0,1], compared with
-- `1 - (embedding <=> query) > p_threshold`.
--
-- ── SAFETY / IDEMPOTENCY ──────────────────────────────────────────────────────
--   • ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION → safe to re-run.
--   • routing_cache is service_role-only (no client surface); the RPC is
--     SECURITY DEFINER so the worker (service_role) invokes it; EXECUTE is
--     granted to service_role only. No new public surface is opened.
--   • Project: ykxzfzkfsolwgmheiwpx (East US). APPLIED BY SERRA (prod creds).

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Missing column — text_sample
-- ═══════════════════════════════════════════════════════════════════════════════
-- Plaintext sample of the original user text (worker stores text.slice(0,500)).
-- Diagnostic/debug only — lets you eyeball what a cache row was built from. Not
-- used by the lookup path. Nullable so any pre-existing rows stay valid.

alter table public.routing_cache
  add column if not exists text_sample text;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. RPC — routing_cache_lookup
-- ═══════════════════════════════════════════════════════════════════════════════
-- pgvector cosine-similarity nearest-neighbour lookup, partitioned by module.
-- Mirrors the SQL the worker documents inline:
--   SELECT id, classification, language
--   FROM routing_cache
--   WHERE module = $1 AND 1 - (embedding <=> $2::vector) > $3
--   ORDER BY embedding <=> $2::vector
--   LIMIT 1
--
-- p_embedding arrives as a JSON number[] from PostgREST → typed `real[]` here,
-- then cast `::vector` (pgvector accepts a real[]→vector cast). Using real[]
-- (not vector) as the arg type is what lets PostgREST bind the JSON array
-- positionally by name without the caller having to send pgvector text syntax.

create or replace function public.routing_cache_lookup(
  p_module    text,
  p_embedding real[],
  p_threshold double precision
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
    and rc.embedding is not null
    and 1 - (rc.embedding <=> p_embedding::vector) > p_threshold
  order by rc.embedding <=> p_embedding::vector
  limit 1;
$$;

-- Only the CF worker (service_role) may call it. No anon/authenticated surface —
-- routing_cache itself is service_role-only.
revoke all on function public.routing_cache_lookup(text, real[], double precision) from public;
grant execute on function public.routing_cache_lookup(text, real[], double precision) to service_role;
