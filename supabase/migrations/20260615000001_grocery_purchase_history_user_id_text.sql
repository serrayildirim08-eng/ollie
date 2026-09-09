-- audit #9 — grocery_purchase_history.user_id was `uuid`, but the worker writes
-- the Clerk user id (verifyClerkJwt returns e.g. "user_2ab…", a TEXT value).
-- Every purchase insert from a real Clerk-authenticated user therefore failed
-- with "invalid input syntax for type uuid", silently disabling adaptive
-- replenishment. Identity in Ollie is Clerk (text), not Supabase auth (uuid).
-- This migration switches the column, the self-select RLS policy, and the
-- replenishment RPC parameter from uuid -> text to match reality.
--
-- Rollback:
--   ALTER TABLE public.grocery_purchase_history ALTER COLUMN user_id TYPE uuid USING user_id::uuid;  -- only if all rows are valid uuids
--   (re-create the uuid-typed policy + function from 20260522000001)

-- ORDER MATTERS: the policy + function reference user_id with a uuid-typed
-- comparison, so they must be DROPPED before the ALTER (otherwise ALTER COLUMN
-- TYPE fails on the dependency). Drop → alter → recreate.

-- 1. Drop the dependents first.
DROP POLICY IF EXISTS grocery_purchase_history_self_select ON public.grocery_purchase_history;
DROP FUNCTION IF EXISTS grocery_replenishment_estimates(uuid);

-- 2. Column type uuid -> text. USING ::text is a safe widening cast for any
--    existing rows.
ALTER TABLE public.grocery_purchase_history
  ALTER COLUMN user_id TYPE text USING user_id::text;

-- 3. Recreate the self-select policy (cast auth.uid() to text to match).
CREATE POLICY grocery_purchase_history_self_select
  ON public.grocery_purchase_history
  FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

-- 4. Recreate the RPC with a text parameter.
CREATE OR REPLACE FUNCTION grocery_replenishment_estimates(p_user text)
RETURNS TABLE (
  canonical             text,
  median_interval_days  numeric,
  sample_size           int,
  last_purchase_ts      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ordered AS (
    SELECT
      canonical,
      ts,
      lag(ts) OVER (PARTITION BY canonical ORDER BY ts) AS prev_ts
    FROM grocery_purchase_history
    WHERE user_id = p_user
  ),
  intervals AS (
    SELECT
      canonical,
      EXTRACT(EPOCH FROM (ts - prev_ts)) / 86400.0 AS interval_days
    FROM ordered
    WHERE prev_ts IS NOT NULL
  ),
  stats AS (
    SELECT
      canonical,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY interval_days) AS median_interval_days,
      -- +1 because N intervals come from N+1 purchases
      count(*)::int + 1 AS sample_size
    FROM intervals
    GROUP BY canonical
  ),
  last_purchase AS (
    SELECT canonical, max(ts) AS last_ts
    FROM grocery_purchase_history
    WHERE user_id = p_user
    GROUP BY canonical
  )
  SELECT
    lp.canonical,
    s.median_interval_days,
    -- single purchase: no intervals exist, stats row absent → coalesce to 1
    coalesce(s.sample_size, 1) AS sample_size,
    lp.last_ts AS last_purchase_ts
  FROM last_purchase lp
  LEFT JOIN stats s ON s.canonical = lp.canonical
$$;

-- Allow the worker (service_role) to invoke.
GRANT EXECUTE ON FUNCTION grocery_replenishment_estimates(text) TO service_role;
