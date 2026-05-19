-- ollie · invites.channel — acquisition-channel tag for the activation funnel
--
-- Adds a nullable free-text channel label to each invite code so the
-- activation funnel can be sliced by where the code was seeded
-- (twitter / personal / adhd-community / …).
--
-- NULL means an in-app referral — an existing user invited a friend with
-- no explicit tag. The funnel view (20260519000003) coalesces NULL to
-- 'referral' so organic word-of-mouth shows up as its own channel.
--
-- The worker normalises the value (lowercase, trim, [a-z0-9-], <=40 chars)
-- before insert, so this column stays free-text but tidy.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-19
-- Rollback: alter table public.invites drop column channel;

alter table public.invites
  add column if not exists channel text;

create index if not exists invites_channel_idx
  on public.invites (channel);

comment on column public.invites.channel is
  'Acquisition channel the invite code was seeded through. NULL = in-app referral.';
