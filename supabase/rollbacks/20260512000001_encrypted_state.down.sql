-- rollback for 20260512_000001_encrypted_state.sql
drop trigger if exists encrypted_state_touch on public.encrypted_state;
drop function if exists public.encrypted_state_touch_updated_at();
drop table if exists public.encrypted_state cascade;
