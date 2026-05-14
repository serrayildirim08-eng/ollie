-- ollie · plaid_inbox staging table + RLS
-- Sprint 6 · Plaid sandbox scaffolding
--
-- Webhook-driven staging table. The plaid-sync Cloudflare Worker
-- inserts encrypted payloads here when Plaid pushes a transactions
-- update (the worker cannot reach the user's encryption key).
--
-- Lifecycle:
--   1. worker receives a verified webhook
--   2. worker server-side encrypts a payload (sync-marker, tombstones)
--      with PLAID_INBOX_ENCRYPTION_KEY (held only in worker env)
--   3. worker inserts a row here via service-role
--   4. client polls this table on next session
--   5. client decrypts using the worker's unwrap helper (or via a
--      worker route that returns the plaintext per row id)
--   6. client re-encrypts with the user's @ollie/crypto key and
--      writes to finance_records
--   7. client deletes the staging row
--
-- Steady state holds ZERO rows. Worst case (DB breach during flight)
-- leaks only the rows currently in flight — never the user's full
-- bank-data history (which is encrypted under the user's key in
-- finance_records, server can't read).
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-14

-- ─────────────────────────────────────────────────────────────────────────
-- 1. table
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.plaid_inbox (
  id                            uuid primary key default gen_random_uuid(),

  -- Owner. RLS pivots on this.
  user_id                       uuid not null references auth.users(id) on delete cascade,

  -- Plaid item_id — denormalized for routing convenience. Worker
  -- fills this from the verified webhook payload.
  item_id                       text not null,

  -- Discriminator. The client switches on this to know what to do:
  --   sync_marker — a signal that "there are new transactions on
  --                  Plaid's side; pull them via /transactions/sync".
  --                  Payload contains the webhook reason (DEFAULT_UPDATE,
  --                  SYNC_UPDATES_AVAILABLE, INITIAL_UPDATE, etc.)
  --   tombstones  — list of transaction_ids that Plaid says are gone.
  --                  Client tombstones the matching finance_records rows.
  record_kind                   text not null check (record_kind in (
    'sync_marker', 'tombstones'
  )),

  -- AES-GCM-256 ciphertext under PLAID_INBOX_ENCRYPTION_KEY (held in
  -- worker env). Base64 string — server is opaque to clients during
  -- transit; only the worker holds the key.
  encrypted_with_server_key     text not null,

  -- 12-byte IV used by the worker for this row's encryption. Base64.
  server_iv                     text not null,

  -- Wall-clock created. The client should drain rows in created_at
  -- order to keep tombstones consistent with their parent updates.
  created_at                    timestamptz not null default now()
);

-- Drain index: client pulls `where user_id = me order by created_at asc`.
create index if not exists plaid_inbox_user_created_idx
  on public.plaid_inbox (user_id, created_at asc);

-- Worker writes filtered by item_id during stage operations.
create index if not exists plaid_inbox_item_idx
  on public.plaid_inbox (item_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RLS
-- ─────────────────────────────────────────────────────────────────────────

alter table public.plaid_inbox enable row level security;
alter table public.plaid_inbox force row level security;

drop policy if exists plaid_inbox_select_own on public.plaid_inbox;
drop policy if exists plaid_inbox_delete_own on public.plaid_inbox;

-- Client can READ + DELETE own rows. Inserts are service-role only
-- (the worker stages; no client path inserts here).
create policy plaid_inbox_select_own
  on public.plaid_inbox
  for select
  using (auth.uid() = user_id);

create policy plaid_inbox_delete_own
  on public.plaid_inbox
  for delete
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. grants
-- ─────────────────────────────────────────────────────────────────────────

grant usage on schema public to authenticated;
-- NB: no INSERT for authenticated. Worker (service-role) is the only
-- writer. UPDATE is also out — staging rows are immutable, then drained.
grant select, delete on public.plaid_inbox to authenticated;

-- service_role: full access for the plaid-sync worker.
grant select, insert, update, delete on public.plaid_inbox to service_role;

-- anon: nothing.
revoke all on public.plaid_inbox from anon;
