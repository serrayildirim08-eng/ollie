# STATUS_CHECK_2026-05-11.md

Comprehensive audit · 2026-05-11.

---

## 1. Codebase inventory

| | Value |
|---|---|
| Commits on `main` | **37** (head `66bcc17` — polish: audio + mobile + astrology hide) |
| Tests passing | **921** total (events 11 · store 19 · logic 767 · api 9 · router 9 · orchestrator 73 · web 33) |
| Packages | **7** (events / store / logic / orchestrator / api / router / web) |
| Bundle chunks | **22** (post-split) |
| Initial download (gz) | ~78 KB (vendor-react 45 + index 25 + CSS) |
| Largest lazy chunk (gz) | vendor-ollie 115 KB · per-module 2–16 KB |
| Build state | 🔴 **RED on main HEAD** — `apps/web/src/pages/DashboardScreen.tsx:264` references `recentBurhanEvents` but it's only defined in the **uncommitted Sprint 3 / D1 WIP** (see §4) |

### Source LOC (lines, by package src/)

| Package | LOC |
|---|---|
| @ollie/events | 354 |
| @ollie/store | 363 |
| @ollie/api | 259 |
| @ollie/router | 591 (+255 WIP `cross-module.ts`) |
| @ollie/orchestrator | 3,273 |
| @ollie/logic | 23,920 |
| apps/web/src | 22,750 |
| **Total** | **~51,500** |

### apps/web/dist/ chunks (gzipped)

```
vendor-react        45 KB   always loaded
index               25 KB   always loaded
vendor-ollie       115 KB   lazy when a module mounts
vendor-astronomy    22 KB   lazy when astrology.birth set
vendor-howler       10 KB   lazy on first sound tap
AstrologyModule     16 KB   lazy + ?astrology=1 gated
FinanceModule       10 KB   lazy
SleepModule          9 KB   lazy
AdminModule          9 KB   lazy
GoalsModule          7 KB   lazy
BodyModule           7 KB   lazy
…12 more module/page chunks 2–7 KB each
```

---

## 2. What's working end-to-end (Maya's verified flows)

| Flow | Status |
|---|---|
| Fresh install → 8-screen onboarding → land on dashboard | ✅ |
| Skip onboarding any time → `shared.settings.onboarded = true` | ✅ |
| Dashboard 4-tile cluster (money / body / home / work) renders + collapses to single column <640px | ✅ |
| Tap cluster → expand → tap sub-module → ModuleScreen renders that module | ✅ |
| Brain dump → crisis pre-check → reminder parse → dissection keyword router → Haiku fallback → store write + chip animation | ✅ |
| `"buy eggs"` → `grocery.items` + chip flies to grocery tile | ✅ |
| `"canva $20 monthly"` → `finance.subscriptions` (not `items`) | ✅ |
| `"spent $40 impulsively on a gadget"` → `finance.adhd_tax` | ✅ |
| `"rent 5 gün sonra"` → reminder row in `void.state.reminders.v5`; setTimeout fires at scheduled time | ✅ |
| `"i want to die"` → crisis toast with country hotline (12 countries supported) | ✅ |
| Reload page → all 13 sub-orchestrators init + subscribe; astrology orchestrator lazily boots only if `astrology.birth` exists | ✅ |
| Sleep wind-down → SleepSoundPlayer 6 sounds, timer, fade, volume | ✅ (all 6 CC0-real now) |
| Service worker caches `/videos/* /audio/* /fonts/*` on first load → offline reload works | ✅ |
| Mini Burhan top-right of dashboard · full Burhan in `/garden` | ✅ |
| **Gaps with no current path:** | |
| Native push notification (APNs / Web Push) — see §6 | ✗ none |
| Banned-phrase CI scanner — see §4 | ✗ none |

---

## 3. Group D progress (Sprint 3 in flight)

Sprint 3 is in flight in a **separate session** — significant uncommitted WIP. Status from grep of uncommitted diff:

| Item | Uncommitted? | What exists | What's left |
|---|---|---|---|
| **D1 Burhan life-event tree** | yes (BurhanTree.tsx, DashboardScreen.tsx, GardenScreen.tsx, store.ts modified; DashboardScreen references `recentBurhanEvents`) | additive growth wiring partial; `waterLevel` was placeholder pre-Sprint 3 | currently breaks typecheck → finish state plumbing + recentBurhanEvents derivation |
| **D2 Cross-module event router** | yes (new `packages/router/src/cross-module.ts` 255 LOC + edits to router index/types) | rule registry + event lineage scaffold ("Sprint 3 · D2" docstring) | wire rules into createOrchestrator boot · register events · tests |
| **D3 Spending pattern detection** | yes (new `packages/logic/src/finance/pattern-detection.ts` + edits to finance/index.ts + orchestrator/finance.ts) | new finance detector module landed | confirm subscription / ADHD-tax / cycle-correlated all live · surface in FinanceModule UI |
| **D4 Cycle → grocery routing** | uncommitted edits to `orchestrator/admin.ts` (visible) — but no cycle/grocery bridge in commits | period log writes `cycle.items` correctly; products forecast exists in `@ollie/logic/products` | bridge: when cycle starts → call `products.forecast` → emit `void:inventory:refill` → grocery orchestrator catches → adds pads/tampons row |

**TL;DR:** D1–D3 partially built in the WIP branch but not committable yet (one typecheck error blocks the lot). D4 is the biggest gap — no bridge code exists in any branch.

---

## 4. Known regressions + drift

| Issue | Severity | Status |
|---|---|---|
| **`DashboardScreen.tsx:264 — recentBurhanEvents undefined`** | 🔴 BLOCKS BUILD | Sprint 3 D1 WIP, uncommitted. Build fails on HEAD `pnpm --filter @ollie/web build` from a clean checkout. |
| **Banned-phrase CI scanner not in ollie** | 🟡 medium | Lives at `~/void/tools/banned-phrases.js` + `~/void/design-pitches/handoff/banned-phrases.js`. Not ported. No CI gate currently catches brand-voice violations. |
| **Stale orchestrator/src/index.ts header comment** ("pets/body/grocery/sleep/finance/patterns come in follow-up phases") | 🟢 low | Pre-existing since Sprint 0 cleanup. All 7 are wired; comment is wrong. |
| **`HealthFlag.severity` type drift** between `@ollie/logic/cycle/types.ts` (`'low' \| 'medium'`) and `@ollie/events/registry.ts` payload doc (`'info' \| 'watch' \| 'discuss'`) | 🟢 low | Cycle orchestrator maps low→info, medium→watch. Cosmetic. |
| **ChipFly source rect** — origin sometimes null, falls back to viewport center | 🟢 low | Visual polish only. |
| **`void:cycle:boundary:updated` not in events registry** but referenced indirectly | 🟢 low | Not blocking. |
| **Test failures** | 0 | All 921 tests pass on committed code. |

---

## 5. Constitutional alignment

| Rule | Status | Evidence |
|---|---|---|
| Burhan never decays | ✅ | grep `decay\|dying\|wither\|wilted` in `BurhanTree.tsx` → 0 hits |
| Crisis bypass · 12 countries | ✅ | i18n: `hotline_TR, US, GB, CA, AU, DE, FR, NL, IT, ES, SE, INTL` all present (Sprint 0 A1) |
| Crisis regex bypass fires before pattern engine | ✅ | `apps/web/src/hooks/useApplyBrainDump.ts` calls `detectCrisis()` first; routes only on no match |
| No engagement-bait notifications | ✅ (vacuously) | No notification layer exists yet — see §6 |
| Brand voice (no "great job", no "!", no streaks) | ⚠️ unchecked | Banned-phrase scanner not in ollie. Files were authored by juniors against the rule but no CI guard. Risk: drift over time. |

---

## 6. Notification layer (Decision #12)

**Current state:** the app has **no native push at all**.

| Surface | Implementation |
|---|---|
| In-app toasts (right corner) | ✅ `components/Toast.tsx` + `ToastHost.tsx` + `ToastContext` · used for routing receipts, crisis toast, reminder fire |
| `void:reminder:fired` → toast on reminder time | ✅ `packages/router/src/scheduler.ts` emits `void:toast` |
| OS notification permission request | ✗ no `Notification.requestPermission()` anywhere |
| Web Push (service worker `push` event) | ✗ no push event listener in `sw.js` |
| APNs (Capacitor iOS) | ✗ no `@capacitor/push-notifications` dep |
| Capacitor local notifications | ✗ no `@capacitor/local-notifications` dep |
| Mac Electron native notify | ✗ `apps/desktop/main.js` has no `new Notification` or `electron-notification` |

**`grep -rIlnE "APNs\|requestPermission\|showNotification\|Web ?Push\|Notification\(\|@capacitor/local-notifications\|@capacitor/push-notifications" apps/ packages/`** → 0 hits.

**Per Decision #12 the mini-sprint needs:**

1. Web: register a `push` listener in `apps/web/public/sw.js` + `Notification.requestPermission()` flow + a server endpoint that sends payloads (depends on backend).
2. iOS: `pnpm --filter @ollie/ios add @capacitor/push-notifications` + APNs entitlement in Xcode + token registration.
3. Mac Electron: `new Notification()` from main process, called via IPC from the reminder scheduler.
4. Allowed-only filter: only `void:reminder:fired` (user-set) and astrology-daily (opt-in §7) and pattern-alert (opt-in) events can trigger native push. Other event names get blocked at the bridge.
5. Budget: 3–5/day · aggregation rules.

**Effort:** ~1–2 weeks if backend is in place. Web Push needs the backend; APNs needs Xcode + a dev cert; Electron is the cheapest.

---

## 7. Astrology module (Decision #13)

**Current state:** code intact, hidden behind URL flag.

| Artifact | LOC | Location |
|---|---|---|
| `AstrologyModule.tsx` | 1,452 | `apps/web/src/modules/astrology/` (lazy chunk) |
| `@ollie/logic/astrology` | 452 | 7 files |
| Astrology orchestrator (in `store.ts`) | ~40 | deferred via `bootAstrology()`; loads astronomy-engine + logic only when `astrology.birth` is set |
| Dashboard surface | 0 | astrology not in 4-tile cluster (cut per B1) |
| URL gate | ✅ | `ModuleScreen.tsx:193` checks `?astrology=1` else redirects to dashboard |

**To wire as opt-in per Decision #13:**

1. **Surface a settings toggle.** Add `astrology_enabled: boolean` to `shared.settings`. Onboarding screen 6.5 (between cycle and Burhan) asks "track astrology too?" (default off).
2. **Dashboard tile.** Conditionally render a 5th cluster tile when `shared.settings.astrology_enabled` is true. Or fold it into the `body` cluster.
3. **Daily reading notification opt-in.** New screen during onboarding (or in settings): "send a daily reading?" → if yes, set `shared.settings.astrology_daily_notify = true`. Once §6 lands, the notification scheduler fires once/day at user-chosen time (default 8am local), payload = the day's reading generated from `currentTransits`.
4. **Remove `?astrology=1` flag** once the toggle exists.

**Effort:** ~½ day for settings toggle + tile · daily-reading notification depends on §6.

---

## 8. What's next — recommended order

1. **🔴 Resolve the uncommitted Sprint 3 WIP first.** Build is RED on HEAD because of `recentBurhanEvents`. Either:
   (a) Finish the Sprint 3 D1 implementation in that session (you said it's on the side — fine), OR
   (b) Stash/revert the uncommitted changes so `main` is buildable, then resume Sprint 3 cleanly.
   You can't ship anything to anyone (iOS beta, desktop dmg, web deploy) until this clears.

2. **Native notifications mini-sprint (Decision #12).** Three platforms; Mac Electron is the smallest first slice (no backend dep, no dev cert). Lets you validate the allowed-only filter against the reminder scheduler before scaling to iOS + Web Push. Effort: ~3 days for Electron alone, ~1–2 weeks for all three.

3. **Banned-phrase CI scanner.** Port `~/void/tools/banned-phrases.js` to `~/ollie/tools/banned-phrases.js` + add a `pnpm scan` script + wire it into the pre-commit/pre-push hook in this repo. Cheap (~2 hours). Stops drift before it compounds across feature work.

Then in parallel: backend (Group C, NestJS + Postgres + accounts — needed for Web Push, accounts, server-side sync), then astrology re-enable (§7), then the rest of Sprint 3 polish.

---

**Status check result:** product is solid and shippable from `cf75c22` (Sprint 0 cleanup HEAD), but `HEAD` itself is currently broken by uncommitted Sprint 3 D1 work. Notification layer is the biggest constitutional gap given Decision #12.
