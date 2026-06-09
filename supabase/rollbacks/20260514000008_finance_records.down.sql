-- rollback for 20260514000008_finance_records.sql
--
-- Drops, in dependency order:
--   1. the BEFORE INSERT/UPDATE trigger (also goes with the table, but
--      dropped explicitly so re-applying the up migration is clean);
--   2. the updated_at trigger FUNCTION (NOT removed by DROP TABLE — it is
--      a standalone object);
--   3. the two delta-sync indexes;
--   4. the table itself (CASCADE clears RLS policies + the FK from any
--      dependent object).
--
-- service_role / authenticated grants vanish with the table; the
-- `grant usage on schema public` lines in the up migration are shared
-- and intentionally left in place.

drop trigger if exists finance_records_touch on public.finance_records;
drop function if exists public.finance_records_touch_updated_at();

drop index if exists public.finance_records_user_type_updated_idx;
drop index if exists public.finance_records_user_updated_idx;

drop table if exists public.finance_records cascade;
