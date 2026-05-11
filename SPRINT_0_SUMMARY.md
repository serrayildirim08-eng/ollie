# SPRINT_0_SUMMARY.md

**Sprint 0 / Group A — Wire what exists.**
Goal: make the cleaned-up Ollie codebase actually run end-to-end at the keyword level.

**Outcome:** ✅ all 5 tasks shipped.

---

## Tally

| | Before | After |
|---|---|---|
| Tests (workspace) | 815 | **864** |
| Packages | 5 | **7** |
| Hotline countries | 3 | **12** |
| Orchestrators booted at app load | 1 (astrology inline) | **8** (cycle, pets, body, grocery, sleep, finance, patterns + astrology) |
| Brain dump → router wired | ✗ (toast only) | ✅ (dissection + chip-fly + store write) |
| Anthropic HTTP fallback | ✗ | ✅ (rate-limited, cached, timeout-bounded) |
| Reminder scheduler | ✗ | ✅ (parse + setTimeout + fire event + toast) |

---

## What shipped

### A1 — Crisis hotlines + regex bypass

- **9 missing hotlines added** to all three locales: `hotline_CA, hotline_AU, hotline_DE, hotline_FR, hotline_NL, hotline_IT, hotline_ES, hotline_SE, hotline_INTL` (plus the existing TR / US / GB). En + en-literal + es.
- **New package** `@ollie/logic/crisis`:
  - `regex.ts` — `CRISIS_RE` + `detectCrisis(text)` → `{ match, line }`
  - 23 tests cover EN + TR phrases. Crucially: `kill it on the dance floor` / `this code is killing me` do NOT match.
- **Edge case fixed:** JS `\b` is ASCII-only. Turkish phrases starting with `ö` / `ü` etc. were handled via a separate regex with `(?:^|(?<=\s))` lookbehind.
- **`void:crisis:detected` event registered + payload shape validated.**
- Wired into the brain-dump path so crisis text bypasses normal routing and renders a localized crisis toast.

### A2 — Boot all sub-orchestrators

- `apps/web/src/store.ts` now calls `createOrchestrator(store).init()` at module load.
- **Booted:** cycle · pets · body · grocery · sleep · finance · patterns.
- Astrology remains inline (it was already wired in `store.ts:41-78`).
- **Gap noted, not fixed:** `habits / work / goals / admin / dump` do NOT have sub-orchestrator files. These five modules call `@ollie/logic.*` directly from their TSX components. That's an architecture decision to revisit later — see "Follow-ups" below.

### A3 — Wire onBrainDump → dissection router

- **New hook** `apps/web/src/hooks/useApplyBrainDump.ts` orchestrates the full pipeline:
  1. Crisis pre-check (folded in from A1).
  2. Reminder parse (added in A5 — see below).
  3. Local keyword router (`@ollie/logic/dissection.extract`).
  4. AI fallback to Haiku (added in A4).
  5. Per-route `chipFly()` animation, staggered 70ms.
  6. Per-route store write via `applyRoute()`.
  7. Final toast `routed → grocery, sleep`.
- **`applyRoute`** is a pure store-writer that handles each module's canonical write shape: `grocery.items`, `cycle.items`, `dump.items` (catch-all), `<module>.items` generic.
- `ChipFlyHost` moved to top-level — chips fly correctly from home / module / garden, not just dashboard.
- **`apps/web` got vitest + jsdom** (it had no tests before). 8 smoke tests against `applyRoute`.
- `@ollie/logic/dissection` added to package exports map (was missing → build error).

### A4 — Anthropic HTTP fallback

- **New package** `@ollie/api`:
  - `src/anthropic.ts` exports `routeViaHaiku(text, context, opts?)`.
  - Endpoint: `https://ollie-api.ollieapp.workers.dev/v1/messages` (Cloudflare Worker proxy; override-able for tests).
  - **AbortController** with 10s default timeout.
  - **Token-bucket rate limit:** 3s min gap between calls. Second call within window returns `null` without hitting fetch.
  - **Prompt caching:** `anthropic-beta: prompt-caching-2024-07-31` header set; system prompt marked `cache_control: { type: 'ephemeral' }`.
  - System prompt is the legacy `ROUTER_SYSTEM_PROMPT` ported verbatim from void-app.html.
  - Model: `claude-haiku-4-5-20251001`.
  - **On any failure** (network, 4xx, 5xx, parse, timeout, rate-limit): returns `null` and sets `globalThis.__voidAIOffline = true`.
  - 9 tests cover happy path, 500, 429, network throw, rate-limit gate, AbortController timeout, malformed JSON, code-fence stripping, answer-object response.
- **Wired** into `useApplyBrainDump.ts` step 2b: if the keyword router only returns a `dump` catch-all (low confidence), fall back to Haiku.

### A5 — Reminder scheduler

- **New package** `@ollie/router`:
  - `src/reminders.ts` exports `parseReminder(text, now, locale?, module?)` — handles "in 5 minutes", "in 3 days", "tomorrow at 9am", and **Turkish** "5 gün sonra" (added from scratch — legacy didn't cover TR).
  - `src/scheduler.ts` exports `createReminderScheduler(store, events)` with `init / add / cancel / teardown` methods.
  - Storage schema: `void.state.reminders.v5` = `Array<{ id, module, action, datetime, body, status: 'scheduled' | 'fired' | 'cancelled' | 'dismissed' }>`.
  - On fire: emits `void:reminder:fired`, flips status, emits `void:toast` so apps/web can render.
  - 9 tests, including `vi.useFakeTimers()` advance + cancel + re-init from store.
- **Wired** into `apps/web/src/store.ts` after orchestrator boot.
- `void:toast` event added to the registry (was missing).
- `useApplyBrainDump.ts` step 1b: parse reminders BEFORE normal routing. If a reminder is parsed, it's added to the scheduler. The text also continues into the normal router so e.g. "rent 5 gün sonra" creates BOTH a reminder AND a finance task.

---

## Blockers + known gaps

**1. 5 modules have NO sub-orchestrator** (habits, work, goals, admin, dump).
They run UI-only — logic is called from inside the TSX components. This works
but means: (a) detectors won't fire while the user isn't on that module's page,
(b) cross-module events don't reach them. Real fix: create the 5 missing
sub-orchestrators. ~1 day each.

**2. `applyRoute` doesn't handle non-standard module write shapes.**
- finance has 6 sub-slices (records, goals, bills, subscriptions, adhd_tax, transactions). Currently routed items land in `finance.items` (generic) instead of the right sub-slice.
- grocery has both `items` and `pantry`. Currently everything goes to `items`.
- pets needs the pet_id to be selected from context.
- The legacy `applyRoute()` (void-app.html ~L30144) had specific per-module handlers that need to be ported. ~4 hours.

**3. ChipFly source rect** is the BrainDumpInput's bounding rect, but in current code we don't capture it from every entrypoint. The chip animates but its origin isn't always the input — sometimes it's `null` and falls back to viewport center. Minor polish.

**4. `void:cycle:boundary:updated` event still missing from registry** (flagged by Phase 3d junior in the original migration). Cycle orchestrator references it indirectly. Hasn't caused a test failure but is an inconsistency. ~10 minutes.

**5. `HealthFlag.severity` type drift:** `@ollie/logic` returns `'low' | 'medium'`; events registry expects `'info' | 'watch' | 'discuss'`. Currently mapped `low→info, medium→watch` in cycle orchestrator. Worth aligning the source types. ~30 min.

**6. No real Worker deployment yet.** `routeViaHaiku` POSTs to `https://ollie-api.ollieapp.workers.dev` which is the legacy void Worker. Until ollie has its own deployed Worker, AI fallback uses the existing one (fine for now). When the new backend lands, swap the endpoint.

**7. Reminders are setTimeout-based + per-tab.** A reminder scheduled in one tab won't fire if the tab is closed before the time arrives. Cross-tab handling (and a service-worker-cron later) is a follow-up. Browser also throttles `setTimeout` to >1s in background tabs.

**8. Tests in `apps/web/` are minimal.** 8 smoke tests for `applyRoute`. No component-level tests (no React Testing Library setup yet, just jsdom + raw assertions). Real RTL setup is a separate sprint.

---

## Verification matrix

| Scenario | Status |
|---|---|
| Type "i want to die" → crisis toast with locale hotline, no other routing | ✅ wired (manual verification recommended in dev server) |
| Type "buy eggs" → grocery.items has new entry, chip flies to grocery tile | ✅ wired |
| Type "period started" → cycle.items has `{action:'started'}` entry | ✅ wired |
| Type "rent 5 gün sonra" → reminder row in `void.state.reminders.v5` + scheduled timer | ✅ wired |
| Type "uhhh" (ambiguous, low confidence) → AI fallback to Haiku | ✅ wired (assuming Worker is reachable) |
| Worker offline → `__voidAIOffline = true`, falls back to dump catch-all | ✅ wired |
| Brain dump → chip animates from input → lands on correct dashboard tile | ✅ wired (origin rect propagated from most entrypoints) |
| Reload page → existing future reminders re-scheduled | ✅ wired |

---

## What's next (recommendation)

Sprint 0 closes the keyword-level functional loop. The app routes, persists, schedules, and falls back. Three natural follow-ups, in priority order:

1. **Fix the 5 missing sub-orchestrators** — habits/work/goals/admin/dump. Until they're wired, detectors only fire when the user opens that specific module page.
2. **Port `applyRoute`'s per-module sub-slice handlers** from legacy — finance/grocery/pets specifically. Right now generic routing under-utilizes the rich store schema.
3. **Start the real backend** (NestJS + Postgres + accounts) — see `project_ollie_backend_stance.md` memory. The Worker stays for AI proxy; the backend handles auth + sync + telemetry.

---

**Sprint 0 result:** Ollie now works end-to-end at the keyword level. ✅
