-- Rollback for 20260514000012_research_corpus
drop index if exists public.research_corpus_sector_locale_idx;
drop index if exists public.research_corpus_label_gin_idx;
drop index if exists public.research_corpus_created_at_idx;
drop index if exists public.research_corpus_sector_created_at_idx;
drop table if exists public.research_corpus;
