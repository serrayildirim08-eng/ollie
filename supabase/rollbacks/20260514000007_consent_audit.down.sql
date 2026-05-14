-- rollback for 20260514_000007_consent_audit.sql
drop index if exists public.consent_audit_user_hash_consented_at_idx;
drop table if exists public.consent_audit;
