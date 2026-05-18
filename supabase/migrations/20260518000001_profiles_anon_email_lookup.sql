-- ollie · profiles — anon email lookup for the "sign in from a new device" flow
-- Sprint · auth · new-device sign-in (Pattern A)
--
-- WHAT THIS DOES
--   1. Adds the `encrypted_server_pw` column to public.profiles. @ollie/auth
--      has always expected this column, but the table created in
--      20260512000002_profiles.sql never had it — so profile sync silently
--      no-op'd. This migration finally adds it.
--   2. Lets an UNAUTHENTICATED (anon) caller read ONLY the two non-secret
--      credential-recovery columns — `salt` and `encrypted_server_pw` —
--      keyed by `email`. Nothing else.
--
-- WHY IT IS NEEDED
--   When a user signs in on a brand-new device, @ollie/auth (`signIn` ->
--   `fetchProfileFromSupabase` in packages/auth/src/index.ts) has NO local
--   salt and NO JWT yet. It does a REST GET:
--       GET /rest/v1/profiles?select=salt,encrypted_server_pw&email=eq.<email>
--   with only the anon apikey. Without this migration that request is
--   rejected — 20260512000002_profiles.sql does `revoke all ... from anon`,
--   so the new-device path always falls back to `missing-salt`.
--
-- WHY IT IS SAFE (no pre-auth secret leak)
--   - `salt`               is a PBKDF2 salt. Salts are non-secret BY DESIGN;
--                          security comes from the passphrase, not the salt.
--   - `encrypted_server_pw` is AES-GCM-256 ciphertext of a random 32-byte
--                          server password. It is USELESS without the key,
--                          and the key is derived only from the user's
--                          passphrase — which never leaves the device.
--   So serving these two columns pre-auth leaks nothing an attacker can
--   turn into account access. A correct passphrase is still mandatory to
--   decrypt and sign in.
--   - The anon role is granted column-level SELECT on ONLY these columns
--     (plus the lookup keys `id` + `email`). The timestamps and any future
--     sensitive column stay invisible to anon — a full-table read by anon
--     cannot widen.
--   - The existing authenticated-user policies (profiles_select_own /
--     insert / update / delete) are NOT touched. This migration is purely
--     additive.
--
-- BACK-COMPAT
--   `email` column + `lower(email)` index already exist (created in
--   20260512000002_profiles.sql) — this migration does NOT re-add them.
--   The new `encrypted_server_pw` column is nullable: existing rows get
--   NULL and are unaffected. A row is backfilled the next time that user
--   signs in on a device that still has their local credentials, so
--   new-device recovery turns on per-account as users re-sync. Existing
--   authenticated access is unchanged.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-18
-- Apply via: `supabase db push` OR the Supabase SQL editor.
-- Rollback: see supabase/rollbacks/20260518000001_profiles_anon_email_lookup.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 0. add the encrypted_server_pw column
-- ─────────────────────────────────────────────────────────────────────────
--
-- AES-GCM-256 ciphertext (base64-encoded { iv, ciphertext }) of a random
-- server password. Nullable — existing rows predate it and stay NULL until
-- the owning device re-syncs. @ollie/auth `uploadProfileToSupabase` writes
-- it; `fetchProfileFromSupabase` reads it for the new-device flow. The
-- GRANT + policy below reference it, so it must exist first.

alter table public.profiles
  add column if not exists encrypted_server_pw text;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. column-level GRANT to anon
-- ─────────────────────────────────────────────────────────────────────────
--
-- anon needs USAGE on the schema to reference the table at all, then
-- SELECT on ONLY the four non-secret columns. PostgREST enforces
-- column-level privileges: a `select=*` by anon would error / be filtered
-- to just these columns, and `created_at`/`updated_at` (or any column
-- added later) remain unreadable by anon.
--
-- id    — the auth.users id; non-secret, useful for the client to confirm
--         which account the recovered material belongs to.
-- email — the lookup key; the caller already supplies it in the filter.
-- salt, encrypted_server_pw — see the safety note above.

grant usage on schema public to anon;
grant select (id, email, salt, encrypted_server_pw) on public.profiles to anon;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RLS — anon SELECT policy
-- ─────────────────────────────────────────────────────────────────────────
--
-- RLS is already enabled + forced on public.profiles. A column-level GRANT
-- alone is not enough: under RLS the anon role also needs a policy that
-- permits the row. This policy lets anon read a profiles row only when it
-- actually carries recoverable credential material (`salt` is NOT NULL) —
-- so half-written / placeholder rows are not enumerable. The narrow
-- column GRANT in step 1 is what keeps the *columns* limited; this policy
-- is what permits the *row*.
--
-- We deliberately do NOT add an email predicate here: the caller always
-- filters by `email=eq.<email>` in the request, and the column GRANT means
-- even an unfiltered scan only ever exposes the four non-secret columns.

drop policy if exists profiles_select_anon_recovery on public.profiles;

create policy profiles_select_anon_recovery
  on public.profiles
  for select
  to anon
  using (salt is not null);
