-- ollie · service_role privileges on Sprint B' tables
-- Sprint B' (2026-05-14) adds research_corpus + user_consent. Mirror the
-- pattern of 20260514000011_grant_service_role.sql for the new tables.

grant insert, select, update, delete on public.research_corpus to service_role;
grant insert, select, update, delete on public.user_consent    to service_role;
