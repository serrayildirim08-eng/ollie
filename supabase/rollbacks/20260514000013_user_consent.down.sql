-- Rollback for 20260514000013_user_consent
drop trigger if exists user_consent_touch_updated_at on public.user_consent;
drop function if exists public.user_consent_touch_updated_at();
drop index if exists public.user_consent_research_optin_idx;
drop table if exists public.user_consent;
