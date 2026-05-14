-- ollie · profiles table + RLS
-- Sprint 2 · C5 follow-up (salt-roaming)
--
-- Stores per-user metadata that needs to roam across devices but is NOT
-- secret material itself. Right now: the PBKDF2 salt that the client
-- needs at sign-in to re-derive the same encryption key from the user's
-- passphrase.
--
-- Why the salt lives here (and not in encrypted_state):
--   - salt is needed BEFORE we have a CryptoKey, so it can't be inside
--     an encrypted blob.
--   - salt is non-secret on its own — security relies on the passphrase.
--     But it MUST be the same value across devices, otherwise the same
--     passphrase derives different keys on different devices and
--     encrypted_state rows from device A can't decrypt on device B.
--   - storing it server-side, scoped by user, RLS-protected, is the
--     simplest path to roaming. localStorage on the first device is
--     primary; this row is the recovery hop.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Apply via: `supabase migration up` OR Supabase SQL editor.
--
-- Rollback: see 20260512_000002_profiles.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  -- One row per user. id IS the auth.users.id (1:1 mapping, no separate
  -- profile uuid). @ollie/auth upserts on this column.
  id          uuid primary key references auth.users(id) on delete cascade,

  -- Base64-encoded 16-byte PBKDF2 salt. The client derives the
  -- AES-GCM-256 encryption key from passphrase + salt. The server NEVER
  -- sees the key or the passphrase.
  --
  -- Length cap mirrors a base64-encoded 64-byte ceiling — gives headroom
  -- if we ever lengthen the salt without a schema migration.
  salt        text not null check (length(salt) between 16 and 128),

  -- Optional display surface for the email the user signed in with.
  -- Mirrors auth.users.email for client convenience (avoids a join from
  -- the REST surface). Lower-cased on write — see the trigger below.
  email       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. indexes
-- ─────────────────────────────────────────────────────────────────────────

-- email lookups (e.g. admin tools, future "did this email already
-- register?" check). Partial index — most rows have NULL email until the
-- client mirrors it.
create index if not exists profiles_email_idx
  on public.profiles (lower(email))
  where email is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. timestamps + email lowercasing trigger
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.profiles_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Lower-case the email defensively so future case-insensitive
  -- comparisons work without `lower(...)` everywhere.
  if new.email is not null then
    new.email := lower(new.email);
  end if;

  if tg_op = 'INSERT' then
    if new.created_at is null then new.created_at := now(); end if;
    new.updated_at := now();
  else
    -- Don't trust client clock: server-time the updated_at on every
    -- update. created_at is immutable on update.
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before insert or update on public.profiles
  for each row execute function public.profiles_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_delete_own on public.profiles;

create policy profiles_select_own
  on public.profiles
  for select
  using (auth.uid() = id);

create policy profiles_insert_own
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy profiles_update_own
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy profiles_delete_own
  on public.profiles
  for delete
  using (auth.uid() = id);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. grants
-- ─────────────────────────────────────────────────────────────────────────

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;

-- service_role (trusted server-side workers, e.g. GDPR-erasure routine)
-- gets full access; RLS still applies.
grant select, insert, update, delete on public.profiles to service_role;

-- anon role gets NOTHING. Anonymous traffic cannot see or write profiles
-- under any circumstances.
revoke all on public.profiles from anon;
