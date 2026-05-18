-- rollback for 20260514000010_plaid_inbox.sql
--
-- plaid_inbox is a webhook staging table — no trigger, no function. Drops:
--   1. the drain index + the item_id lookup index;
--   2. the table itself (CASCADE clears RLS policies).
--
-- Grants vanish with the table; the shared `grant usage on schema public`
-- line in the up migration is intentionally left in place.

drop index if exists public.plaid_inbox_item_idx;
drop index if exists public.plaid_inbox_user_created_idx;

drop table if exists public.plaid_inbox cascade;
