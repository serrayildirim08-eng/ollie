-- Tests for cook_history table + feed_me_cook_signals().
--
-- Run manually against a local/staging Supabase instance:
--   psql $DATABASE_URL -f supabase/migrations/tests/20260522_cook_history.test.sql
--
-- All tests use dedicated test user UUIDs that are cleaned up at the end.
-- Each test block uses DO $$ ... $$ LANGUAGE plpgsql with RAISE EXCEPTION on failure
-- so psql -v ON_ERROR_STOP=1 will abort at first failure.

-- ─── Setup ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE '=== cook_history test suite START ===';
END $$;

-- ─── Test 0: schema objects exist ─────────────────────────────────────────────

DO $$
BEGIN
  -- table
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cook_history'
  ) THEN
    RAISE EXCEPTION 'FAIL Test 0a: table cook_history missing';
  END IF;

  -- index: user+cooked_at
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'cook_history'
      AND indexname = 'cook_history_user_cooked'
  ) THEN
    RAISE EXCEPTION 'FAIL Test 0b: index cook_history_user_cooked missing';
  END IF;

  -- index: user+dish
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'cook_history'
      AND indexname = 'cook_history_user_dish'
  ) THEN
    RAISE EXCEPTION 'FAIL Test 0c: index cook_history_user_dish missing';
  END IF;

  -- function
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'feed_me_cook_signals'
  ) THEN
    RAISE EXCEPTION 'FAIL Test 0d: function feed_me_cook_signals missing';
  END IF;

  RAISE NOTICE 'PASS Test 0: schema objects exist';
END $$;

-- ─── Test 1: empty user → 0 signals ───────────────────────────────────────────

DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000000011';
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM feed_me_cook_signals(v_user);

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL Test 1: expected 0 signals for unknown user, got %', v_count;
  END IF;

  RAISE NOTICE 'PASS Test 1: empty user → 0 signals';
END $$;

-- ─── Test 2: 1 recent cook (no rating) → 1 recent signal, no loved/rejected ───

DO $$
DECLARE
  v_user        uuid := '00000000-0000-0000-0000-000000000012';
  v_recent_cnt  int;
  v_loved_cnt   int;
  v_rejected_cnt int;
BEGIN
  INSERT INTO cook_history (user_id, dish, cuisine, cooked_at)
  VALUES (v_user, 'pasta', 'italian', now() - interval '3 days');

  SELECT
    count(*) FILTER (WHERE signal = 'recent'),
    count(*) FILTER (WHERE signal = 'loved'),
    count(*) FILTER (WHERE signal = 'rejected')
  INTO v_recent_cnt, v_loved_cnt, v_rejected_cnt
  FROM feed_me_cook_signals(v_user);

  IF v_recent_cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL Test 2a: expected 1 recent signal, got %', v_recent_cnt;
  END IF;

  IF v_loved_cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL Test 2b: expected 0 loved signals, got %', v_loved_cnt;
  END IF;

  IF v_rejected_cnt <> 0 THEN
    RAISE EXCEPTION 'FAIL Test 2c: expected 0 rejected signals, got %', v_rejected_cnt;
  END IF;

  RAISE NOTICE 'PASS Test 2: 1 recent cook → recent signal only, no loved/rejected';
END $$;

-- ─── Test 3: rating=1 within 90 days → loved signal ──────────────────────────

DO $$
DECLARE
  v_user      uuid := '00000000-0000-0000-0000-000000000013';
  v_loved_cnt int;
  v_dish_out  text;
BEGIN
  INSERT INTO cook_history (user_id, dish, cuisine, cooked_at, rating)
  VALUES (v_user, 'tacos', 'mexican', now() - interval '45 days', 1);

  SELECT count(*), max(dish)
  INTO v_loved_cnt, v_dish_out
  FROM feed_me_cook_signals(v_user)
  WHERE signal = 'loved';

  IF v_loved_cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL Test 3a: expected 1 loved signal, got %', v_loved_cnt;
  END IF;

  IF v_dish_out IS DISTINCT FROM 'tacos' THEN
    RAISE EXCEPTION 'FAIL Test 3b: expected loved dish=tacos, got %', v_dish_out;
  END IF;

  RAISE NOTICE 'PASS Test 3: rating=1 within 90d → loved signal';
END $$;

-- ─── Test 4: rating=-1 within 30 days → rejected signal ─────────────────────

DO $$
DECLARE
  v_user         uuid := '00000000-0000-0000-0000-000000000014';
  v_rejected_cnt int;
  v_dish_out     text;
BEGIN
  INSERT INTO cook_history (user_id, dish, cuisine, cooked_at, rating)
  VALUES (v_user, 'liver stew', 'french', now() - interval '10 days', -1);

  SELECT count(*), max(dish)
  INTO v_rejected_cnt, v_dish_out
  FROM feed_me_cook_signals(v_user)
  WHERE signal = 'rejected';

  IF v_rejected_cnt <> 1 THEN
    RAISE EXCEPTION 'FAIL Test 4a: expected 1 rejected signal, got %', v_rejected_cnt;
  END IF;

  IF v_dish_out IS DISTINCT FROM 'liver stew' THEN
    RAISE EXCEPTION 'FAIL Test 4b: expected rejected dish=liver stew, got %', v_dish_out;
  END IF;

  RAISE NOTICE 'PASS Test 4: rating=-1 within 30d → rejected signal';
END $$;

-- ─── Test 5: feed_target='pet' + pet_name filter → only that pet's cooks ──────
-- Two pets (tontin + pinpon). Query for tontin only — pinpon rows must not appear.

DO $$
DECLARE
  v_user     uuid := '00000000-0000-0000-0000-000000000015';
  v_cnt_all  int;
  v_cnt_pet  int;
BEGIN
  -- tontin (guinea pig) recent cooks
  INSERT INTO cook_history (user_id, dish, feed_target, pet_name, cooked_at)
  VALUES
    (v_user, 'hay pellets', 'pet', 'tontin', now() - interval '1 day'),
    (v_user, 'carrot mash', 'pet', 'tontin', now() - interval '2 days');

  -- pinpon (fish) recent cook — must NOT appear in tontin query
  INSERT INTO cook_history (user_id, dish, feed_target, pet_name, cooked_at)
  VALUES (v_user, 'fish flakes', 'pet', 'pinpon', now() - interval '1 day');

  -- scoped to tontin
  SELECT count(*) INTO v_cnt_pet
  FROM feed_me_cook_signals(v_user, 'pet', 'tontin')
  WHERE signal = 'recent';

  IF v_cnt_pet <> 2 THEN
    RAISE EXCEPTION 'FAIL Test 5a: expected 2 recent signals for tontin, got %', v_cnt_pet;
  END IF;

  -- no fish flakes in tontin query
  IF EXISTS (
    SELECT 1 FROM feed_me_cook_signals(v_user, 'pet', 'tontin')
    WHERE dish = 'fish flakes'
  ) THEN
    RAISE EXCEPTION 'FAIL Test 5b: pinpon dish leaked into tontin query';
  END IF;

  RAISE NOTICE 'PASS Test 5: feed_target=pet + pet_name filter isolates per-pet cooks';
END $$;

-- ─── Test 6: CHECK constraint rejects rating=2 and rating=-2 ─────────────────

DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000000016';
BEGIN
  -- rating=2 must fail
  BEGIN
    INSERT INTO cook_history (user_id, dish, cooked_at, rating)
    VALUES (v_user, 'test dish', now(), 2);
    RAISE EXCEPTION 'FAIL Test 6a: CHECK constraint did not fire for rating=2';
  EXCEPTION
    WHEN check_violation THEN
      NULL; -- expected
  END;

  -- rating=-2 must fail
  BEGIN
    INSERT INTO cook_history (user_id, dish, cooked_at, rating)
    VALUES (v_user, 'test dish', now(), -2);
    RAISE EXCEPTION 'FAIL Test 6b: CHECK constraint did not fire for rating=-2';
  EXCEPTION
    WHEN check_violation THEN
      NULL; -- expected
  END;

  RAISE NOTICE 'PASS Test 6: CHECK constraint rejects rating=2 and rating=-2';
END $$;

-- ─── Test 7: feed_target CHECK rejects invalid value ──────────────────────────
-- Mirrors grocery Test 6 pattern — verifies DDL constraint is actually live.

DO $$
DECLARE
  v_user uuid := '00000000-0000-0000-0000-000000000017';
BEGIN
  BEGIN
    INSERT INTO cook_history (user_id, dish, feed_target, cooked_at)
    VALUES (v_user, 'test dish', 'robot', now());
    RAISE EXCEPTION 'FAIL Test 7: feed_target CHECK constraint did not fire';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PASS Test 7: feed_target CHECK constraint rejects invalid value';
  END;
END $$;

-- ─── Teardown ─────────────────────────────────────────────────────────────────

DELETE FROM cook_history
WHERE user_id IN (
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000012',
  '00000000-0000-0000-0000-000000000013',
  '00000000-0000-0000-0000-000000000014',
  '00000000-0000-0000-0000-000000000015',
  '00000000-0000-0000-0000-000000000016',
  '00000000-0000-0000-0000-000000000017'
);

DO $$
BEGIN
  RAISE NOTICE '=== cook_history test suite END — all passed ===';
END $$;
