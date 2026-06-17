-- Companion hardening for the pre-merge audit (do NOT edit the migrations this
-- corrects — they may be partially applied to prod; this is a forward-only fix).
--
-- Two gaps:
--   (a) FORCE RLS missing on the A6b worker tables. 20260611000001 created
--       public.dump_inbox + public.grocery_pantry with ENABLE ROW LEVEL SECURITY
--       but NOT FORCE. Sibling worker-owned tables (grocery_purchase_history,
--       cook_history, routing_cache, partner_*) got FORCE in 20260615000002.
--       Without FORCE, RLS does NOT apply to the table OWNER, so a future
--       buggy/permissive policy or anything connecting as the owner could bypass
--       every policy. FORCE closes that. service_role (BYPASSRLS by design) is
--       unaffected, so the workers keep their access.
--
--   (b) Unbacked authenticated GRANTs on cook_history. 20260615000002 ran
--           GRANT SELECT, UPDATE ON public.cook_history TO authenticated;
--       justified by self_* RLS policies — but 20260530144446 had already
--       DROPPED cook_history_self_select + cook_history_self_update and never
--       recreated them (auth.uid() is always NULL under Clerk auth, so they were
--       vestigial). The grant therefore rests on policies that no longer exist:
--       inert under default-deny today, but a latent footgun if a permissive
--       authenticated policy is ever added. Revoke it to match reality.
--
--       NOTE: the sibling grant on grocery_purchase_history is NOT revoked — its
--       backing policy (grocery_purchase_history_self_select, FOR SELECT TO
--       authenticated) was RECREATED in 20260615000001 (line 27) and still
--       exists, so that grant is genuinely backed.
--
-- Everything below is idempotent: FORCE RLS is naturally so, and REVOKE on an
-- already-absent grant is a no-op. Safe to re-run. Apply at deploy.

-- ── (a) FORCE RLS on the A6b worker tables ───────────────────────────────────
ALTER TABLE public.dump_inbox     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.grocery_pantry FORCE ROW LEVEL SECURITY;

-- ── (b) Revoke the unbacked authenticated grants on cook_history ─────────────
-- These rested on cook_history_self_select / cook_history_self_update, dropped
-- by 20260530144446 and never recreated. No backing policy → revoke.
REVOKE SELECT, UPDATE ON public.cook_history FROM authenticated;
