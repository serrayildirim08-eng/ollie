# SPRINT_0_CLEANUP_SUMMARY.md

**Sprint 0 Cleanup — 2 gaps from SPRINT_0_SUMMARY.md closed.**

**Outcome:** ✅ both shipped.

---

## Tally

| | Before cleanup | After |
|---|---|---|
| Workspace tests | 864 | **910** |
| Sub-orchestrators booted | 8 | **13** (full set) |
| Brain-dump finance routing | 1 generic `items` slice | **6 sub-slices** (records / bills / subs / goals / adhd_tax / transactions) |
| Brain-dump body routing | 1 generic `items` slice | **4 sub-slices** (water_log / supplements / episodes / items) |
| ADHD-tax detection | 4 markers | **5** (added `impulse` family) |

---

## What shipped

### CL1 — 5 missing sub-orchestrators wired

Created `packages/orchestrator/src/{habits,work,goals,admin,dump}.ts` mirroring the body/grocery pattern. All compose into `createOrchestrator(store)` and boot at app load via `apps/web/src/store.ts`.

- **habits** — subscribes to `habits.items`/`habits.completions`, calls `@ollie/logic/habits.patterns.detectPatterns` (16 detectors). Writes `habits.patterns`. Emits `habits:pattern_detected` only for net-new patterns (dedup vs previously emitted).
- **work** — subscribes to `work.tasks`/`work.focus_log`, runs W0–W17 detectors. Writes `work.patterns`. Emits `work:pattern_detected`.
- **goals** — runs all 16 detectors directly (no batch wrapper in @ollie/logic/goals). Consent gate passed as `getConsent: () => true` for now — real consent wiring follows the consent store layer when that lands.
- **admin** — subscribes to `admin.tasks` + `dump.items` + `void:braindump:submitted`. Runs A1–A15. Writes `admin.patterns`. Emits 11 admin event types with dedup.
- **dump** — subscribes to `dump.items` + `journal.entries` + `void:braindump:submitted`. Runs resurface + anniversary functions from `@ollie/logic/journal`. Writes `journal.patterns`. Emits `journal:entries_added` only for net-new entries.

**Tests:** 32 new vitest cases (7 habits / 6 work / 7 goals / 6 admin / 6 dump). Orchestrator suite now 73 tests.

**Events registry:** `goals:pattern_detected` added (was missing).

### CL2 — applyRoute sub-slice routing

Extended `apps/web/src/hooks/applyRoute.ts` with a `classifyFinanceSlice()` helper that re-parses raw text via `@ollie/logic/finance.parseFinanceDump`, plus a regex layer for keywords the parser doesn't categorize.

**Routing now works:**

| Brain-dump text | Lands in slice |
|---|---|
| `"canva $20 monthly"` | `finance.subscriptions` |
| `"spent $40 impulsively on a gadget"` | `finance.adhd_tax` |
| `"rent $800 every month"` | `finance.bills` |
| `"save $100 toward laptop"` | `finance.goals` |
| `"got paid $5000"` / `"bought eggs $4"` | `finance.records` |
| (unclassified finance) | `finance.transactions` |
| `"drank a glass of water"` | `body.water_log` |
| `"took my magnesium"` | `body.supplements` |
| `"migraine today"` | `body.episodes` |
| (unclassified body) | `body.items` |
| `"buy eggs"` (add action) | `grocery.items` |
| `"got the eggs"` (log action) | `grocery.pantry` |
| `"period started"` | `cycle.items` with `action: 'started'` |
| `"random thought"` | `dump.items` |

**Patched `parseFinanceDump`**: added `impulse` family (`'impulse', 'impulsively', 'impulsive', 'impulse buy'`) to `ADHD_TAX_MARKERS`. Was the only legacy ADHD-tax cue not in the marker list.

**Tests:** 22 cases in `apps/web/src/hooks/useApplyBrainDump.test.ts` covering every slice + the impulse case. Up from 8 before this sprint started.

**Vitest aliases:** added subpath aliases (`@ollie/logic/finance`, `/cycle`, `/dissection`, `/grocery`, `/body`) to `apps/web/vitest.config.ts` so tests resolve workspace subpaths.

---

## Verification matrix

| Scenario | Status |
|---|---|
| Brain dump on dashboard (not habits page) triggers habits adherence detector | ✅ orchestrator listens globally |
| "canva $20 monthly" → `finance.subscriptions` not `items` | ✅ tested |
| "spent $40 impulsively on a gadget" → `finance.adhd_tax` | ✅ tested |
| "rent $800 every month" → `finance.bills` | ✅ tested |
| "save $100 toward laptop" → `finance.goals` | ✅ tested |
| "drank a glass of water" → `body.water_log` | ✅ tested |
| "took my magnesium" → `body.supplements` | ✅ tested |
| "migraine today" → `body.episodes` | ✅ tested |
| Reload app → all 13 sub-orchestrators init + subscribe | ✅ wired in `store.ts` after `createOrchestrator(store).init()` |

---

## Known follow-ups (out of scope for this cleanup)

1. **Real consent gate.** `goals` orchestrator currently passes `getConsent: () => true`. When the consent store layer lands, wire it through so users can disable goals detectors.
2. **Cross-tab reminder/orchestrator coordination.** All 13 orchestrators run per-tab; a write in tab A triggers a recompute in tab B via the existing cross-tab sync (already in @ollie/store), but each tab also runs its own timers. Fine for now.
3. **Body sub-slice routing uses inline regex** — could be lifted into `@ollie/logic/body` for consistency with the finance approach.
4. **The 8 known gaps from SPRINT_0_SUMMARY.md** stand: 2 closed here (#1 + #2), 6 remain (ChipFly source rect, cycle:boundary:updated event, HealthFlag severity drift, no deployed Worker, setTimeout limits, apps/web component tests).

---

## What's next

Two natural follow-ups:

1. **Polish the remaining 6 gaps** from SPRINT_0_SUMMARY (mostly small — ~half a day each).
2. **Start the real backend** — NestJS + Postgres + accounts. The brain-dump → router → store pipeline is now fully functional on local-only storage. Adding accounts + sync is the next architectural milestone.

---

**Cleanup result:** all 13 module orchestrators boot at app load · brain-dump items land in their correct sub-slice across finance/body/grocery/cycle/dump. ✅
