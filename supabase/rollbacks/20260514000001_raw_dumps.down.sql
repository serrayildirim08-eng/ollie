-- rollback for 20260514_000001_raw_dumps.sql
drop index if exists public.raw_dumps_routing_module_idx;
drop index if exists public.raw_dumps_country_created_at_idx;
drop index if exists public.raw_dumps_user_hash_created_at_idx;
drop table if exists public.raw_dumps;
