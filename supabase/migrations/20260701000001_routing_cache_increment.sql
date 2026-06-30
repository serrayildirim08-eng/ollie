-- ollie · routing_cache hit_count increment RPC (S2 · fix 2)
-- Audit sprint S2 · 2026-07-01
--
-- ── PROBLEM ───────────────────────────────────────────────────────────────────
-- Both cache-hit paths (route.ts cacheHitUpdate + feed-me.ts cacheHitUpdate)
-- bumped the popularity counter with a PostgREST PATCH body of:
--     { "hit_count": { "increment": 1 }, "last_hit_at": "<iso>" }
-- PostgREST has NO atomic-increment syntax — it tried to STORE the object
-- {"increment":1} into the integer column, the PATCH silently failed (or wrote
-- garbage), and hit_count never moved. The eviction policy
-- (evictionScore = hit_count * exp(-Δt/30d)) therefore saw every entry as
-- hit_count=0 forever → popularity-weighted eviction was effectively random.
--
-- ── FIX ───────────────────────────────────────────────────────────────────────
-- Replace the broken PATCH with an atomic SQL RPC. The worker now POSTs
--     { "p_id": "<uuid>" }  →  /rest/v1/rpc/routing_cache_increment
-- which does a single race-free `hit_count = hit_count + 1` and stamps
-- last_hit_at = now().
--
-- ── SAFETY / IDEMPOTENCY ──────────────────────────────────────────────────────
--   • CREATE OR REPLACE FUNCTION → safe to re-run.
--   • routing_cache is service_role-only; the function is SECURITY DEFINER and
--     EXECUTE is granted to service_role only — no new public surface.
--   • The worker tolerates a 404 from this RPC (treats it as a no-op), so until
--     this migration is APPLIED BY SERRA the cache-hit path is unchanged (no
--     regression) — it just keeps not incrementing, exactly as before.
--   • ⚠️ SERRA: apply against the prod Supabase project to actually revive the
--     popularity counter (same project as the routing_cache_lookup revive).

create or replace function public.routing_cache_increment(
  p_id uuid
)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.routing_cache
     set hit_count   = hit_count + 1,
         last_hit_at = now()
   where id = p_id;
$$;

-- Only the CF worker (service_role) may call it. No anon/authenticated surface.
revoke all on function public.routing_cache_increment(uuid) from public;
grant execute on function public.routing_cache_increment(uuid) to service_role;
