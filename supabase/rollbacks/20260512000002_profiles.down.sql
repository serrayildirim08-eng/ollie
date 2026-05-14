-- rollback for 20260512_000002_profiles.sql
drop trigger if exists profiles_touch on public.profiles;
drop function if exists public.profiles_touch_updated_at();
drop table if exists public.profiles cascade;
