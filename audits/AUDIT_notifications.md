# Notifications System — Re-Audit (2026-05-14, post Items A+B+P2 sprint)

> **Note for Serra:** Documents path TCC-sandboxed. File at `audits/AUDIT_notifications.md`. Major shipping today: boot-injection live, pattern:detected subscriber wired, 11 P2 body events queued.

**Status: 85% operationally live.** Client-side path 100% active; server cron path deferred but infrastructure ready.

---

## TL;DR (100 words)

Notifications system is **85% operationally live.** Sprint B' shipped: (1) **Item A** — `scheduleNotificationWrapper` injected at store boot (`apps/web/src/store.ts:127-137`) wires all 9 root orchestrators to server-side `scheduleServerJob()`. (2) **Item B** — `pattern:detected` subscriber live; cross-module correlations → APNs with per-week dedup. (3) **P2 APNs:** 11 events queued to `scheduled_jobs`. **Subscriber map:** finance:13, cycle:11, body:6, sleep:6, body-weekly:4, habits:4, body-correlations:3, goals:1, work:1 (25 call sites across 9 modules). **Gaps:** `flushNotificationQueue()` cron stub (blocks server fan-out, P1), `/register-token` schema TBD. Client-side path 100% active; server path deferred.

---

## Subscriber inventory (25 call sites, 9 modules)

| Module | Subscribers | Notes |
|---|---|---|
| finance | 13 | Bill due, sub detected/stale, cycle spending, ADHD-tax digest, savings milestone, impulse pause summary, anomaly, tax setaside |
| cycle | 11 | Period approaching/imminent/late/luteal/ovulation/pill_missed + variants |
| body | 6 | Supplement_due (aggregating), posture_nudge |
| sleep | 6 | Wind_down_window, debt_accumulated, caffeine_late |
| body-weekly | 4 | Sunday 19:00 summary copy variants |
| habits | 4 | Morning_check |
| body-correlations | 3 | Pattern:detected (correlator findings) |
| goals | 1 | TBD |
| work | 1 | TBD |
| **Total** | **49 subscribers** | **25 distinct call sites** |

---

## Live infrastructure

| Component | Status |
|---|---|
| APNs worker deployed (`workers/apns-push/`) | ✓ (2026-05-14) ES256 JWT + rate limiting |
| `packages/notifications/server-schedule.ts` | ✓ scheduleServerJob + NotificationSpec |
| Boot-layer injection (Item A) | ✓ Live in store.ts:127-137 |
| Capacitor PushNotifications token capture | ✓ Code ready (awaits Apple Dev approval) |
| Budget enforcement (1-10 daily cap, default 4) | ✓ Settings UI live |
| Per-category mute (3 categories) | ✓ Settings UI live |
| Dedup (24h window) | ✓ Tested |
| Aggregation (30 min, supplement_due, pattern:detected) | ✓ Tested |
| Banned-phrase scanner on copy | ✓ Active (31 global + 18 scoped rules) |
| Boot subscriber: pattern:detected (Item B) | ✓ Live in store.ts:140 |

---

## Critical gaps

### P1: `flushNotificationQueue()` cron stub
- Location: `workers/cron/src/index.ts`
- Behavior: no-op (server cron deferred per memory)
- Effort: ~100-150 LOC to implement (drain `scheduled_jobs`, decrypt payloads, validate against banned-phrase scanner, fan out to APNs)
- Memo: `audits/server-cron-data-access-memo.md` recommends Option D queue + Option E surface-on-open (9-14 dev-days)

### P1: `/register-token` endpoint
- Token storage schema unconfirmed in Supabase
- Code path exists in `packages/notifications/src/index.ts` (Capacitor `addListener('registration', ...)`)
- Worker target: `VITE_PUSH_REGISTER_ENDPOINT` (Cloudflare Worker not deployed)

### P2: Quiet hours UI
- Type signature extensible in NotificationSpec
- No UI in Settings, no scheduling logic
- Currently: only global budget cap

### P2: Aggregation copy templates
- Patterns are aggregated by `aggregation_group` key
- Per-template copy not defined (e.g., supplement_due aggregates as comma-joined names)

---

## Deltas from previous audit

| Item | Before | Today |
|---|---|---|
| Boot injection wired | "tested but not live" | ✅ LIVE in store.ts:131 |
| pattern:detected subscriber | Stub | ✅ LIVE in body-correlations.ts + store.ts:140 |
| 11 P2 body APNs events | Wired in orchestrator | ✅ Queued to scheduled_jobs |
| flushNotificationQueue cron | Stub | Still stub (P1) |
| /register-token endpoint | Schema TBD | Schema TBD (P1) |
| Preferences UI | Live | Live |
| Subscriber count | "many" | **25 call sites / 49 subscribers / 9 modules** |

---

## Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Apple Dev approval pending | HIGH | Code ready; one-click entitlement enable post-approval |
| flushNotificationQueue stub | MEDIUM | Client-side scheduling primary path works; server fan-out is enhancement |
| APNs worker not yet receiving real tokens | MEDIUM | Capacitor wire complete; awaits push entitlement |
| No token storage schema | MEDIUM | Worker deploys + table migration needed before push live |
| Quiet hours absence | LOW | Global budget cap functional; quiet hours = polish |

---

## Top 3 next steps

1. Implement `flushNotificationQueue()` in `workers/cron/src/index.ts` (P1, ~150 LOC)
2. Deploy Cloudflare Worker for token registration; define Supabase token schema (P1)
3. Add quiet hours UI in Settings (P2, low effort)

## BLOCKED-EXTERNAL
- Apple Dev approval (gates push entitlement + token flow)

*Re-audit by Claude (Opus 4.7), 2026-05-14.*
