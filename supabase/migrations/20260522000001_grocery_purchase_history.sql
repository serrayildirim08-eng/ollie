-- Adaptive replenishment per-user purchase log.
-- Backs the /replenishment/:user endpoint that replaces hardcoded SHELF_LIFE_MAP
-- estimates with observed user cadence.
--
-- Spec: docs/handoffs/grocery-routing/05-ADAPTIVE-REPLENISHMENT.md
--
-- Rollback:
--   DROP FUNCTION IF EXISTS grocery_replenishment_estimates(uuid);
--   DROP TABLE IF EXISTS public.grocery_purchase_history;

CREATE TABLE grocery_purchase_history (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid        NOT NULL,
  canonical text        NOT NULL,  -- canonical key from grocery.config CANONICAL_ITEMS
  qty       numeric,               -- optional: null when user did not provide quantity
  unit      text,                  -- optional: null when user did not provide unit
  source    text        NOT NULL
              CHECK (source IN ('pantry_add', 'shop_checked', 'ai_inferred')),
  ts        timestamptz NOT NULL DEFAULT now()
);

-- Primary lookup pattern: most recent N purchases for (user, canonical).
CREATE INDEX grocery_purchase_history_user_canonical_ts
  ON grocery_purchase_history (user_id, canonical, ts DESC);

-- Secondary index for cross-canonical "what did this user buy last month" queries
-- (used by future analytics + per-user shelf-life dashboard).
CREATE INDEX grocery_purchase_history_user_ts
  ON grocery_purchase_history (user_id, ts DESC);

ALTER TABLE grocery_purchase_history ENABLE ROW LEVEL SECURITY;

-- Users see only their own rows.
CREATE POLICY grocery_purchase_history_self_select
  ON grocery_purchase_history
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Service role (worker) writes — frontend never writes direct, always via dispatch.
CREATE POLICY grocery_purchase_history_service_write
  ON grocery_purchase_history
  FOR INSERT TO service_role
  WITH CHECK (true);

-- ─── median-cadence SQL function ──────────────────────────────────────────────
-- Returns per-canonical median interval (in days) between consecutive purchases
-- for a given user. Postgres-side aggregation keeps the /replenishment endpoint
-- a single round trip. Uses lag() over the time-ordered series.
--
-- Returns:
--   canonical text, median_interval_days numeric, sample_size int, last_purchase_ts timestamptz
--
-- Edge cases:
--   0 purchases for user → 0 rows returned
--   1 purchase → sample_size=1, median_interval_days=NULL, last_purchase_ts=that row's ts
--   2+ purchases → median_interval_days computed, sample_size=purchase count

CREATE OR REPLACE FUNCTION grocery_replenishment_estimates(p_user uuid)
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
GRANT EXECUTE ON FUNCTION grocery_replenishment_estimates(uuid) TO service_role;
