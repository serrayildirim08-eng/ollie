# Server-Side Cron Data Access — Design Memo

**Author:** backend-senior
**Date:** 2026-05-14
**Status:** DECISION REQUIRED — Serra sign-off blocks P6/P7 going server-side
**Related:** `workers/cron/src/index.ts`, `workers/cron/wrangler.toml`, `audits/AUDIT_body_v2.md`, memory `project_ollie_b2b_pivot`, memory `project_ollie_data_strategy`

---

## 1. Problem statement

P7 (weekly review, Sunday 19:00 local) and P6 (body-correlation registry, 03:00 daily) both ship today as **client-side schedulers** in `packages/orchestrator/src/body-weekly.ts` and `packages/orchestrator/src/body-correlations.ts`. The Cloudflare cron worker at `workers/cron/src/index.ts` has the trigger entries scaffolded (lines 42, 49, 83, 201, 223) but the handlers are intentional no-ops — the worker has service-role Supabase access but cannot decrypt `void.state.encrypted_payload` blobs because the user's AES-GCM-256 key (derived from the master passphrase in `@ollie/crypto`, see `packages/crypto/src/index.ts:23`) lives only in client memory. Result: any user who does not open the app at the trigger window misses the notification. Empirically this is the majority case for Sunday-evening weekly reviews — phones are face-down at family dinners — so the client-only fallback is leaking most of the value of those two features.

## 2. Constraints

- **Zero-knowledge dogma was relaxed by the B2B pivot** on 2026-05-14 (memory `project_ollie_b2b_pivot`). Opt-in raw text collection of brain-dump content is now allowed under consent. ZK is no longer a marketing claim, but the underlying crypto primitives in `@ollie/crypto` still ship and still work — relaxing the dogma is a positioning decision, not a license to fling plaintext at the server.
- **Sensitivity tiers are not uniform.** Per memory `project_ollie_data_strategy`:
  - Brain-dump text: collectable opt-in, PII scrubbed, Anthropic-labeled. Already flowing through `workers/ai-proxy/enrich-dump` → `workers/cron/src/drain.ts` (the existing precedent for server-side processing of formerly-encrypted user content).
  - Cycle dates: **US-jurisdiction toxic** post-Roe. Do not collect from US users at all.
  - Finance data: never explicitly relaxed; the per-record encrypted sync in `packages/sync/src/finance.ts` ("server NEVER sees plaintext finance data") remains constitutional.
  - Crisis content: counts only, no raw text.
- **Existing precedent for opt-in plaintext.** `workers/cron/src/drain.ts` already processes PII-scrubbed brain-dump text inside the worker boundary. The cron worker is therefore not a virgin trust surface — it already has secrets, already touches user content, already has the Anthropic key indirectly via ai-proxy service binding.
- **`scheduleNotification` DI is still un-threaded at app boot** (`AUDIT_body_v2.md` line 42, "Boot-layer wiring" outstanding). Whatever we pick must not assume that gap is closed first.

## 3. Options analysis

### Option A — Client-side scheduling only (status quo)

Keep `scheduleWeeklyReview()` and `scheduleBodyCorrelationPass()` as the only triggers. Server cron stubs stay no-ops. User has to open the app within the trigger window to get the computation + notification.

- **Pros:** zero key risk; ZK posture preserved verbatim; zero new code; reversible — we can swap in B/C/D later without migration. No new threat model.
- **Cons:** notification reliability is empirically ~30–40%. Sunday 19:00 local is precisely when phones are away. P7's purpose (weekly retrospective that lands in the inbox) is largely defeated. Worse, the user *doesn't know* they missed it — there is no "you have a review waiting" affordance on next open (today the orchestrator just silently re-runs).
- **Effort:** zero (already shipped).

### Option B — Key escrow with worker-side decryption

Derive a per-user "cron key" from the master passphrase at sign-in, wrap it (XChaCha or AES-KW) with a server-held envelope key, store as `void.state.cron_key_wrapped`. Worker unwraps cron-key, decrypts payload, computes, dispatches APNs.

- **Pros:** server can run any cron job over any data. Most powerful unlock — pattern detection, period prediction, subscription detection (the other three stubs at lines 157/169/178 of `workers/cron/src/index.ts`) all light up.
- **Cons:** **server now has decryptable data**, period. Envelope key is a single point of failure. Even with KMS, an attacker who compromises the worker has time-bounded access to *everyone*. Inconsistent with the finance constitution (`packages/sync/src/finance.ts:19` — "server NEVER sees plaintext finance data"). The B2B pivot relaxed *marketing*, not the underlying defense-in-depth. And this is the option we cannot reverse: once `cron_key_wrapped` is populated for users, "we never had your keys" is permanently a lie regardless of any future policy change.
- **Effort:** ~3–5 dev-weeks. Key derivation flow, wrapped-key migration for existing users, envelope key rotation infra, KMS or Cloudflare Secrets-Store integration, threat-model review with Serra, audit log of every cron decryption, RLS on the new column, fail-closed paths.

### Option C — Client pre-computes predictions, server delivers

Client orchestrator pre-computes the next 7 days of notifications (deterministic time-based ones — period predictions, supplement times, bedtime reminders) and writes them encrypted-to-a-server-key into a new `notification_queue` table: `{ user_id, scheduled_at, payload_ciphertext, deduplication_key, expires_at }`. The cron worker reads ready rows at each tick, decrypts (using a server-held key dedicated to this queue and *nothing else*), and dispatches via APNs.

- **Pros:** finance/cycle/health data never moves server-side decryptable. Server only ever sees prepared APNs payload (notification copy + a deep-link target). Aligns with the existing `packages/sync/src/finance.ts` pattern of "decisions on the client, ciphertext on the wire." Reversible — drop the queue table, you're back to A. Surface area is small and inspectable.
- **Cons:** **staleness.** A user who cancels a subscription, deletes a habit, or moves their period start retrospectively will have stale queued notifications fire until the client next syncs and re-queues. Mitigated by: (a) short queue horizon (24–72h not 7d), (b) `dedup_key` allowing the client to invalidate stale items on push, (c) client republishing the queue at every meaningful state change. Does not solve P6 (correlations need fresh data) — correlations are not deterministic forward-projections.
- **Effort:** ~1.5–2 dev-weeks. New table + RLS, new server-key, new `flushNotificationQueue` (function stub already exists at `workers/cron/src/index.ts:187`), client-side queueing pass in orchestrators, staleness mitigation, idempotency tests.

### Option D — Hybrid: C for time-deterministic, A for analytical

Use Option C for everything where the trigger time is computable in advance from current state (period prediction, supplement reminder, bedtime reminder, ovulation likely, period approaching 5d out — most of the 12 notifications in `audits/AUDIT_body_v2.md` section "12 Notification Copies"). Keep Option A for P6 and P7 specifically because correlations and weekly retrospectives genuinely need *fresh* data at trigger time, and pre-queueing a correlation 24h ahead would be lying.

- **Pros:** gets us 10/12 of the notification table reliable while preserving ZK for the analytical paths. Each piece is sized to its actual constraint instead of forcing one mechanism on both. Most of the user-visible reliability win.
- **Cons:** two code paths to maintain. P6/P7 reliability does not improve over status quo — Sunday-evening misses remain a thing for weekly review specifically.
- **Effort:** ~2 dev-weeks for the C half; A half is zero (already shipped).

### Option E — Surface-on-open as a third leg

Cheap addition orthogonal to A/B/C/D: when the client boots and detects "you had a scheduled weekly review at T-12h that did not fire," surface a non-intrusive card ("your week — open when ready"). Computation runs client-side as today; the *delivery* mechanism gains a backstop for the closed-app case.

- **Pros:** trivial to ship (~2 dev-days). Recovers maybe 50% of the missed-push value without any server-side data exposure. Composes with any of A/B/C/D.
- **Cons:** not a real push; user must open the app at some point during the week. Does not help with truly time-sensitive triggers (period due tomorrow).
- **Effort:** ~2 dev-days.

## 4. Recommendation — **Option D + E**

Ship **Option E** (surface-on-open backstop) inside one sprint as a guaranteed reliability floor for *every* scheduled feature, regardless of what we do server-side. Then plan **Option D** (queue-based delivery for time-deterministic notifications, leave P6/P7 on client compute) as the followup work.

Rationale:

1. **P6 and P7 are the wrong wedge to break the ZK posture on.** The weekly review and correlation pass are the most valuable cron *features* but the least time-sensitive deliveries — a Sunday review at 19:15 or 20:00 is fine; a Sunday review the user sees at 22:30 when they next open the app is *also* fine. Option E covers both of those for free.
2. **The high-value reliable pushes are the deterministic ones** — "period due tomorrow", "vitamin D reminder daily 8am", "wind-down in 60min". Those have clean Option-C semantics: client knows the time, knows the copy, can queue 24h ahead.
3. **Option B is a one-way door.** Once we provision `cron_key_wrapped` for users we cannot unprovision it without making them re-onboard. Given the finance constitution still holds and the B2B pivot didn't actually request key escrow, choosing B now buys power we don't need at a cost we can't undo.
4. **Reversibility matters more than maximum power right now.** Atelier's data sensitivity story is still being negotiated externally (legal copy is being drafted per `feedback_ollie_opt_in_default`). D + E preserves every future option including B if the threat model and customer asks justify it later.
5. **Engineering load is sized to the sprint** — D is ~2 weeks, E is ~2 days. Both fit in the current "boot-layer wiring + APNs end-to-end" sprint without displacing other work.

## 5. Migration path (for the D half)

New table `notification_queue` (additive — no existing data touched):

```
notification_queue (
  id uuid primary key,
  user_id uuid not null references auth.users,
  scheduled_at timestamptz not null,
  payload_ciphertext bytea not null,
  iv bytea not null,
  dedup_key text not null,
  status text not null default 'pending',  -- pending | dispatched | invalidated
  created_at timestamptz default now(),
  expires_at timestamptz not null
)
unique index on (user_id, dedup_key) where status = 'pending'
index on (status, scheduled_at) where status = 'pending'
```

RLS: user can `select` own rows for debugging; only `service_role` can `insert/update/delete`. Client writes go through a Supabase RPC that the worker also calls (so the server-side cron-payload key is held by the RPC, not shipped to clients).

Backfill: **none required.** Existing users get queue rows organically on their next orchestrator pass (client schedulers already run on app open). No flag day, no migration script. If a user never opens the app, no rows — and the surface-on-open backstop from Option E catches them on next open anyway.

Killswitch: feature-flag `notification_queue_enabled` in `shared.settings`. If we ship D and something goes wrong, flip the flag and we are back to A within a single client round-trip.

## 6. Open questions / decisions for Serra

1. **Threat model for the notification-queue server key.** Cloudflare Secrets Store? Cloudflare KMS? Plain `wrangler secret put`? My read: `wrangler secret put` is acceptable for now since the key only decrypts notification *copy* (not source data), and the blast radius of a leak is "we see what notifications were queued" — embarrassing but not catastrophic. If the queue ever holds richer payloads we re-evaluate. **Recommend: wrangler secret, rotated quarterly, audit log on every decrypt.**
2. **Can the B2B research stream ride on the same key chain?** Strong recommendation: **no.** B2B (per `project_ollie_data_strategy`) uses anonymized + PII-scrubbed enriched signals via a *separate* path (ai-proxy `/enrich-dump` → drain → `enriched_signals` table). Notification queue holds non-anonymized per-user copy. Different blast radius, different rotation cadence, different audit log. Two keys, two RLS roles, no shared envelope.
3. **Acceptable latency for "notification arrives even when user hasn't opened the app today."** I am assuming P0-Q for time-sensitive (period-due, supplement-due) = "within the minute of scheduled_at"; P1-Q for soft (weekly review, correlations) = "user sees it on next open, up to ~24h late." Confirm.
4. **US-jurisdiction cycle data in the queue.** Cycle-derived notifications (period_approaching, ovulation_likely) contain timing information that is itself sensitive per the data-strategy memo. Decision: should those particular notifications be (a) excluded from the queue entirely for US users — falling back to A+E only — or (b) queued but with a generic copy ("you may want to check Ollie today") that does not leak the prediction? **Recommend (b).**
5. **Does Option E require new UI design or can it reuse the existing daily-card layout in `BodyModule`?** Design question for Aylin's pod, not blocking this memo.

## 7. Estimated effort

| Option | Best case | Worst case | Notes |
|---|---|---|---|
| A (status quo) | 0d | 0d | Already shipped. |
| B (key escrow) | 15d | 25d | Threat-model review + KMS integration + migration eats most of the worst-case. |
| C (queue) | 7d | 10d | Table + RLS + RPC + client queueing pass + idempotency tests. |
| D (hybrid C+A) | 7d | 12d | Same as C; A half is free. |
| E (surface-on-open) | 2d | 4d | Pure client work. |
| **D + E (recommended)** | **9d** | **14d** | Ship E first as immediate floor, D as 2-week follow-up. |

Worst case assumes one round of Serra review on the queue schema + one round of RLS testing.

---

## TL;DR for the assistant-reporter rollup

- **Recommendation:** Option D (hybrid pre-computed queue for time-deterministic notifications; keep P6/P7 client-side) + Option E (surface-on-open backstop for missed pushes).
- **Effort:** 9–14 dev-days total. E ships in week 1, D in weeks 2–3.
- **What it unblocks:** 10/12 notifications from `AUDIT_body_v2.md` become reliable end-to-end. P6 + P7 stay on client schedulers with E as the safety net.
- **What we explicitly do NOT do:** key escrow (Option B). Decision is reversible — we can adopt B later if the threat model and B2B asks justify it.
- **Hard dependency:** the `scheduleNotification` DI thread-through at app boot (already outstanding per `AUDIT_body_v2.md` "next sprint" #1) must land before D ships, otherwise the queue dispatches into a void.
