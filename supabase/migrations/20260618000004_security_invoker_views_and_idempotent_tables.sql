-- ollie · security-hardening migration
-- Audit 2026-06-18 · findings #102 (definer-rights funnel views) + #114
--                    (non-idempotent worker table creation)
--
-- DRAFT — NOT yet applied to prod. Serra applies via the tracked db-push path
-- after reviewing against `supabase migration list` (audit #110 drift caveat).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FINDING #102 — invite_funnel views are not security_invoker
-- ═══════════════════════════════════════════════════════════════════════════
-- Postgres views run with the OWNER's rights by default (security_definer
-- semantics). The two funnel views in 20260519000003_invite_funnel_views.sql
-- read user_hash + cross-user behaviour from invites / session_events /
-- raw_dumps / retention_events. With definer rights a caller that somehow
-- obtains SELECT on a view bypasses the underlying tables' RLS — the view
-- becomes an RLS hole.
--
-- FIX: recreate both views WITH (security_invoker = on) so they execute with
-- the CALLER's privileges and RLS on the base tables is enforced normally.
-- The grants are unchanged (service_role only; anon + authenticated denied),
-- re-asserted here as defense-in-depth.
--
-- `create or replace view ... with (security_invoker=on)` keeps the existing
-- view definition byte-identical to 20260519000003 — only the option changes.
-- (Requires Postgres 15+, which Supabase runs.)
-- ───────────────────────────────────────────────────────────────────────────

create or replace view public.invite_funnel
with (security_invoker = on) as
select
  i.code,
  coalesce(i.channel, 'referral')          as channel,
  i.invitee_user_hash                      as user_hash,
  i.created_at                             as invited_at,
  i.used_at                                as claimed_at,
  s.first_session_at                       as onboarded_at,
  least(d.first_dump_at, ds.first_dump_at) as first_dump_at,
  r.d1_returned_at                         as d1_returned_at,
  case
    when r.d1_returned_at is not null                              then 5
    when least(d.first_dump_at, ds.first_dump_at) is not null      then 4
    when s.first_session_at is not null                           then 3
    when i.used_at is not null                                    then 2
    else 1
  end                                      as step_reached
from public.invites i
left join lateral (
  select min(se.started_at) as first_session_at
  from public.session_events se
  where se.user_hash = i.invitee_user_hash
) s on true
left join lateral (
  select min(rd.created_at) as first_dump_at
  from public.raw_dumps rd
  where rd.user_hash = i.invitee_user_hash
) d on true
left join lateral (
  select min(se2.started_at) as first_dump_at
  from public.session_events se2
  where se2.user_hash = i.invitee_user_hash
    and coalesce(se2.brain_dumps_count, 0) > 0
) ds on true
left join lateral (
  select min(re.event_at) as d1_returned_at
  from public.retention_events re
  where re.user_hash = i.invitee_user_hash
    and re.event_type = 'd1_returned'
) r on true;

comment on view public.invite_funnel is
  'One row per invite code with the activation step each invited user reached (1=invited .. 5=d1_returned). security_invoker=on (audit #102).';

create or replace view public.invite_funnel_by_channel
with (security_invoker = on) as
select
  channel,
  count(*)                                    as invited,
  count(*) filter (where step_reached >= 2)   as claimed,
  count(*) filter (where step_reached >= 3)   as onboarded,
  count(*) filter (where step_reached >= 4)   as first_dump,
  count(*) filter (where step_reached >= 5)   as d1_returned
from public.invite_funnel
group by channel
order by invited desc;

comment on view public.invite_funnel_by_channel is
  'Activation funnel counts per acquisition channel. Headline marketing readout. security_invoker=on (audit #102).';

-- Re-assert the lock-down grants (idempotent; lint guard against ever granting
-- these cross-user views to end-user roles).
revoke all on public.invite_funnel from anon, authenticated;
revoke all on public.invite_funnel_by_channel from anon, authenticated;
grant select on public.invite_funnel to service_role;
grant select on public.invite_funnel_by_channel to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- FINDING #114 — worker tables created without IF NOT EXISTS
-- ═══════════════════════════════════════════════════════════════════════════
-- These tables were created with a bare `CREATE TABLE` (no IF NOT EXISTS), so
-- the original migrations are non-idempotent and would error on replay:
--
--   public.routing_cache            (20260521000001_routing_cache.sql)
--   public.grocery_purchase_history (20260522000001_grocery_purchase_history.sql)
--   public.cook_history             (20260522000002_cook_history.sql)
--   public.partner_codes            (20260602103016_partner_bilateral_sync.sql)
--   public.partner_pairs            (20260602103016_partner_bilateral_sync.sql)
--   public.partner_snapshots        (20260602103016_partner_bilateral_sync.sql)
--
-- (The audit said "four"; the actual list is six across four migration files —
-- the partner migration creates three. Verified by grep over supabase/migrations.)
--
-- DECISION (audit #114 explicitly leaves this to our call): we do NOT edit the
-- already-applied migration files. Migrations run exactly once and are tracked
-- by checksum in the supabase_migrations ledger; rewriting an applied file
-- causes history drift (the live audit-#110 finding) for zero runtime benefit —
-- the migration framework never replays a recorded migration.
--
-- Idempotency for a future cold rebuild is instead handled going forward:
--   • all of these tables now exist in prod, so this migration is a NO-OP
--     existence assertion (it does not recreate or alter them); and
--   • the table-creation template for NEW worker tables must use
--     `create table if not exists` (documented in the worker-table standard,
--     same convention as 20260618000003 / future migrations).
--
-- This block asserts the six tables exist and raises a clear error if a fresh
-- environment is missing one — surfacing the real problem (a skipped earlier
-- migration) instead of silently masking it.
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare
  missing text;
begin
  select string_agg(t, ', ')
    into missing
  from unnest(array[
    'routing_cache',
    'grocery_purchase_history',
    'cook_history',
    'partner_codes',
    'partner_pairs',
    'partner_snapshots'
  ]) as t
  where to_regclass('public.' || t) is null;

  if missing is not null then
    raise exception
      'audit #114: expected worker tables are missing in this environment: %. Apply the earlier creation migrations (20260521000001 / 20260522000001 / 20260522000002 / 20260602103016) before this one.',
      missing;
  end if;
end
$$;
