-- Rollback for 20260515000001_notification_delivery.sql

drop table if exists public.push_tokens cascade;
drop function if exists public.push_tokens_touch_updated_at();

drop index if exists public.scheduled_jobs_sent_today_idx;

alter table public.scheduled_jobs
  drop column if exists sent_at,
  drop column if exists daily_cap,
  drop column if exists notification_category,
  drop column if exists category_muted;

-- Restore the original status CHECK from 20260513000001_scheduled_jobs.sql.
alter table public.scheduled_jobs
  drop constraint if exists scheduled_jobs_status_check;

alter table public.scheduled_jobs
  add constraint scheduled_jobs_status_check
  check (status in ('pending', 'fired', 'failed', 'cancelled'));
