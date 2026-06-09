-- Partner feature · bilateral sync (the "intimate window").
--
-- Privacy posture (decision 10): raw signals NEVER reach the server. The device
-- interprets only the channels the user consented to and uploads the resulting
-- soft snapshot ("tender day · low energy"). The server only stores + relays
-- that interpreted snapshot between two paired users.
--
-- All user ids are Clerk ids (text, e.g. "user_3ELwid…") — NOT uuids. Access is
-- service_role-only through the ai-proxy worker, which verifies the Clerk JWT
-- and enforces ownership; RLS is enabled with no public policies.

-- ── pairing codes ── short-lived 6-digit claim codes (decision 12). One person
-- mints + shares; the other enters it to form the pair.
CREATE TABLE partner_codes (
  code text PRIMARY KEY,                -- 6-digit string
  user_id text NOT NULL,                -- the minter (Clerk id)
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX partner_codes_user ON partner_codes (user_id);

-- ── pairs ── one active romantic pairing per side (1:1). user_lo/user_hi hold
-- the two ids sorted so the pair is order-independent + uniquely constrained.
CREATE TABLE partner_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_lo text NOT NULL,
  user_hi text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_pairs_ordered CHECK (user_lo < user_hi),
  CONSTRAINT partner_pairs_unique UNIQUE (user_lo, user_hi)
);
CREATE INDEX partner_pairs_lo ON partner_pairs (user_lo);
CREATE INDEX partner_pairs_hi ON partner_pairs (user_hi);

-- ── snapshots ── each user's current interpreted state (what they share). One
-- row per user; the partner reads the OTHER user's row. Already consent-filtered
-- + interpreted device-side, so this is soft language only, never numbers.
CREATE TABLE partner_snapshots (
  user_id text PRIMARY KEY,
  phrases jsonb NOT NULL DEFAULT '[]'::jsonb,  -- e.g. ["tender day","low energy"]
  self_word text,
  crisis boolean NOT NULL DEFAULT false,
  gone_dark boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE partner_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_snapshots ENABLE ROW LEVEL SECURITY;

-- service_role (the worker) is the only writer/reader; no anon/authenticated
-- policies — direct client access is denied by default.
CREATE POLICY partner_codes_service ON partner_codes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY partner_pairs_service ON partner_pairs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY partner_snapshots_service ON partner_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
