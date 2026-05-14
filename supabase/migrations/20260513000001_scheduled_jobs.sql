-- ollie · scheduled_jobs · Sprint 4 · E4
--
-- Holds future-dated job specs that the Cloudflare Worker cron consumes
-- once per minute. Lets reminders fire reliably even when the client app
-- is closed.
--
-- job_type values used today:
--   'reminder_fire'    — generic reminder
--   'med_nudge'        — medication / vitamin schedule slot
--   'monthly_digest'   — savings digest (Sprint 2.5 F2)
--   'daily_reading'    — astrology / cycle daily digest
--
-- Status lifecycle: pending → fired | failed | cancelled. The worker
-- updates atomically and never deletes — history is the audit trail.
--
-- Rollback: 20260513_000001_scheduled_jobs.down.sql

create table if not exists public.scheduled_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  fire_at     timestamptz not null,
  job_type    text not null check (length(job_type) between 1 and 64),
  -- Free-form JSON payload — schema enforced at the application layer.
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending'
                check (status in ('pending', 'fired', 'failed', 'cancelled')),
  attempts    smallint not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  fired_at    timestamptz,
  -- For dedupe of idempotent reschedules (e.g. monthly digest for same
  -- year-month). Optional.
  dedupe_key  text
);

-- Fast scan path for the worker tick: "all pending jobs whose fire_at
-- has elapsed". The (status, fire_at) order matches the WHERE clause.
create index if not exists scheduled_jobs_pending_due_idx
  on public.scheduled_jobs (status, fire_at)
  where status = 'pending';

-- User scoping for the client REST surface.
create index if not exists scheduled_jobs_user_idx
  on public.scheduled_jobs (user_id, fire_at desc);

-- Idempotent reschedule lookup.
create unique index if not exists scheduled_jobs_dedupe_uniq
  on public.scheduled_jobs (user_id, dedupe_key)
  where dedupe_key is not null and status = 'pending';

-- ──────────────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────────────

alter table public.scheduled_jobs enable row level security;
alter table public.scheduled_jobs force row level security;

drop policy if exists scheduled_jobs_select_own on public.scheduled_jobs;
drop policy if exists scheduled_jobs_insert_own on public.scheduled_jobs;
drop policy if exists scheduled_jobs_update_own on public.scheduled_jobs;
drop policy if exists scheduled_jobs_delete_own on public.scheduled_jobs;

create policy scheduled_jobs_select_own
  on public.scheduled_jobs
  for select
  using (auth.uid() = user_id);

create policy scheduled_jobs_insert_own
  on public.scheduled_jobs
  for insert
  with check (auth.uid() = user_id);

create policy scheduled_jobs_update_own
  on public.scheduled_jobs
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy scheduled_jobs_delete_own
  on public.scheduled_jobs
  for delete
  using (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────
-- grants
-- ──────────────────────────────────────────────────────────────────────

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.scheduled_jobs to authenticated;

-- service_role is the Cloudflare Worker — it bypasses RLS to scan the
-- "all pending jobs across users" set.
grant select, insert, update, delete on public.scheduled_jobs to service_role;

revoke all on public.scheduled_jobs from anon;
