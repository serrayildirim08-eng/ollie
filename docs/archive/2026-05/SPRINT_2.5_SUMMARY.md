# Sprint 2.5 — Notification layer + savings tracker

**Status:** all 7 tasks shipped.
**Tests:** 995 vitest + 21 scanner pretest = 1016 checks. Up from 971.
**Typecheck:** clean across all 11 packages.
**Scanner:** clean across 217 files; notify() copy now context-scanned.

---

## NL1 · `packages/notifications` — cross-platform API

New workspace package with one public entrypoint:

```ts
import { notify, cancel } from '@ollie/notifications';

await notify({
  title: 'rent due in 3 days',
  body: 'just saying.',
  category: 'REMINDER',          // REMINDER | PATTERN_ALERT | CONTENT_DELIVERY
  dedupe_key: 'rent-2026-05',
  action_url: '/finance/bills',  // optional
  schedule_at: Date.now() + 5_000, // optional
  aggregation_group: 'morning',    // optional · enters NL4 buffer
});

notify.cancel('rent-2026-05');
```

**Constitutional:** the `NotificationCategory` type literally has only 3 members. The dispatcher also rejects unknown categories at runtime — belt-and-braces against brain-dump router producing arbitrary strings.

Three backends installed by the host app:
- `installCapacitorBackend()` — iOS (Capacitor LocalNotifications + PushNotifications)
- `installElectronBackend()` — Mac/Win/Linux (via IPC bridge to electron's main process)
- `installWebBackend()` — browser fallback

Dispatcher state is module-scoped. Scheduled notifications persist in `shared._notification_scheduled`; resume on boot fires any that elapsed while the app was closed.

**Files:**
- `src/index.ts` — dispatcher + public API
- `src/types.ts` — `NotificationSpec`, `NotificationBackend`, `NotificationCategory`
- `src/budget.ts`, `src/aggregator.ts` — NL4 (below)
- `src/backends/{web,electron,capacitor}.ts`
- `tests/notifications.test.ts` — 11 tests covering delivery / dedupe / budget / scheduling / aggregation / category enforcement

---

## NL2 · APNs + Apple Developer wiring

**Cloudflare Worker** (`apps/api/`) — production-grade, deploys with one `wrangler deploy`.

Endpoints:
- `POST /register-token` — iOS posts its APNs device token here
- `POST /send` — server-side trigger that JWT-signs an APNs HTTP/2 request
- `GET /health`

JWT signing: ES256 via `crypto.subtle.importKey('pkcs8', …)`. Cached in-process for 50 min (Apple's 60-min max). Bundle id + key id + team id + auth key (.p8) loaded from wrangler secrets.

**Apple-side setup** (one-time, ~15 min, requires Serra's login):
1. Apple Developer → Keys → `+` → APNs → download `AuthKey_XXX.p8`
2. Note Key ID (10 chars) and Team ID (10 chars)
3. Enable Push Notifications capability on `app.ollie.ollie`
4. Run the wrangler secret/KV setup listed in `apps/api/README.md`
5. `wrangler deploy`

**Client side** (`apps/web/src/lib/push-register.ts`):
- Detects platform (capacitor / electron / web)
- Installs the right backend
- For Capacitor: registers for remote APNs, captures device token, forwards to the Worker `/register-token` with shared-secret auth

Currently blocked only by step 1 (Serra's hands-on Apple Developer step). The code path is complete and typechecks clean.

---

## NL3 · Mac native notifications

Electron main process now exposes a notify bridge via `preload.js`:
- `window.ollie.notify.notify(spec)` → native `electron.Notification`
- `window.ollie.notify.schedule(spec, fireAt)` → main-process `setTimeout` (survives renderer reloads)
- `window.ollie.notify.cancel(key)`
- `window.ollie.notify.requestPermission()`

The electron backend in `@ollie/notifications` detects the bridge and routes through it; falls back to the HTML5 Notification API when running in a renderer without the bridge (e.g. dev mode without preload).

macOS Notification Center receives banners + persists in the notification center as expected. Click handler opens `action_url` via `shell.openExternal`.

---

## NL4 · Notification budget + aggregation

`packages/notifications/src/budget.ts`:
- `daily_cap` default 4. Counts only **delivered** notifications today (local-day boundary).
- `muted_categories: NotificationCategory[]` — per-category mute.
- `aggregation_window_ms` default 30 min.
- Configured via `shared.settings.notification_budget`.

Rolling log at `shared._notification_log` (ring buffer, cap 500) — used for dedupe (24h window) AND budget counting.

`packages/notifications/src/aggregator.ts`:
- When `spec.aggregation_group` is set, the notification enters a per-group buffer.
- A flush timer fires `aggregation_window_ms` after the first item.
- On flush: builds one digest spec ("today: doctor 14:30 · regl 2-3 gün içinde · canva $20 dün çekildi") and dispatches it.

**Test coverage:**
- "seed 8 events same group → 1 digest" ✓
- daily cap stops at default 4 ✓
- per-category mute ✓
- dedupe within 24h ✓
- scheduled timer fires + cancel removes it ✓

---

## NL5 · Scanner coverage for notify()

Extended `tools/scan-banned-phrases.cjs` `CTX_OPEN` regex with:
- `\bnotify\s*\(\s*\{` — any notify({…}) call site
- `\bawait\s+notify\s*\(`
- `@ollie/notifications` imports
- `installCapacitorBackend|installElectronBackend|installWebBackend`

Lines within 30 of these markers get the push-scope rules: no `!`, no 🎉 emoji, no cheerleading, no urgency theater.

Three new scanner tests in `tools/banned-phrases.test.cjs`:
- `"we miss you!"` in push scope → fires `miss-you` (global) AND `push-exclaim` (push)
- `"you matter to us!"` in push scope → fires `you-matter` AND `push-exclaim`
- `"rent is due in 3 days"` passes push scope

**Canary verified:**
```
✗ BANNED PHRASE VIOLATIONS
  packages/logic/src/_notify-canary.ts:5  [global/miss-you]
  packages/logic/src/_notify-canary.ts:5  [push/push-exclaim]
```

Now 21 scanner tests (was 18); 217 files scanned (was 215).

---

## F1 · Savings tracker (Decision #14, locked 2026-05-11)

**Pure logic** — `packages/logic/src/finance/savings.ts`:
- `Cancellation { id, merchant, monthly_amount, cancelled_at, resubscribed_at?, surfaced_by_ollie }`
- `computeSavings(cancellations, now)` → `{ year_total, all_time_total, entries[], year_entries[] }`
- `monthsBetween(startTs, endTs)` — counts WHOLE elapsed months (day-of-month aware). Never annualizes.
- `buildSavingsCardCopy(totals)` — passive voice. Returns "$340 saved this year. canva (3 mo), notion (2 mo), spotify family (5 mo)."
- Re-subscribed cancellations stop accruing at `resubscribed_at` but **stay in history** (Decision #14 rule).

**Tests** — `packages/logic/tests/finance-savings.test.ts`, 13 tests:
- `monthsBetween` correctness (zero / sub-month / multi-month / day-boundary)
- single cancellation 3 mo × $20 = $60
- multi-cancellation totals with one straddling year boundary
- **re-subscribe preserves history** ✓
- copy NEVER says "you saved" or "ollie saved you" ✓
- empty state returns empty copy

**Orchestrator wire** — `packages/orchestrator/src/finance.ts`:
- Listens to `finance:subscription_cancelled`
- Looks up `monthly_amount` from payload → d3_subscriptions card → RecurringPattern median
- Appends to `finance.cancellations` (preserves on duplicate id — re-sub case)
- Emits `finance:savings_recorded`
- `recomputeDerived()` always sets `finance.savings = computeSavings(...)`

**UI** — `apps/web/src/modules/finance/FinanceModule.tsx`:
- D3 subscription card's primary button is now `cancelled` (was `dismiss`). Tap emits `finance:subscription_cancelled` with merchant + amount.
- New `<SavingsCard />` renders quietly above the existing "noticed" section.
- Tap card → expands an all-time + per-merchant breakdown.

**Voice audit:**
```
$340.00 saved this year. canva (3 mo), notion (2 mo), spotify family (4 mo).
```
No exclamation marks. No "you saved" / "ollie saved you". No celebration emoji. Passes scanner.

---

## F2 · Savings monthly digest (opt-in)

`apps/web/src/lib/savings-digest.ts`:
- Reads opt-in toggle `shared.settings.notify_savings_digest` (default false — constitutional)
- Computes next fire ts: 23:00 local on the last day of current month, else next month
- Calls `notify({ category: 'PATTERN_ALERT', schedule_at, ... })` — uses the full NL1+NL4 stack
- Dedupe key encodes year+month → same fire ts produces same key → idempotent re-scheduling
- On visibility-change → re-checks and re-schedules

Copy via `buildMonthlyDigestCopy()`:
```
this month: $80.00 saved by cancelling notion + spotify family. total this year: $340.00.
```

Passes the scanner. Counts toward the daily budget (single PATTERN_ALERT).

---

## Sprint metrics

| Package | Before | After | Δ |
|---|---|---|---|
| events       | 11  | 11  |  0 |
| store        | 19  | 19  |  0 |
| logic        | 795 | 808 | +13 (finance-savings) |
| api          | 9   | 9   |  0 |
| router       | 17  | 17  |  0 |
| **notifications** | **—** | **11** | **+11** (new package) |
| orchestrator | 87  | 87  |  0 |
| apps/web     | 33  | 33  |  0 |
| **vitest total** | **971** | **995** | **+24** |
| scanner pretest | 18 | 21 | +3 |
| **all checks** | **989** | **1016** | **+27** |

---

## Outstanding (not in this sprint)

1. **APNs key generation** — Serra's hands-on step on Apple Developer. Code path complete; just needs the .p8 file + wrangler secrets.
2. **iOS Capacitor `cap add ios`** — generate the actual Xcode project (deferred since Sprint 1).
3. **Settings UI for budget + per-category mute** — data model exists at `shared.settings.notification_budget`; the modal can land next sprint.
4. **Settings UI for `notify_savings_digest` toggle** — same pattern.
5. **Test the live APNs path** — once Serra completes step 1, send a real push via the worker `/send` endpoint to a real device token.

After these, Ollie has a native push notification system on iOS + Mac, brand-voice-protected by the scanner, budgeted + aggregated, with the savings tracker proving its dollar value for the free→paid conversion narrative.
