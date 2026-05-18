-- Rollback for 20260518000001_profiles_anon_email_lookup.sql
--
-- Reverts the anon new-device-lookup access on public.profiles back to the
-- locked-down state from 20260512000002_profiles.sql.
--
-- NOT dropped: the `email` column/index (predates this migration) AND the
-- `encrypted_server_pw` column (added by this migration but left in place —
-- it is nullable + harmless, and dropping it would destroy credential-
-- recovery data for any user who synced while the migration was live).
-- Re-applying the migration is a no-op for the column (`add column if not
-- exists`).

drop policy if exists profiles_select_anon_recovery on public.profiles;

revoke select (id, email, salt, encrypted_server_pw) on public.profiles from anon;

-- Re-assert the original posture: anon gets nothing on profiles.
revoke all on public.profiles from anon;
