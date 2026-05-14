-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase free-tier size check
-- Run this manually in the Supabase dashboard → SQL Editor.
-- Free tier ceiling: 500 MB total database size. Stay well under.
-- This file is NOT a migration (leading underscore); Supabase CLI skips it.
-- ─────────────────────────────────────────────────────────────────────────────

-- Total database size in MB.
SELECT pg_size_pretty(pg_database_size('postgres')) AS db_size;

-- Per-table size (top 20).
SELECT
  schemaname,
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS table_size,
  pg_size_pretty(pg_indexes_size(relid)) AS index_size,
  n_live_tup AS row_count
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
