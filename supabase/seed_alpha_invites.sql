-- ════════════════════════════════════════════════════════════════════════
-- Ollie · alpha invite seed
-- ════════════════════════════════════════════════════════════════════════
-- Mints a batch of invite codes directly in the DB, bypassing the 5/week
-- app cap. Use to seed the closed alpha.
--
-- This is an operational script — NOT a migration. It is never auto-run.
-- Run it by hand: Supabase dashboard → SQL editor.
--
-- HOW TO USE:
--   1. Edit the two values in the `params` block below:
--        n_codes  — how many codes to mint
--        channel  — the acquisition-channel tag (lowercase, e.g. 'twitter')
--   2. Run. The minted codes + share URLs print at the end.
--   3. Repeat once per channel (change `channel`, re-run).
--
-- Prereq: migration 20260519000002_invites_channel.sql must be applied
-- first (this script writes the `channel` column).
--
-- Codes expire 90 days out. inviter_user_hash is the sentinel 'seed'.
-- ════════════════════════════════════════════════════════════════════════

with params as (
  select
    20         as n_codes,    -- ← how many codes
    'twitter'  as channel     -- ← channel tag (lowercase)
),
minted as (
  insert into public.invites (code, inviter_user_hash, channel, expires_at)
  select
    'olli-' || seg1 || '-' || seg2,
    'seed',
    p.channel,
    now() + interval '90 days'
  from params p
  cross join generate_series(1, p.n_codes) g
  -- two independent 4-char segments from the worker's 31-char alphabet
  -- (lowercase letters + digits, ambiguous 0/o/1/l/i removed)
  cross join lateral (
    select string_agg(
      substr('abcdefghjkmnpqrstuvwxyz23456789',
             1 + floor(random() * 31)::int, 1), '')
    from generate_series(1, 4)
  ) a(seg1)
  cross join lateral (
    select string_agg(
      substr('abcdefghjkmnpqrstuvwxyz23456789',
             1 + floor(random() * 31)::int, 1), '')
    from generate_series(1, 4)
  ) b(seg2)
  -- vanishingly unlikely with a 31^8 keyspace; if it ever happens the
  -- colliding row is skipped — just re-run to top the batch back up.
  on conflict (code) do nothing
  returning code, channel, expires_at
)
select
  code,
  channel,
  expires_at,
  'https://ollie.app/join/' || code as share_url
from minted
order by code;
