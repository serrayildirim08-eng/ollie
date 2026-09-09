-- ollie · routing_cache module CHECK — add missing routable modules (S2 · fix 3)
-- Audit sprint S2 · 2026-07-01
--
-- ── PROBLEM ───────────────────────────────────────────────────────────────────
-- The `routing_cache.module` CHECK constraint (created in 20260521000001) was
-- hand-written and has DRIFTED from the worker's single source of truth for
-- module names (workers/ai-proxy/src/router/dump-schema.ts → MODULES). The
-- original CHECK allows:
--     grocery, work, body, dump, money, admin, pets, habits, health,
--     finance, sleep, cycle, goals
-- but the Layer-1 router (dump-classify.ts) can route to `medication`, `mood`,
-- `chores`, `crisis` and `dump_only` as well. Those are NOT in the CHECK, so
-- when /route/:module writes a classification for one of them, route.ts
-- cacheWrite() POSTs a row that violates the CHECK → PostgREST returns 400 and
-- the write SILENTLY FAILS (cacheWrite is fire-and-forget with no .ok check).
-- The most-hit case is `medication`: a real routable module whose cache rows
-- were never persisting, so every /route/medication call paid full LLM cost.
--
-- ── FIX ───────────────────────────────────────────────────────────────────────
-- Drop + recreate the CHECK so it lists EVERY value in the worker's MODULES
-- registry (medication, mood, chores, crisis, dump_only added), UNION the
-- legacy values already allowed (dump, money, health) so any pre-existing rows
-- written under the old naming stay valid. The drift guard lives in
-- workers/ai-proxy/tests/module-registry.test.ts, which asserts this CHECK
-- lists every MODULES value — adding a module to dump-schema without updating
-- this migration fails CI.
--
-- SINGLE SOURCE OF TRUTH for module names: dump-schema.ts → MODULES. This SQL
-- CHECK is the one registry that cannot be derived from it at compile time, so
-- it is kept in sync by the drift test referenced above.
--
-- ── SAFETY / IDEMPOTENCY ──────────────────────────────────────────────────────
--   • DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT → safe to re-run.
--   • The new list is a SUPERSET of the old one, so no existing row can be
--     invalidated by this change (no data loss, no failed migration).
--   • routing_cache is service_role-only; no client surface is touched.
--   • ⚠️ SERRA / DB-OWNER: apply against the prod Supabase project
--     (ykxzfzkfsolwgmheiwpx) — same project as the routing_cache revive +
--     increment RPCs. NOT auto-applied.

alter table public.routing_cache
  drop constraint if exists routing_cache_module_check;

alter table public.routing_cache
  add constraint routing_cache_module_check
  check (module in (
    -- worker MODULES registry (dump-schema.ts → MODULES)
    'crisis','work','admin','pets','cycle','finance','sleep','body',
    'mood','habits','goals','grocery','medication','chores','dump_only',
    -- legacy values from the original 20260521000001 CHECK (kept so any
    -- pre-existing rows written under the old naming remain valid)
    'dump','money','health'
  ));
