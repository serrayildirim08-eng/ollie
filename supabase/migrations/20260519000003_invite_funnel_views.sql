-- ollie · activation-funnel views (marketing engineering · Faz 1)
--
-- Stitches the five activation steps an invited user passes through into
-- one row per invite, then aggregates by channel. No new event tables —
-- every step is read from instrumentation that already exists.
--
--   step 1  invited        — invites row exists
--   step 2  claimed        — invites.used_at set (code redeemed at signup)
--   step 3  onboarded      — first session_events row (crossed into the app)
--   step 4  first_dump     — first brain-dump (raw_dumps OR a session that
--                            logged brain_dumps_count > 0 — the session
--                            signal survives even if the user opted out of
--                            research-corpus collection, so step 4 is not
--                            undercounted by consent)
--   step 5  d1_returned    — retention_events row, event_type 'd1_returned'
--
-- Scope: only INVITED users appear here. Organic installs with no invite
-- have no invites row — correct for a closed, invite-only alpha.
--
-- Join key: invites.invitee_user_hash == the user_hash used across all
-- telemetry tables (both are SHA-256(email + salt) with the same salt).
-- Unclaimed codes have a NULL invitee_user_hash, so steps 3-5 are NULL
-- for them — they sit at step_reached = 1.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-19
-- Rollback: drop view public.invite_funnel_by_channel; drop view public.invite_funnel;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. per-invite funnel — one row per invite code
-- ─────────────────────────────────────────────────────────────────────────

create or replace view public.invite_funnel as
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
  'One row per invite code with the activation step each invited user reached (1=invited .. 5=d1_returned).';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. funnel rolled up by channel — the headline marketing table
-- ─────────────────────────────────────────────────────────────────────────

create or replace view public.invite_funnel_by_channel as
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
  'Activation funnel counts per acquisition channel. Headline marketing-engineering readout.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. grants — these views expose user_hashes + behaviour across all users,
--    so they stay locked to service_role. End-users get nothing; the views
--    are read from the Supabase dashboard / SQL editor (privileged) or the
--    worker. anon + authenticated are explicitly denied.
-- ─────────────────────────────────────────────────────────────────────────

revoke all on public.invite_funnel from anon, authenticated;
revoke all on public.invite_funnel_by_channel from anon, authenticated;
grant select on public.invite_funnel to service_role;
grant select on public.invite_funnel_by_channel to service_role;
