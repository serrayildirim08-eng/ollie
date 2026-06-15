-- audit #75-#82 — defense-in-depth on the worker-owned tables.
--
-- Each table already has ENABLE ROW LEVEL SECURITY + role policies, but:
--   (a) no FORCE ROW LEVEL SECURITY → RLS does NOT apply to the table OWNER, so
--       anything ever connecting as the owner role would bypass every policy
--       (#79-#82). FORCE closes that. Roles with BYPASSRLS (Supabase's
--       service_role) still bypass by design — so this does NOT break the
--       worker's service-role access.
--   (b) no EXPLICIT table GRANTs. Supabase's default privileges usually already
--       grant these to service_role / authenticated, so #75-#78 are likely
--       already satisfied — but we make intent explicit + idempotent here. We
--       grant ONLY what each table's existing policies imply (never more).
--
-- Everything below is idempotent: re-running is a no-op. Safe to apply anytime.
-- Apply at deploy (irreversible-ish; needs Serra/dev — like 20260615000001).

-- ── FORCE RLS (#79-#82) ──────────────────────────────────────────────────────
ALTER TABLE public.grocery_purchase_history FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cook_history             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.routing_cache            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_codes            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_pairs            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.partner_snapshots        FORCE ROW LEVEL SECURITY;

-- ── Explicit GRANTs matching existing policies (#75-#78) ─────────────────────
-- service_role is the server/worker identity (FOR ALL / write policies on every
-- table here) → full DML.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grocery_purchase_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cook_history             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routing_cache            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_codes            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_pairs            TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_snapshots        TO service_role;

-- authenticated gets ONLY what its self_* policies allow (read own rows; cook
-- history also self-updates). It never writes the others (clients go via the
-- worker). routing_cache + partner_* have NO authenticated policy → no grant.
GRANT SELECT          ON public.grocery_purchase_history TO authenticated;
GRANT SELECT, UPDATE  ON public.cook_history             TO authenticated;
