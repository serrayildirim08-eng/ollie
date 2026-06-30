-- Audit H10 — lock down profile_recovery_lookup.
--
-- profile_recovery_lookup(p_email text) is a SECURITY DEFINER function that
-- takes an arbitrary email and returns that account's (id, salt,
-- encrypted_server_pw) with NO rate limit. It was granted EXECUTE to both
-- `anon` and `authenticated` for a new-device recovery flow.
--
-- Risk: any caller (logged in or not) can probe arbitrary emails and observe
-- 0-vs-1-row responses to enumerate which emails are registered, then harvest
-- (salt, encrypted_server_pw) pairs to brute-force passwords offline.
--
-- That recovery flow was never built — there are no app callers
-- (`grep rpc('profile_recovery_lookup'` is empty). Revoke the public grants so
-- the surface is closed. When recovery is reintroduced it must run behind a
-- rate-limited server path (service-role worker), never a direct anon RPC.
--
-- The function definition is kept (dormant + locked) so the logic survives for
-- that future, rate-limited reintroduction.

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'profile_recovery_lookup'
  ) then
    revoke execute on function public.profile_recovery_lookup(text) from anon;
    revoke execute on function public.profile_recovery_lookup(text) from authenticated;
  end if;
end
$$;
