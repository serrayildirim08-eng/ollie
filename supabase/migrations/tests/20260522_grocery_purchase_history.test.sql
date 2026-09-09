-- Tests for grocery_purchase_history table + grocery_replenishment_estimates().
--
-- Run manually against a local/staging Supabase instance:
--   psql $DATABASE_URL -f supabase/migrations/tests/20260522_grocery_purchase_history.test.sql
--
-- All tests use a dedicated test user UUID that is cleaned up at the end.
-- Each test block uses DO $$ ... $$ LANGUAGE plpgsql with RAISE EXCEPTION on failure
-- so psql -v ON_ERROR_STOP=1 will abort at first failure.

-- ─── Setup ────────────────────────────────────────────────────────────────────

-- Fixed UUID — will not collide with real auth.users because we bypass RLS via
-- service_role context (no FK on user_id by design).
DO $$
BEGIN
  RAISE NOTICE '=== grocery_purchase_history test suite START ===';
END $$;

-- ─── Test 0: table + index + function exist ────────────────────────────────────

DO $$
BEGIN
  -- table
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'grocery_purchase_history'
  ) THEN
    RAISE EXCEPTION 'FAIL Test 0a: table grocery_purchase_history missing';
  END IF;

  -- index: user+canonical+ts
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'grocery_purchase_history'
      AND indexname = 'grocery_purchase_history_user_canonical_ts'
  ) THEN
    RAISE EXCEPTION 'FAIL Test 0b: primary index missing';
  END IF;

  -- index: user+ts
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'grocery_purchase_history'
      AND indexname = 'grocery_purchase_history_user_ts'
  ) THEN
    RAISE EXCEPTION 'FAIL Test 0c: secondary index missing';
  END IF;

  -- function
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'grocery_replenishment_estimates'
  ) THEN
    RAISE EXCEPTION 'FAIL Test 0d: function grocery_replenishment_estimates missing';
  END IF;

  RAISE NOTICE 'PASS Test 0: schema objects exist';
END $$;

-- ─── Test 1: 0 purchases → 0 rows returned ────────────────────────────────────

DO $$
DECLARE
  v_user text := '00000000-0000-0000-0000-000000000001';
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM grocery_replenishment_estimates(v_user);

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL Test 1: expected 0 rows for unknown user, got %', v_count;
  END IF;

  RAISE NOTICE 'PASS Test 1: 0 purchases → 0 rows';
END $$;

-- ─── Test 2: 1 purchase → sample_size=1, median=NULL, last_ts correct ─────────

DO $$
DECLARE
  v_user     text        := '00000000-0000-0000-0000-000000000002';
  v_ts       timestamptz := '2026-01-01T10:00:00Z';
  v_median   numeric;
  v_samples  int;
  v_last_ts  timestamptz;
BEGIN
  INSERT INTO grocery_purchase_history (user_id, canonical, source, ts)
  VALUES (v_user, 'milk', 'pantry_add', v_ts);

  SELECT median_interval_days, sample_size, last_purchase_ts
  INTO v_median, v_samples, v_last_ts
  FROM grocery_replenishment_estimates(v_user)
  WHERE canonical = 'milk';

  IF v_samples IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL Test 2a: expected sample_size=1, got %', v_samples;
  END IF;

  IF v_median IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL Test 2b: expected median=NULL for single purchase, got %', v_median;
  END IF;

  IF v_last_ts <> v_ts THEN
    RAISE EXCEPTION 'FAIL Test 2c: expected last_purchase_ts=%, got %', v_ts, v_last_ts;
  END IF;

  RAISE NOTICE 'PASS Test 2: 1 purchase → sample_size=1, median=NULL, last_ts correct';
END $$;

-- ─── Test 3: 3 purchases exactly 7 days apart → median ~7 ────────────────────

DO $$
DECLARE
  v_user    text    := '00000000-0000-0000-0000-000000000003';
  v_base    timestamptz := '2026-01-01T10:00:00Z';
  v_median  numeric;
  v_samples int;
BEGIN
  -- t0, t0+7d, t0+14d  →  intervals: 7, 7  →  median = 7
  INSERT INTO grocery_purchase_history (user_id, canonical, source, ts) VALUES
    (v_user, 'milk', 'pantry_add', v_base),
    (v_user, 'milk', 'pantry_add', v_base + interval '7 days'),
    (v_user, 'milk', 'pantry_add', v_base + interval '14 days');

  SELECT median_interval_days, sample_size
  INTO v_median, v_samples
  FROM grocery_replenishment_estimates(v_user)
  WHERE canonical = 'milk';

  IF v_samples IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'FAIL Test 3a: expected sample_size=3, got %', v_samples;
  END IF;

  -- Allow ±0.001 for floating-point epoch arithmetic
  IF abs(v_median - 7.0) > 0.001 THEN
    RAISE EXCEPTION 'FAIL Test 3b: expected median≈7.0, got %', v_median;
  END IF;

  RAISE NOTICE 'PASS Test 3: 3 purchases 7d apart → median=7, sample_size=3';
END $$;

-- ─── Test 4: 5 purchases with intervals 3,7,7,14 → median=7 ─────────────────
-- Purchases: t, t+3, t+10, t+17, t+31
-- Intervals: 3, 7, 7, 14  →  sorted: 3,7,7,14  →  percentile_cont(0.5) = 7

DO $$
DECLARE
  v_user    text    := '00000000-0000-0000-0000-000000000004';
  v_base    timestamptz := '2026-02-01T10:00:00Z';
  v_median  numeric;
  v_samples int;
BEGIN
  INSERT INTO grocery_purchase_history (user_id, canonical, source, ts) VALUES
    (v_user, 'bread', 'shop_checked', v_base),
    (v_user, 'bread', 'shop_checked', v_base + interval  '3 days'),
    (v_user, 'bread', 'shop_checked', v_base + interval '10 days'),
    (v_user, 'bread', 'shop_checked', v_base + interval '17 days'),
    (v_user, 'bread', 'shop_checked', v_base + interval '31 days');

  SELECT median_interval_days, sample_size
  INTO v_median, v_samples
  FROM grocery_replenishment_estimates(v_user)
  WHERE canonical = 'bread';

  IF v_samples IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'FAIL Test 4a: expected sample_size=5, got %', v_samples;
  END IF;

  -- intervals sorted: 3,7,7,14  → median = (7+7)/2 = 7
  IF abs(v_median - 7.0) > 0.001 THEN
    RAISE EXCEPTION 'FAIL Test 4b: expected median=7.0, got %', v_median;
  END IF;

  RAISE NOTICE 'PASS Test 4: 5 purchases (3,7,7,14 day intervals) → median=7, sample_size=5';
END $$;

-- ─── Test 5: multiple canonicals isolated ─────────────────────────────────────

DO $$
DECLARE
  v_user   text        := '00000000-0000-0000-0000-000000000005';
  v_base   timestamptz := '2026-03-01T10:00:00Z';
  v_count  int;
BEGIN
  INSERT INTO grocery_purchase_history (user_id, canonical, source, ts) VALUES
    (v_user, 'milk',   'pantry_add', v_base),
    (v_user, 'milk',   'pantry_add', v_base + interval '7 days'),
    (v_user, 'cheese', 'pantry_add', v_base),
    (v_user, 'cheese', 'pantry_add', v_base + interval '30 days'),
    (v_user, 'cheese', 'pantry_add', v_base + interval '60 days');

  SELECT count(*) INTO v_count
  FROM grocery_replenishment_estimates(v_user);

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL Test 5: expected 2 canonical rows, got %', v_count;
  END IF;

  RAISE NOTICE 'PASS Test 5: multiple canonicals return isolated rows';
END $$;

-- ─── Test 6: source CHECK constraint rejects invalid value ────────────────────

DO $$
DECLARE
  v_user text := '00000000-0000-0000-0000-000000000006';
BEGIN
  BEGIN
    INSERT INTO grocery_purchase_history (user_id, canonical, source, ts)
    VALUES (v_user, 'milk', 'invalid_source', now());
    RAISE EXCEPTION 'FAIL Test 6: CHECK constraint did not fire';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS Test 6: CHECK constraint rejected invalid source';
  END;
END $$;

-- ─── Test 7: qty + unit nullable ──────────────────────────────────────────────

DO $$
DECLARE
  v_user text := '00000000-0000-0000-0000-000000000007';
  v_id   uuid;
BEGIN
  INSERT INTO grocery_purchase_history (user_id, canonical, source, ts)
  VALUES (v_user, 'milk', 'pantry_add', now())
  RETURNING id INTO v_id;

  IF NOT EXISTS (
    SELECT 1 FROM grocery_purchase_history
    WHERE id = v_id AND qty IS NULL AND unit IS NULL
  ) THEN
    RAISE EXCEPTION 'FAIL Test 7: qty/unit should be nullable';
  END IF;

  RAISE NOTICE 'PASS Test 7: qty + unit nullable';
END $$;

-- ─── Teardown ─────────────────────────────────────────────────────────────────

DELETE FROM grocery_purchase_history
WHERE user_id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000006',
  '00000000-0000-0000-0000-000000000007'
);

DO $$
BEGIN
  RAISE NOTICE '=== grocery_purchase_history test suite END — all passed ===';
END $$;
