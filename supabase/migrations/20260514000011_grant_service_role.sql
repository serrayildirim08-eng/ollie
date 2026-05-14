-- ollie · grant service_role privileges on 7 new telemetry tables
-- The Cloudflare workers (ai-proxy + cron) use Supabase service_role.
-- Default Postgres privileges did not grant table-level access; this fixes
-- the "permission denied for table" 42501 error surfaced by the worker.
--
-- Project: ykxzfzkfsolwgmheiwpx
-- Date: 2026-05-14

grant insert, select, update, delete on public.raw_dumps        to service_role;
grant insert, select, update, delete on public.enriched_signals to service_role;
grant insert, select, update, delete on public.retention_events to service_role;
grant insert, select, update, delete on public.session_events   to service_role;
grant insert, select, update, delete on public.module_events    to service_role;
grant insert, select, update, delete on public.crisis_events    to service_role;
grant insert, select, update, delete on public.consent_audit    to service_role;
