-- Fix: cook_history.user_id was typed `uuid`, but the app authenticates with
-- Clerk and the ai-proxy worker writes the Clerk user id (e.g.
-- "user_3ELwid5ODo4oxMS0KlQ2OJPckUI") — a text string, not a UUID. Every
-- "cooked it" INSERT and every feed_me_cook_signals() read failed with
-- `invalid input syntax for type uuid`, which surfaced as the cook-history
-- write rolling back (the "cooked it" glitch) and personalization staying dead.
--
-- Switch user_id (and the RPC parameter) to text. The auth.uid()-based RLS
-- policies were vestigial — auth.uid() is always NULL here (no Supabase auth;
-- all access is via service_role through the worker, which enforces ownership
-- via verified Clerk JWT), and a uuid=text comparison can't survive the type
-- change anyway — so they are dropped. RLS stays ENABLED; service_role keeps
-- its write policy and the SECURITY DEFINER RPC remains the read path.

-- These reference user_id in a uuid=uuid comparison; drop before retyping.
DROP POLICY IF EXISTS cook_history_self_select ON cook_history;
DROP POLICY IF EXISTS cook_history_self_update ON cook_history;

ALTER TABLE cook_history
  ALTER COLUMN user_id TYPE text USING user_id::text;

-- Recreate the signals RPC with a text user parameter. CREATE OR REPLACE can't
-- change an argument type, so drop the old (uuid) signature first. This also
-- drops the old GRANT, re-added below.
DROP FUNCTION IF EXISTS feed_me_cook_signals(uuid, text, text);

CREATE FUNCTION feed_me_cook_signals(
  p_user text,
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

GRANT EXECUTE ON FUNCTION feed_me_cook_signals(text, text, text) TO service_role;
