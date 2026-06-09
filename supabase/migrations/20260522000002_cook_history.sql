-- Feed Me v2: adaptive learning per-user cook log.
-- Backs the /feed-me/:user endpoint that weights Gemini suggestions by the
-- user's actual cooking history.
--
-- Spec: docs/handoffs/feed-me/00-SPEC.md

CREATE TABLE cook_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dish text NOT NULL,
  cuisine text,
  diet text[],
  cooked_at timestamptz NOT NULL DEFAULT now(),
  rating smallint CHECK (rating IN (-1, 0, 1)),  -- -1 disliked, 0 neutral, 1 loved
  ingredients_used jsonb,
  feed_target text NOT NULL DEFAULT 'user' CHECK (feed_target IN ('user', 'pet')),
  pet_name text  -- non-null when feed_target='pet'
);

CREATE INDEX cook_history_user_cooked
  ON cook_history (user_id, cooked_at DESC);

CREATE INDEX cook_history_user_dish
  ON cook_history (user_id, dish);

ALTER TABLE cook_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY cook_history_self_select
  ON cook_history FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY cook_history_service_write
  ON cook_history FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY cook_history_self_update
  ON cook_history FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- ─── helper function: recent cook signals for Gemini prompt ──────────────────
-- Returns the data the /feed-me endpoint folds into the system prompt:
--   recent dishes (last 14 days), loved dishes (rating=1, last 90 days),
--   rejected dishes (rating=-1, last 30 days).
-- Aggregated server-side to keep endpoint a single round trip.

CREATE OR REPLACE FUNCTION feed_me_cook_signals(
  p_user uuid,
  p_feed_target text DEFAULT 'user',
  p_pet_name text DEFAULT NULL
)
RETURNS TABLE (
  signal text,     -- 'recent' | 'loved' | 'rejected'
  dish text,
  cuisine text,
  count int,
  last_ts timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT *
    FROM cook_history
    WHERE user_id = p_user
      AND feed_target = p_feed_target
      AND (p_pet_name IS NULL OR pet_name = p_pet_name)
  )
  SELECT 'recent'::text AS signal, dish, cuisine, count(*)::int, max(cooked_at) AS last_ts
  FROM scoped
  WHERE cooked_at > now() - interval '14 days'
  GROUP BY dish, cuisine
  UNION ALL
  SELECT 'loved'::text, dish, cuisine, count(*)::int, max(cooked_at)
  FROM scoped
  WHERE rating = 1 AND cooked_at > now() - interval '90 days'
  GROUP BY dish, cuisine
  UNION ALL
  SELECT 'rejected'::text, dish, cuisine, count(*)::int, max(cooked_at)
  FROM scoped
  WHERE rating = -1 AND cooked_at > now() - interval '30 days'
  GROUP BY dish, cuisine
$$;

GRANT EXECUTE ON FUNCTION feed_me_cook_signals(uuid, text, text) TO service_role;
