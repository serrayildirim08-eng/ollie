# A6a — Server-Apply Design (≤2 pages, DESIGN ONLY — needs Serra sign-off before any A6b code)

**Date:** 2026-06-11 · **Standing decision (Serra):** all user data becomes server-readable; encrypted at rest with a **server-held key**; zero-knowledge retired.

## Problem
Today `/route/dump` is **stateless**: it returns fragments, and the **client** applies them to on-device SQLite (`dispatch.ts → handler.apply`), then fire-and-forgets a sync. So a dump that arrives while the app is **closed** (Siri TELL, a future server brain) is **lost** — nothing persists until the app runs. To be usable while closed, routed fragments must persist **server-side** and the device must **drain** them on next open.

## Current state (what we're replacing)
- **`encrypted_state`** (migration 20260512000001): one AES-GCM blob per user — server **cannot read** it. Good for privacy, useless for server-side apply/query.
- **`finance_records`** (20260514000008): per-row encrypted; same read problem.
- Apply happens only on-device; server holds opaque ciphertext.

## Target architecture

### 1. Per-domain server schema (replaces the opaque blob for *written* domains)
One table per domain we want server-applied + queryable, e.g. `grocery_pantry`, `admin_tasks`, `finance_transactions`, `work_tasks`, `reminders`. Each row:
`id, user_id, domain, payload jsonb (server-readable), updated_at, device_origin, deleted bool`.
- **At rest:** column-level encryption with a **server-held KMS key** (pgcrypto or app-layer envelope) — readable by our workers, not world-readable. Satisfies "encrypted at rest, server holds key."
- Keeps `encrypted_state` for **read-only-on-device** domains we don't need server-side (cycle, mood detail) — migrate domains incrementally.

### 2. Fragment inbox
New table `dump_inbox`: `id, user_id, fragment jsonb, routed_module, status (pending|applied|failed), created_at, applied_at`.
- `/route/dump` (and Siri TELL) **writes routed fragments here server-side** after classification — this is the durability fix.
- A server **apply worker** (cron or inline) reads `pending`, applies each fragment to its per-domain table (idempotent on a stable fragment id), marks `applied`.

### 3. Server-side apply of /route/dump
- `/route/dump` keeps returning fragments (for instant client UX) **and** writes them to `dump_inbox`.
- Apply worker (reuse `workers/cron`) drains inbox → per-domain tables. Idempotency key = fragment id (already stable), so a fragment never double-applies.

### 4. Device sync-down + conflict rule
- On app open / focus, device pulls per-domain rows `WHERE updated_at > last_pulled_at`.
- **Conflict rule: last-writer-wins by `updated_at`**, with `device_origin` as a tiebreaker for same-ms. Deletes propagate via `deleted=true` tombstones (kept 30d).
- Local optimistic writes still happen immediately; the pull reconciles. A local write that lost to a newer server row is overwritten (LWW) — acceptable for this data (notes/tasks/pantry), no financial-ledger semantics needed.

### 5. Migration path (incremental, reversible)
1. Add `dump_inbox` + 1 pilot domain table (`grocery_pantry`) behind a flag. Dual-write: client keeps local SQLite as source of truth; server apply runs in shadow.
2. Verify server rows match device for the pilot domain (1–2 weeks dogfood).
3. Flip the pilot domain to server-authoritative (device pulls). Repeat per domain.
4. `encrypted_state` stays for un-migrated domains; remove a domain's blob slice only after its table is authoritative.

## Explicit risks
1. **Privacy posture shift** — server can now read user data. This is the standing decision, but it's a real change; needs a consent-copy + DPA review before beta (ties to existing consent toggles).
2. **Key management** — a server-held KMS key is now a single high-value target. Rotation + access-logging required; a leak exposes plaintext.
3. **LWW data loss** — last-writer-wins can silently drop a concurrent edit. Fine for tasks/pantry; **must NOT** be used for any append-only/ledger data (finance amounts) — those need append semantics, not LWW.
4. **Idempotency correctness** — apply worker must be exactly-once-effect on fragment id; a bug double-applies (e.g. duplicate pantry items). Needs a dedupe test suite before flipping authoritative.
5. **Sync-down cost/latency** — per-open pulls add worker load + battery; needs delta-only pulls + backoff.
6. **Inbox backlog** — if the apply worker stalls, dumps sit `pending` and the device shows stale state; needs alerting on inbox depth.
7. **Migration window double-source** — dual-write phase can drift; the shadow-compare gate (step 2) must pass before flipping.

## Open product decisions (need Serra)
- **D1:** Encryption approach — pgcrypto column encryption vs app-layer envelope encryption (worker-side)? (Recommend app-layer envelope: keys never in DB.)
- **D2:** Which domains go server-authoritative first, and which stay device-only? (Recommend pilot = grocery_pantry; keep cycle/mood detail device-only initially.)
- **D3:** Consent copy — how we tell users "Ollie's servers now read your data to work while the app is closed."

---
**HARD STOP.** No A6b (server-apply code) until Serra signs off on this doc + answers D1–D3.
