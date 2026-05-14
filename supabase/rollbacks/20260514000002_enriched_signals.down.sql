-- rollback for 20260514_000002_enriched_signals.sql
drop index if exists public.enriched_signals_sentiment_created_at_idx;
drop index if exists public.enriched_signals_topic_idx;
drop index if exists public.enriched_signals_brands_gin_idx;
drop index if exists public.enriched_signals_sectors_gin_idx;
drop index if exists public.enriched_signals_user_hash_created_at_idx;
drop table if exists public.enriched_signals;
