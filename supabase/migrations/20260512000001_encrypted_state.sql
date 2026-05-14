-- ollie · encrypted_state table + RLS
-- Sprint 2 · C2
--
-- Holds AES-GCM-256 ciphertexts of per-module client state. Server
-- NEVER sees plaintext. RLS makes the server unable to read across
-- users even with elevated privileges short of `service_role`.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Apply via: `supabase migration up` OR Supabase SQL editor.
--
-- Rollback: see 20260512_000001_encrypted_state.down.sql

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.encrypted_state (
  -- Primary key. Generated client-side as uuid v4 so offline writes
  -- can produce stable IDs before reaching the server.
  id          uuid primary key default gen_random_uuid(),

  -- Owner of this row. References Supabase Auth. RLS uses this column.
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- Module namespace: 'cycle', 'finance', 'grocery', 'shared', etc.
  -- One row per (user_id, module). Upserts on (user_id, module) target
  -- the latest blob.
  module      text not null check (length(module) between 1 and 64),

  -- AES-GCM ciphertext (includes 16-byte auth tag suffix).
  ciphertext  bytea not null,

  -- 12-byte random IV used for this encryption.
  iv          bytea not null check (octet_length(iv) = 12),

  -- LWW timestamp. Client supplies its wall-clock when uploading;
  -- server defaults to now() if missing.
  updated_at  timestamptz not null default now(),

  -- Optional device hint — useful for "which device pushed this last"
  -- diagnostics. NOT a security control.
  device_id   text,

  -- Schema version of the encrypted blob inside ciphertext. Lets the
  -- client cleanly migrate plaintext shapes without re-keying.
  blob_version smallint not null default 1,

  constraint encrypted_state_unique_module unique (user_id, module)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. indexes
-- ─────────────────────────────────────────────────────────────────────────

create index if not exists encrypted_state_user_module_updated_idx
  on public.encrypted_state (user_id, module, updated_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.encrypted_state_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Allow client to provide updated_at (for LWW reconciliation) but
  -- never trust it to be lower than now(). If client clock is behind
  -- we keep server time so newer writes always win.
  if new.updated_at is null or new.updated_at < now() then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists encrypted_state_touch on public.encrypted_state;
create trigger encrypted_state_touch
  before insert or update on public.encrypted_state
  for each row execute function public.encrypted_state_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.encrypted_state enable row level security;

-- Force RLS even for the table owner (defense-in-depth — anything
-- short of `service_role` should NOT bypass).
alter table public.encrypted_state force row level security;

-- Drop any older policies before re-creating (idempotent migration).
drop policy if exists encrypted_state_select_own on public.encrypted_state;
drop policy if exists encrypted_state_insert_own on public.encrypted_state;
drop policy if exists encrypted_state_update_own on public.encrypted_state;
drop policy if exists encrypted_state_delete_own on public.encrypted_state;

create policy encrypted_state_select_own
  on public.encrypted_state
  for select
  using (auth.uid() = user_id);

create policy encrypted_state_insert_own
  on public.encrypted_state
  for insert
  with check (auth.uid() = user_id);

create policy encrypted_state_update_own
  on public.encrypted_state
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy encrypted_state_delete_own
  on public.encrypted_state
  for delete
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. grants
-- ─────────────────────────────────────────────────────────────────────────

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.encrypted_state to authenticated;

-- service_role (used only by trusted server-side workers, e.g. APNs
-- worker, GDPR-erasure routine) gets full access; RLS still applies
-- but we grant the table privileges explicitly for clarity.
grant select, insert, update, delete on public.encrypted_state to service_role;

-- anon role gets NOTHING. Anonymous traffic cannot see or write
-- encrypted_state under any circumstances.
revoke all on public.encrypted_state from anon;
