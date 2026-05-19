-- ollie · seed the closed-alpha invite cohort (marketing engineering · Faz 1)
--
-- Mints 20 invite codes for the closed alpha, bypassing the in-app
-- 5/week cap. One-time seed — guarded so it inserts nothing if a seed
-- batch already exists (inviter_user_hash = 'seed').
--
-- Channel is 'personal': the alpha cohort is hand-picked, so every code
-- reads as a personal invite in invite_funnel_by_channel. Mint codes for
-- other channels later with supabase/seed_alpha_invites.sql.
--
-- Codes expire 90 days out. Share URLs are https://ollie.app/join/<code>.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-19
-- Rollback: delete from public.invites where inviter_user_hash = 'seed';

insert into public.invites (code, inviter_user_hash, channel, expires_at)
select
  'olli-' || seg1 || '-' || seg2,
  'seed',
  'personal',
  now() + interval '90 days'
from generate_series(1, 20) g
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
-- guard: skip entirely if a seed batch already exists
where not exists (
  select 1 from public.invites where inviter_user_hash = 'seed'
)
on conflict (code) do nothing;
