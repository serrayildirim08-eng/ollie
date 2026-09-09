-- A6b migration step 1 — server-apply pilot (dump_inbox + grocery_pantry).
--
-- Both tables hold ONLY app-layer envelope-encrypted payloads: the worker holds
-- the KEK (never in DB), generates a per-row DEK, encrypts the payload with the
-- DEK, and stores ciphertext + iv + wrapped DEK. Postgres sees only ciphertext.
-- (A6a D1 + Serra's extra condition: the inbox payload is encrypted too.)
--
-- Access is service-role only — these are written/read by the CF workers using
-- the Clerk user id (text), not Supabase auth.uid(). No public RLS policies.

-- ── dump_inbox ───────────────────────────────────────────────────────────────
-- Durable landing zone for routed fragments. /route/dump (incl. Siri TELL while
-- the app is closed) writes here; the apply worker drains pending → per-domain.
create table if not exists public.dump_inbox (
  id            text primary key,            -- stable fragment id → idempotency
  user_id       text not null,               -- Clerk user id
  routed_module text not null,
  ciphertext    text not null,               -- base64 AES-GCM(payload, DEK)
  iv            text not null,               -- base64 nonce for the payload
  wrapped_dek   text not null,               -- base64 AES-GCM(DEK, KEK)
  dek_iv        text not null,               -- base64 nonce for the DEK wrap
  status        text not null default 'pending'
                  check (status in ('pending', 'applied', 'failed')),
  created_at    timestamptz not null default now(),
  applied_at    timestamptz
);

create index if not exists dump_inbox_pending_idx
  on public.dump_inbox (user_id, created_at)
  where status = 'pending';

alter table public.dump_inbox enable row level security;
grant select, insert, update, delete on public.dump_inbox to service_role;

-- ── grocery_pantry (pilot domain) ────────────────────────────────────────────
-- Server-authoritative-capable per-domain table. Shadow mode initially: the
-- device keeps local SQLite as source of truth; server apply runs alongside and
-- the device pulls rows it doesn't have. LWW by updated_at; deletes = tombstone.
create table if not exists public.grocery_pantry (
  id            text not null,               -- stable item id (matches device)
  user_id       text not null,               -- Clerk user id
  ciphertext    text not null,               -- base64 AES-GCM(payload, DEK)
  iv            text not null,
  wrapped_dek   text not null,
  dek_iv        text not null,
  updated_at    timestamptz not null default now(),
  device_origin text,
  deleted       boolean not null default false,
  primary key (user_id, id)
);

create index if not exists grocery_pantry_pull_idx
  on public.grocery_pantry (user_id, updated_at);

alter table public.grocery_pantry enable row level security;
grant select, insert, update, delete on public.grocery_pantry to service_role;
