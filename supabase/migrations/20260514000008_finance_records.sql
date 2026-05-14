-- ollie · finance_records table + RLS
-- Sprint 5 · finance per-record encrypted sync
--
-- Per-record encrypted finance store. Unlike encrypted_state (one blob
-- per module), finance_records stores ONE row per FinanceRecord so the
-- client can do delta sync via updated_at cursor without re-uploading
-- the entire finance dataset on every change.
--
-- Server never decrypts. record_type is the ONLY plaintext column
-- besides ids + timestamps; it exists so the B2B aggregate pipeline
-- (consent-gated, separate project) can bucket by type without
-- touching ciphertext, and so the client can fetch one slice at a time.
--
-- Architectural decisions (Sprint 5):
--   1. Union table with record_type discriminator — simpler RLS, one
--      migration, fewer indexes than per-type tables.
--   2. Per-record encryption with fresh 12-byte AES-GCM IV — never
--      reuse an IV under the same key.
--   3. Whole-record blob inside ciphertext — server is opaque by
--      constitution; per-field encryption buys nothing and complicates
--      the wire format.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-14
-- Apply via: `supabase migration up` OR Supabase SQL editor.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.finance_records (
  -- Primary key. Generated client-side as uuid v4 so offline writes
  -- have stable ids before reaching the server. Matches FinanceRecord.id.
  id           uuid primary key default gen_random_uuid(),

  -- Owner. RLS pivots on this.
  user_id      uuid not null references auth.users(id) on delete cascade,

  -- Always 'finance'. Kept for symmetry with encrypted_state and to
  -- allow a future cross-module per-record table to be folded in.
  module       text not null default 'finance' check (module = 'finance'),

  -- Discriminator. Server may bucket on this for B2B aggregate counts
  -- (consent-gated, separate pipeline). Kept narrow + enum-like via
  -- CHECK so a typo in client code does not silently land.
  record_type  text not null check (record_type in (
    'bill', 'subscription', 'adhd_tax', 'savings_goal', 'transaction'
  )),

  -- AES-GCM-256 ciphertext of the JSON-serialized FinanceRecord. Includes
  -- the 16-byte auth tag suffix that AES-GCM appends.
  encrypted_payload bytea not null,

  -- 12-byte random IV used for this row. UNIQUE per (key, plaintext)
  -- is the AES-GCM security invariant — we generate a fresh IV per
  -- write client-side (see @ollie/crypto · randomIv).
  iv           bytea not null check (octet_length(iv) = 12),

  -- Schema version of the encrypted blob inside ciphertext. Lets the
  -- client cleanly migrate plaintext shapes without re-keying.
  blob_version smallint not null default 1,

  -- Soft-delete marker for tombstone-style sync (so a delete on
  -- device A propagates to device B). NULL = live, non-NULL = tombstone.
  deleted_at   timestamptz,

  -- Wall-clock timestamps. updated_at drives the delta-sync cursor.
  -- Trigger below clamps client-supplied values to never be lower
  -- than now() to keep LWW reconciliation sane across skewed clocks.
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Optional device hint for diagnostics — NOT a security control.
  device_id    text
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. indexes
-- ─────────────────────────────────────────────────────────────────────────

-- Primary delta-sync index: pull rows where updated_at > last_cursor
-- for this user, optionally filtered by record_type.
create index if not exists finance_records_user_updated_idx
  on public.finance_records (user_id, updated_at desc);

-- Type-bucket index: server-side counts for B2B aggregates (consent-
-- gated, separate pipeline reads these columns only, never the blob).
create index if not exists finance_records_user_type_updated_idx
  on public.finance_records (user_id, record_type, updated_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.finance_records_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Allow client to provide updated_at (for LWW reconciliation across
  -- devices) but never trust it to be lower than now(). If the client
  -- clock is behind, we use server time so newer writes always win.
  if new.updated_at is null or new.updated_at < now() then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists finance_records_touch on public.finance_records;
create trigger finance_records_touch
  before insert or update on public.finance_records
  for each row execute function public.finance_records_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.finance_records enable row level security;

-- Defense-in-depth — even the table owner cannot bypass RLS.
-- service_role still wins (used by GDPR erasure routine + B2B aggregate
-- worker), but no authenticated/anon path can read across users.
alter table public.finance_records force row level security;

drop policy if exists finance_records_select_own on public.finance_records;
drop policy if exists finance_records_insert_own on public.finance_records;
drop policy if exists finance_records_update_own on public.finance_records;
drop policy if exists finance_records_delete_own on public.finance_records;

create policy finance_records_select_own
  on public.finance_records
  for select
  using (auth.uid() = user_id);

create policy finance_records_insert_own
  on public.finance_records
  for insert
  with check (auth.uid() = user_id);

create policy finance_records_update_own
  on public.finance_records
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy finance_records_delete_own
  on public.finance_records
  for delete
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. grants
-- ─────────────────────────────────────────────────────────────────────────

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.finance_records to authenticated;

-- service_role: full access for GDPR erasure + the B2B aggregate
-- worker (which reads record_type counts only, never the encrypted
-- blob). RLS still applies; grants are explicit for clarity.
grant select, insert, update, delete on public.finance_records to service_role;

-- anon: nothing. Anonymous traffic cannot see finance_records under
-- any circumstances.
revoke all on public.finance_records from anon;
