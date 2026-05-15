-- ollie · notification delivery · Sprint B' · P1 unblock
--
-- This migration makes the SERVER-SIDE notification drain
-- (`flushNotificationQueue()` in workers/cron) runnable end-to-end:
--
--   1. Extends `scheduled_jobs` with the delivery-side columns the cron
--      worker writes: new terminal statuses + sent_at + the worker-readable
--      budget/category fields the client stamps at schedule time.
--   2. Adds `push_tokens` — the device-token registry the drain joins on
--      to find where to deliver. Tokens previously lived ONLY in the
--      ollie-notifications KV namespace (apps/api worker); KV is not
--      joinable from the cron drain, so we mirror them into Postgres.
--
-- Project: ykxzfzkfsolwgmheiwpx (East US)
-- Date: 2026-05-15
-- Rollback: 20260515000001_notification_delivery.down.sql
--
-- ── Why the new scheduled_jobs statuses ───────────────────────────────────
-- The original lifecycle was pending → fired | failed | cancelled. The
-- delivery drain needs a richer terminal vocabulary so ops can tell WHY a
-- job didn't deliver:
--   'sent'           — delivered to APNs successfully (replaces 'fired'
--                      semantically for the drain; 'fired' is kept VALID so
--                      the legacy apps/api cron loop does not break).
--   'rejected'       — payload failed the banned-phrase scanner; never sent.
--   'budget_skipped' — user is over their daily notification cap.
--   'muted'          — the job's category is muted by the user.
-- 'fired' is intentionally LEFT in the allowed set: the apps/api worker's
-- runCron() still writes it. Do not remove it until that worker is retired.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. scheduled_jobs — extend status CHECK + delivery columns
-- ─────────────────────────────────────────────────────────────────────────

alter table public.scheduled_jobs
  drop constraint if exists scheduled_jobs_status_check;

alter table public.scheduled_jobs
  add constraint scheduled_jobs_status_check
  check (status in (
    'pending',
    'fired',            -- legacy apps/api worker terminal state
    'sent',             -- cron drain: delivered to APNs
    'rejected',         -- cron drain: failed banned-phrase scan
    'budget_skipped',   -- cron drain: over daily cap
    'muted',            -- cron drain: category muted
    'failed',
    'cancelled'
  ));

-- When the drain delivers, it stamps sent_at. Distinct from the legacy
-- fired_at column (which the apps/api worker stamps) so both code paths
-- can coexist without clobbering each other's audit timestamps.
alter table public.scheduled_jobs
  add column if not exists sent_at timestamptz;

-- Worker-readable budget snapshot. The notification budget (daily cap +
-- muted categories) lives in the user's AES-GCM encrypted state, which the
-- worker CANNOT decrypt. So the CLIENT — which can read its own budget —
-- stamps these two fields onto the job row at schedule time via
-- scheduleServerJob(). The drain then enforces the cap server-side by
-- counting today's 'sent' jobs for the user against `daily_cap`.
--
--   daily_cap            — 1..10, the user's configured cap (default 4).
--   notification_category — REMINDER | PATTERN_ALERT | CONTENT_DELIVERY,
--                           used for the per-category mute check.
--   category_muted        — true if the user had this category muted at
--                           schedule time (defense-in-depth; the client
--                           already suppresses muted categories before
--                           calling scheduleServerJob, but a job could be
--                           queued before a later mute toggle).
alter table public.scheduled_jobs
  add column if not exists daily_cap smallint not null default 4
    check (daily_cap between 1 and 10);

alter table public.scheduled_jobs
  add column if not exists notification_category text
    check (notification_category is null or notification_category in (
      'REMINDER', 'PATTERN_ALERT', 'CONTENT_DELIVERY'
    ));

alter table public.scheduled_jobs
  add column if not exists category_muted boolean not null default false;

-- The drain's hot scan path: "pending jobs whose fire_at elapsed, oldest
-- first". The existing scheduled_jobs_pending_due_idx (status, fire_at)
-- partial index already serves this — no new index needed.

-- Count-today's-sent-per-user query for the budget check. Partial index
-- keeps it tiny — only delivered rows, scanned by (user_id, sent_at).
create index if not exists scheduled_jobs_sent_today_idx
  on public.scheduled_jobs (user_id, sent_at)
  where status = 'sent';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. push_tokens — device-token registry
-- ─────────────────────────────────────────────────────────────────────────
--
-- One row per (user, device_token). A user with multiple devices has
-- multiple rows — the drain delivers to ALL of them. `device_token` is the
-- APNs hex token; it is the natural key but we keep a uuid PK so updates
-- (e.g. token rotation) are simple upserts on the unique (user_id, token).

create table if not exists public.push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  device_token  text not null check (length(device_token) between 8 and 200),
  platform      text not null default 'ios'
                  check (platform in ('ios', 'macos')),
  -- Bumped every time the client re-registers the same token, so a stale
  -- token can be pruned by age if APNs starts returning BadDeviceToken.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- A device token is globally unique to one device; if a token moves to a
-- new user (device handed over / app reinstalled under a new account) the
-- registration upsert rebinds it. Unique on the token alone enforces that.
create unique index if not exists push_tokens_token_uniq
  on public.push_tokens (device_token);

-- Drain join path: "all tokens for this user_id".
create index if not exists push_tokens_user_idx
  on public.push_tokens (user_id);

-- Keep updated_at honest on upsert.
create or replace function public.push_tokens_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists push_tokens_touch on public.push_tokens;
create trigger push_tokens_touch
  before update on public.push_tokens
  for each row execute function public.push_tokens_touch_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
-- A user may read/insert/update/delete only their own token rows (so the
-- app can show "this device is registered" and de-register on sign-out).
-- The cron worker uses service_role and bypasses RLS to scan all users.

alter table public.push_tokens enable row level security;
alter table public.push_tokens force row level security;

drop policy if exists push_tokens_select_own on public.push_tokens;
drop policy if exists push_tokens_insert_own on public.push_tokens;
drop policy if exists push_tokens_update_own on public.push_tokens;
drop policy if exists push_tokens_delete_own on public.push_tokens;

create policy push_tokens_select_own
  on public.push_tokens for select
  using (auth.uid() = user_id);

create policy push_tokens_insert_own
  on public.push_tokens for insert
  with check (auth.uid() = user_id);

create policy push_tokens_update_own
  on public.push_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy push_tokens_delete_own
  on public.push_tokens for delete
  using (auth.uid() = user_id);

-- ── grants ────────────────────────────────────────────────────────────────

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;

-- service_role is the Cloudflare cron worker — it bypasses RLS to scan the
-- "all tokens across users" set when draining the notification queue.
grant select, insert, update, delete on public.push_tokens to service_role;

revoke all on public.push_tokens from anon;
