-- ollie · profiles — F1 SECURITY FIX: close the unscoped anon SELECT hole
-- Sprint · auth · new-device sign-in (Pattern A) — corrective migration
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT WENT WRONG
-- ─────────────────────────────────────────────────────────────────────────
--   Migration 20260518000001_profiles_anon_email_lookup.sql added:
--     create policy profiles_select_anon_recovery on public.profiles
--       for select to anon using (salt is not null);
--   plus  grant select (id, email, salt, encrypted_server_pw) ... to anon.
--
--   The policy has NO row scoping. The comment in that migration assumed
--   "the caller always filters by email=eq.<email>", but PostgREST filters
--   are CLIENT-SUPPLIED — an unauthenticated caller holding only the public
--   anon key can simply omit the filter:
--       GET /rest/v1/profiles?select=id,email,salt,encrypted_server_pw
--   and receive EVERY user's row. That is:
--     - a full email-address harvest of the entire user base, and
--     - an offline brute-force surface: (salt, encrypted_server_pw) for
--       every account, so an attacker can grind passphrases at leisure.
--
--   The column GRANT limits WHICH columns, never WHICH rows. RLS is the
--   only thing that scopes rows, and the policy scoped nothing.
--
-- ─────────────────────────────────────────────────────────────────────────
-- THE FIX
-- ─────────────────────────────────────────────────────────────────────────
--   1. DROP the unscoped policy and REVOKE the anon column/table grants —
--      anon can no longer read public.profiles at all.
--   2. Replace the new-device-recovery path with a SECURITY DEFINER RPC,
--      `profile_recovery_lookup(p_email text)`, that:
--        - takes the email the caller already knows,
--        - returns AT MOST ONE row (id, salt, encrypted_server_pw),
--        - is the ONLY anon-reachable surface on profiles.
--      A caller can resolve credentials only for an email they already
--      possess; they can never enumerate the table. No filter is
--      client-supplied — the function body owns the WHERE clause.
--
-- WHY THE RPC IS SAFE
--   - `salt` is a PBKDF2 salt — non-secret by design.
--   - `encrypted_server_pw` is AES-GCM-256 ciphertext, useless without the
--     key, which is derived only from the user's passphrase (never leaves
--     the device).
--   - Returning these two for a KNOWN email leaks nothing an attacker can
--     turn into account access — the passphrase is still mandatory.
--   - The difference from the broken policy: the broken policy allowed
--     ENUMERATION (read all rows). The RPC allows only point lookup by a
--     value the caller already holds. No harvest, no bulk brute-force list.
--   - `email` is NOT returned — the caller supplied it; echoing it back
--     adds nothing and keeps the surface minimal.
--
-- BACK-COMPAT
--   The `encrypted_server_pw` column added by 20260518000001 stays — it is
--   nullable and harmless. Authenticated policies (profiles_select_own /
--   insert / update / delete) are untouched. The web auth client is
--   updated in the same PR to call this RPC instead of the REST GET
--   (see packages/auth/src/index.ts · fetchProfileFromSupabase).
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-19
-- Apply via: `supabase db push` OR the Supabase SQL editor.
-- Rollback: see supabase/rollbacks/20260519000001_profiles_anon_rpc_fix.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. tear down the unscoped anon access from 20260518000001
-- ─────────────────────────────────────────────────────────────────────────

drop policy if exists profiles_select_anon_recovery on public.profiles;

-- Remove the column-level and any blanket grants to anon. After this anon
-- has no direct read path to public.profiles — only the RPC below.
revoke select (id, email, salt, encrypted_server_pw) on public.profiles from anon;
revoke all on public.profiles from anon;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. SECURITY DEFINER recovery RPC — the single anon-reachable surface
-- ─────────────────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER: the function executes with the privileges of its
-- OWNER (the migration role / postgres), so it can read public.profiles
-- even though the anon CALLER cannot. The function body — not the client —
-- owns the WHERE clause, so a caller can only ever resolve the single row
-- whose email they passed in.
--
-- search_path is pinned to an empty string and every object is
-- schema-qualified — standard hardening so a malicious search_path cannot
-- redirect `profiles` to an attacker-controlled object.
--
-- Returns 0 or 1 rows. `limit 1` is belt-and-suspenders: `email` is unique
-- (lower(email) index from 20260512000002), but a defensive cap means a
-- future duplicate-email bug can never turn this into a multi-row leak.

create or replace function public.profile_recovery_lookup(p_email text)
returns table (id uuid, salt text, encrypted_server_pw text)
language sql
security definer
set search_path = ''
stable
as $$
  select p.id, p.salt, p.encrypted_server_pw
  from public.profiles p
  where lower(p.email) = lower(p_email)
    and p.salt is not null
  limit 1;
$$;

-- Lock the function down, then grant EXECUTE narrowly.
-- `create function` grants EXECUTE to PUBLIC by default — revoke that first
-- so the grant list below is the complete, intentional surface.
revoke all on function public.profile_recovery_lookup(text) from public;
grant execute on function public.profile_recovery_lookup(text) to anon;
grant execute on function public.profile_recovery_lookup(text) to authenticated;

comment on function public.profile_recovery_lookup(text) is
  'Pattern A new-device sign-in: point lookup of (id, salt, encrypted_server_pw) '
  'by a KNOWN email. SECURITY DEFINER so anon can call it without table SELECT. '
  'Returns at most one row — no enumeration. Replaces the unscoped '
  'profiles_select_anon_recovery RLS policy (F1, dropped above).';
