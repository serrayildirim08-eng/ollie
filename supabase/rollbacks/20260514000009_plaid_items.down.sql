-- rollback for 20260514000009_plaid_items.sql
--
-- Drops, in dependency order:
--   1. the BEFORE INSERT/UPDATE trigger;
--   2. the updated_at trigger FUNCTION (standalone object — NOT removed
--      by DROP TABLE);
--   3. the unique (user_id, item_id) index + the item_id lookup index;
--   4. the table itself (CASCADE clears RLS policies).
--
-- Grants vanish with the table; the shared `grant usage on schema public`
-- line in the up migration is intentionally left in place.

drop trigger if exists plaid_items_touch on public.plaid_items;
drop function if exists public.plaid_items_touch_updated_at();

drop index if exists public.plaid_items_item_idx;
drop index if exists public.plaid_items_user_item_unique;

drop table if exists public.plaid_items cascade;
