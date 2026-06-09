-- Rollback for 20260519000001_profiles_anon_rpc_fix.sql
--
-- Drops the recovery RPC. Does NOT restore the unscoped anon SELECT policy
-- from 20260518000001 — that policy was a security hole (F1) and must not
-- come back. If new-device recovery is needed after this rollback, re-apply
-- the forward migration (which recreates the safe RPC).
--
-- NOT dropped: the `encrypted_server_pw` column (added by 20260518000001,
-- nullable + harmless) and the `email` column/index (predate everything).

drop function if exists public.profile_recovery_lookup(text);

-- Re-assert the locked-down posture: anon gets nothing on profiles.
revoke all on public.profiles from anon;
