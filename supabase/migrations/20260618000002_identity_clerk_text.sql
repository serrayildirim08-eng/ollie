-- ollie · Identity model 1A — Clerk-text everywhere
-- Audit 2026-06-18 · findings #22, #68 · DECISIONS.md fork 1 (decision A)
--
-- ── PROBLEM ───────────────────────────────────────────────────────────────────
-- Ollie authenticates with CLERK. Every client call to Supabase REST goes out as
-- the public anon key + a Clerk session JWT bearer (see apps/native/src/api/
-- supabase.ts + serverReminderBridge.ts). Under a Clerk JWT:
--     auth.uid()              → NULL   (no Supabase-Auth user backs the token)
--     auth.jwt() ->> 'sub'    → "user_2abc…"  (the Clerk user id, a TEXT value)
-- But six core tables key `user_id` on `uuid NOT NULL REFERENCES auth.users(id)`
-- with `auth.uid() = user_id` RLS. Consequence today:
--   • INSERTs fail — a Clerk id ("user_2abc…") is not a valid uuid.
--   • RLS denies all — auth.uid() is NULL, so `NULL = user_id` is never true,
--     and `force row level security` means even the table owner is denied.
-- The grocery_purchase_history / cook_history tables were already retyped to
-- text (20260615000001, 20260530144446). This migration brings the remaining
-- six in line so Ollie has ONE identity (Clerk text) end-to-end.
--
-- ── THE SIX TABLES (verified by reading the migrations + account-delete.ts) ────
--   1. encrypted_state   user-facing   → RLS auth.jwt()->>'sub' = user_id
--   2. finance_records   user-facing   → RLS auth.jwt()->>'sub' = user_id
--   3. scheduled_jobs    user-write + worker-drain → RLS auth.jwt()->>'sub'
--   4. push_tokens       user-facing + worker-read → RLS auth.jwt()->>'sub'
--   5. plaid_inbox       worker-write, client read/delete → RLS auth.jwt()->>'sub'
--   6. plaid_items       worker-write (webhook), client read → RLS auth.jwt()->>'sub'
-- All six were created with `user_id uuid NOT NULL REFERENCES auth.users(id)
-- ON DELETE CASCADE` and `auth.uid()`-based policies. The worker paths use
-- service_role, which is BYPASSRLS and therefore unaffected by the policy
-- rewrite — the worker keeps full access regardless.
--
-- ── WHY jwt-sub for ALL SIX (not service-role-only) ───────────────────────────
-- Every one of these tables has at least one DIRECT client surface that runs as
-- (anon key + Clerk JWT), so each needs a self-row policy keyed on the Clerk id:
--   • encrypted_state / finance_records — the @ollie/sync client upserts + reads
--     its own rows directly.
--   • scheduled_jobs — the client INSERTs jobs via scheduleServerJob() (durable
--     reminder path); the cron worker drains via service_role.
--   • push_tokens — the client registers/de-registers its own device tokens; the
--     cron worker reads all via service_role.
--   • plaid_inbox / plaid_items — client READs (and plaid_inbox DELETEs) own rows;
--     the plaid-sync worker writes via service_role.
-- None of these are write-only worker tables, so none get the service-role-ONLY
-- treatment (that pattern is reserved for dump_inbox / grocery_pantry / routing_
-- cache, which have NO client surface and are untouched here).
--
-- ── DATA / PROD-STATE NOTES (read before applying) ────────────────────────────
--   • encrypted_state, finance_records, scheduled_jobs, push_tokens MAY hold prod
--     rows from real dogfood/alpha use. The `user_id TYPE text USING user_id::text`
--     cast PRESERVES every existing row — uuid → its canonical text form (a safe
--     widening cast, identical to the proven 20260615000001 grocery migration).
--     Any such legacy rows keep a uuid-shaped user_id string; they simply won't
--     match a Clerk JWT's sub. That is acceptable (they were already unreadable
--     under the broken auth.uid() policy) and avoids destructive deletion.
--   • plaid_items / plaid_inbox are product-DEAD: bank linking was removed
--     entirely (commit 47a6fa6); the tables were intentionally LEFT in place but
--     are expected to be EMPTY. Retyped here only for schema consistency + so the
--     account-delete sweep (account-delete.ts lists both) and any stray row stay
--     coherent. ⚠ HUMAN REVIEW: if you prefer, these two could instead be DROPPED
--     — left them in to match the "leave in place" product decision.
--
-- ── SAFETY / IDEMPOTENCY ──────────────────────────────────────────────────────
--   • Every DROP is `IF EXISTS`. Re-running is safe.
--   • ALTER COLUMN ... TYPE text is a no-op if already text (re-run safe), but
--     the FK drop + policy drops must precede it (a uuid-typed FK/policy blocks
--     the type change). Order per table: drop policies → drop FK → alter type →
--     recreate policies.
--   • RLS stays ENABLED + FORCE on every table (defense-in-depth; service_role
--     still bypasses by design).
--   • Project: ykxzfzkfsolwgmheiwpx (East US). APPLIED BY SERRA (prod creds).

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. encrypted_state  (user-facing)
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists encrypted_state_select_own on public.encrypted_state;
drop policy if exists encrypted_state_insert_own on public.encrypted_state;
drop policy if exists encrypted_state_update_own on public.encrypted_state;
drop policy if exists encrypted_state_delete_own on public.encrypted_state;

-- The FK to auth.users(id) is on the uuid column; it must go before the retype.
-- Default constraint name is <table>_<col>_fkey.
alter table public.encrypted_state
  drop constraint if exists encrypted_state_user_id_fkey;

alter table public.encrypted_state
  alter column user_id type text using user_id::text;

alter table public.encrypted_state enable row level security;
alter table public.encrypted_state force row level security;

create policy encrypted_state_select_own on public.encrypted_state
  for select using (auth.jwt() ->> 'sub' = user_id);
create policy encrypted_state_insert_own on public.encrypted_state
  for insert with check (auth.jwt() ->> 'sub' = user_id);
create policy encrypted_state_update_own on public.encrypted_state
  for update using (auth.jwt() ->> 'sub' = user_id)
              with check (auth.jwt() ->> 'sub' = user_id);
create policy encrypted_state_delete_own on public.encrypted_state
  for delete using (auth.jwt() ->> 'sub' = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. finance_records  (user-facing)
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists finance_records_select_own on public.finance_records;
drop policy if exists finance_records_insert_own on public.finance_records;
drop policy if exists finance_records_update_own on public.finance_records;
drop policy if exists finance_records_delete_own on public.finance_records;

alter table public.finance_records
  drop constraint if exists finance_records_user_id_fkey;

alter table public.finance_records
  alter column user_id type text using user_id::text;

alter table public.finance_records enable row level security;
alter table public.finance_records force row level security;

create policy finance_records_select_own on public.finance_records
  for select using (auth.jwt() ->> 'sub' = user_id);
create policy finance_records_insert_own on public.finance_records
  for insert with check (auth.jwt() ->> 'sub' = user_id);
create policy finance_records_update_own on public.finance_records
  for update using (auth.jwt() ->> 'sub' = user_id)
              with check (auth.jwt() ->> 'sub' = user_id);
create policy finance_records_delete_own on public.finance_records
  for delete using (auth.jwt() ->> 'sub' = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. scheduled_jobs  (client INSERTs own jobs · cron worker drains via service_role)
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists scheduled_jobs_select_own on public.scheduled_jobs;
drop policy if exists scheduled_jobs_insert_own on public.scheduled_jobs;
drop policy if exists scheduled_jobs_update_own on public.scheduled_jobs;
drop policy if exists scheduled_jobs_delete_own on public.scheduled_jobs;

alter table public.scheduled_jobs
  drop constraint if exists scheduled_jobs_user_id_fkey;

alter table public.scheduled_jobs
  alter column user_id type text using user_id::text;

alter table public.scheduled_jobs enable row level security;
alter table public.scheduled_jobs force row level security;

create policy scheduled_jobs_select_own on public.scheduled_jobs
  for select using (auth.jwt() ->> 'sub' = user_id);
create policy scheduled_jobs_insert_own on public.scheduled_jobs
  for insert with check (auth.jwt() ->> 'sub' = user_id);
create policy scheduled_jobs_update_own on public.scheduled_jobs
  for update using (auth.jwt() ->> 'sub' = user_id)
              with check (auth.jwt() ->> 'sub' = user_id);
create policy scheduled_jobs_delete_own on public.scheduled_jobs
  for delete using (auth.jwt() ->> 'sub' = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. push_tokens  (client registers own tokens · cron worker reads via service_role)
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists push_tokens_select_own on public.push_tokens;
drop policy if exists push_tokens_insert_own on public.push_tokens;
drop policy if exists push_tokens_update_own on public.push_tokens;
drop policy if exists push_tokens_delete_own on public.push_tokens;

alter table public.push_tokens
  drop constraint if exists push_tokens_user_id_fkey;

alter table public.push_tokens
  alter column user_id type text using user_id::text;

alter table public.push_tokens enable row level security;
alter table public.push_tokens force row level security;

create policy push_tokens_select_own on public.push_tokens
  for select using (auth.jwt() ->> 'sub' = user_id);
create policy push_tokens_insert_own on public.push_tokens
  for insert with check (auth.jwt() ->> 'sub' = user_id);
create policy push_tokens_update_own on public.push_tokens
  for update using (auth.jwt() ->> 'sub' = user_id)
              with check (auth.jwt() ->> 'sub' = user_id);
create policy push_tokens_delete_own on public.push_tokens
  for delete using (auth.jwt() ->> 'sub' = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. plaid_inbox  (PRODUCT-DEAD; worker-write, client read/delete) — see header ⚠
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists plaid_inbox_select_own on public.plaid_inbox;
drop policy if exists plaid_inbox_delete_own on public.plaid_inbox;

alter table public.plaid_inbox
  drop constraint if exists plaid_inbox_user_id_fkey;

alter table public.plaid_inbox
  alter column user_id type text using user_id::text;

alter table public.plaid_inbox enable row level security;
alter table public.plaid_inbox force row level security;

-- Matches the original surface: client may SELECT + DELETE own rows; INSERTs are
-- service_role only (the worker stages).
create policy plaid_inbox_select_own on public.plaid_inbox
  for select using (auth.jwt() ->> 'sub' = user_id);
create policy plaid_inbox_delete_own on public.plaid_inbox
  for delete using (auth.jwt() ->> 'sub' = user_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. plaid_items  (PRODUCT-DEAD; worker-write via webhook, client read) — see header ⚠
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists plaid_items_select_own on public.plaid_items;
drop policy if exists plaid_items_insert_own on public.plaid_items;
drop policy if exists plaid_items_update_own on public.plaid_items;
drop policy if exists plaid_items_delete_own on public.plaid_items;

alter table public.plaid_items
  drop constraint if exists plaid_items_user_id_fkey;

alter table public.plaid_items
  alter column user_id type text using user_id::text;

alter table public.plaid_items enable row level security;
alter table public.plaid_items force row level security;

create policy plaid_items_select_own on public.plaid_items
  for select using (auth.jwt() ->> 'sub' = user_id);
create policy plaid_items_insert_own on public.plaid_items
  for insert with check (auth.jwt() ->> 'sub' = user_id);
create policy plaid_items_update_own on public.plaid_items
  for update using (auth.jwt() ->> 'sub' = user_id)
              with check (auth.jwt() ->> 'sub' = user_id);
create policy plaid_items_delete_own on public.plaid_items
  for delete using (auth.jwt() ->> 'sub' = user_id);

-- ── NOTE on profiles ──────────────────────────────────────────────────────────
-- public.profiles keys identity on `id` (1:1 with auth.users), NOT a user_id
-- column, and carries its own anon-lookup RPC machinery (20260518000001 /
-- 20260519000001). The Clerk→uuid identity mapping for profiles is a SEPARATE,
-- unresolved concern (see account-delete Clerk↔uuid gap). DELIBERATELY NOT
-- touched here — out of scope for findings #22/#68.
