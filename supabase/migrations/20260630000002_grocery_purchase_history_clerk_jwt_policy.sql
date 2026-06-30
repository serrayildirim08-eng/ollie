-- Audit M6 — repoint grocery_purchase_history RLS to the Clerk JWT sub.
--
-- 20260615000001 recreated the self-select policy as
--   USING (auth.uid()::text = user_id)
-- but under Clerk auth there is no Supabase session, so auth.uid() is NULL and
-- the comparison is NULL — the authenticated SELECT policy never matches. The
-- identity migration 20260618000002 switched every other user-facing table to
-- `auth.jwt() ->> 'sub' = user_id` but left this one out. Align it.
--
-- Latent today (all prod access is via the service-role key, which bypasses
-- RLS), but this is the policy any future authenticated read would rely on, so
-- close the drift now rather than discover it when direct reads are wired.

drop policy if exists grocery_purchase_history_self_select on public.grocery_purchase_history;
create policy grocery_purchase_history_self_select
  on public.grocery_purchase_history
  for select to authenticated
  using (auth.jwt() ->> 'sub' = user_id);
