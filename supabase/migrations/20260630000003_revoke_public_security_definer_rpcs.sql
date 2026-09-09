-- Audit H10-followup — lock down three more SECURITY DEFINER RPCs.
--
-- The Supabase security linter (run after the H10/M4/M6 changes) flagged three
-- SECURITY DEFINER functions callable by anon + authenticated. Two take a user
-- id and return that user's rows — the same cross-user enumeration class as
-- profile_recovery_lookup, which the original red-team audit missed:
--   * grocery_replenishment_estimates(text)        → another user's grocery cadence
--   * feed_me_cook_signals(text, text, text)       → another user's cook/pet signals
--   * rls_auto_enable()                            → a maintenance helper, no caller
--
-- IMPORTANT: revoking from anon + authenticated is NOT enough — Postgres grants
-- EXECUTE to PUBLIC by default on function creation, and PUBLIC covers anon. The
-- real gate is `revoke ... from public`. The ai-proxy worker calls the first two
-- with the service-role key (explicit grant, bypasses this), so no feature
-- breaks. If recovery/these RPCs are ever exposed to clients, do it behind a
-- rate-limited server path, never a raw anon-callable SECURITY DEFINER function.

do $$
begin
  if to_regprocedure('public.grocery_replenishment_estimates(text)') is not null then
    revoke execute on function public.grocery_replenishment_estimates(text) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.feed_me_cook_signals(text, text, text)') is not null then
    revoke execute on function public.feed_me_cook_signals(text, text, text) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
