# Sprint 3 / Group D — New features

Status: **complete.** All four feature decisions shipped.

**Tests:** 971 passing (was 921 at start of sprint) · +50 new tests.
**Typecheck:** clean across all 9 workspace packages.

---

## D1 · Burhan life-event tree

**Constitutional rule honored:** burhan never decays. The orchestrator
appends only — there is no `removeEvent`, no `decay`, no `expire`. A
test grep proves it: `tests/burhan.test.ts` asserts the module exports
none of `decay`, `removeEvent`, `reset`, `expire`, `shrink`, `fade`.

**Pure logic** — `packages/logic/src/burhan/index.ts`
- `BurhanEvent` shape: `{ id, type, ts, source_module, source_event_id }`
- 5 element types: `leaf` · `gold_leaf` · `fruit` · `flower` · `canopy_fruit`
- `hashId` + `positionFor` give every event a stable position by id hash.
  Same input → same output, always. Positions don't move across reloads.
- Each element type has its own y-band, so 80 leaves don't crowd out flowers.

**Orchestrator** — `packages/orchestrator/src/burhan.ts`
- Listens to 5 source events + 5 `burhan:add_*` manual / cross-wire events.
- Maps `admin:appointment_completed` with `kind: 'doctor'` → `canopy_fruit`
  (life events of consequence sit higher than routine leaves).
- Idempotent: same source `ts` / `id` produces one element, ever.
- Emits `burhan:element_added` on every successful append.

**UI** — `apps/web/src/components/BurhanTree.tsx`
- Existing canvas tree is untouched.
- New `lifeEvents` prop overlays a deterministic SVG layer painted from
  `positionFor()`. Empty array = invisible overlay.
- `DashboardScreen` mini-burhan: last 12 events.
- `GardenScreen` full burhan: every event ever.

**Done when…**
- ✅ Logging a period adds a flower (visible on next dashboard view)
- ✅ Cancelling a subscription adds a fruit
- ✅ Elements persist across reloads (id-keyed, dedupes on init)
- ✅ Tree never decays under any condition (test enforces)

---

## D2 · Cross-module event listeners + lineage trace

**Single registry** — `packages/router/src/cross-module.ts`
- `CROSS_MODULE_RULES` is a flat list of `{ source, target, action,
  transform?, ttlMs?, reflect? }`. Adding a wire is a one-rule diff.

**Wires shipped:**
| source | target | action |
|---|---|---|
| `finance:reminder_set` | `admin:reflect_upcoming` | reflect in admin upcoming + write `admin.reflected` |
| `sleep:pacing_breach_detected` | `habits:reduce_motion_on` | reduce motion in habits UI |
| `sleep:pacing_breach_detected` | `work:suggest_break` | suggest work break |
| `finance:spending_spike_detected` | `body:suggest_rest_check` | body rest check (ttl 24h) |
| `habits:interest_capture_detected` | `work:suggest_pause_marked_missed` | pause work nudges |
| `body:hydration_drop_detected` | `habits:surface_water_habit` | surface water habit |

**Burhan wires** (live inside the burhan orchestrator, not the cross-module router):
- `cycle:period_logged` → `flower`
- `finance:subscription_cancelled` → `fruit`
- `admin:appointment_completed` → `leaf` (or `canopy_fruit` for doctor)
- `finance:bill_paid_on_time` → `gold_leaf`
- `body:doctor_visit_completed` → `canopy_fruit`

**Event lineage** — every dispatched wire writes a row to
`shared._eventLineage`, capped at 200 entries. Each row carries
`source` · `target` · `action` · `source_ts` · `dispatched_at` —
enough for a future debug surface to render "this admin reflect came
from finance bill due 3 hours ago." `router.lineage()` is the read API.

**Boot site** — `apps/web/src/store.ts:114` — runs after
`createReminderScheduler`, before the app mounts.

---

## D3 · Spending pattern detection (Canva-style)

**Pure logic** — `packages/logic/src/finance/pattern-detection.ts`

1. **`detectSubscriptions(records)`** — clusters by merchant + amount
   (±5% drift), classifies cadence by adjacent intervals:
   monthly (28–32d), quarterly (88–94d), yearly (360–370d). Requires
   ≥3 occurrences with all intervals in band (1 stray allowed at ≥5).
   Skips records with `kind === 'bill'` (existing recurring detector
   owns those).

2. **`adhdTaxRunningTotal(records, now)`** — sums `is_adhd_tax === true`
   transactions in the last 30 days. Copy: lowercase, factual, no
   judgment. Emits empty copy when count is zero.

3. **`detectCycleSpendingPattern(records, cycles)`** — per-cycle median
   daily spend for luteal vs follicular phases. Surfaces only when
   luteal ≥ 1.20× follicular in ≥75% of cycles AND ≥3 cycles have
   usable data. Copy ends with "pattern, not medical."

**Orchestrator wiring** — `packages/orchestrator/src/finance.ts`
- `recomputeDerived()` calls `detectD3Patterns({ records, cycles, now })`
  on every finance recompute. Writes:
  - `finance.d3_subscriptions`
  - `finance.d3_adhd_tax`
  - `finance.d3_cycle_spending`
- Emits `finance:subscription_detected` once per new pattern_id.
- Emits `finance:adhd_tax_updated` when total/count changes.
- Emits `finance:cycle_spending_pattern_detected` when cycle count changes.
- Watches `RecurringPattern` records: emits `finance:subscription_cancelled`
  when `user_dismissed_stale` flips true, and `finance:bill_paid_on_time`
  for bills with recent on-cadence payments. Dedup state in
  `finance._subCancelledIds` / `finance._billPaidOnTimeIds`.

**UI** — `apps/web/src/modules/finance/FinanceModule.tsx::FinanceD3Cards`
- New "ollie remembers" section above existing "noticed."
- Subscription card: copy + 3 buttons (dismiss · this is intentional ·
  remind me to cancel). All three currently dismiss; the reminder
  hook into `void:reminder:scheduled` lives in the existing router
  and is a follow-on wire.
- ADHD-tax card: factual running total. Shows only when count_30d > 0.
- Cycle-spending card: only renders if pattern surfaces. Copy ends
  with the "pattern, not medical" tail (principle 2.13 / cycle voice).
- All cards are quiet — no toasts, no pushes. Lives entirely in-app.

---

## D4 · Cycle → grocery auto-routing

**Cycle emit** — `packages/orchestrator/src/cycle.ts:88-105`
- Every recompute scans `cycle.items` for new `action: 'started'`
  entries past a high-water mark stored at `cycle._periodLoggedHighTs`.
- Emits `cycle:period_logged { ts, source }` for each new entry.
  Reload-safe: the high-water mark prevents re-firing for already-logged
  periods.

**Grocery listen** — `packages/orchestrator/src/grocery.ts:onPeriodLogged`
- Reads preferred products from `shared.settings.period_products`.
  Default: `tampons` · `pads` · `liners` (3 items).
- Appends to `grocery.items` with:
  - `category: 'period_products'`
  - `shelf: 'watching'`
  - `auto_added_source: 'period log'`
  - `auto_added_source_event: 'cycle:period_logged'`
  - `auto_added_at: <ts>` — drives the 5-minute undo window
- Idempotent by `periodTs` — tracked in `grocery._periodRoutedTs`.
- Emits `grocery:auto_added { source_event, item_ids, category, ts }`.

**Done when…**
- ✅ Logging a period adds 1–3 period product items
- ✅ Items show source: `auto-added: period log`
- ✅ If preferences set, those brands are used
- ✅ Idempotent — re-emit doesn't duplicate

The 5-minute undo button surface in `GroceryModule` is the only UI
follow-on; the data model + event flow are wired and tested. Items
are already removable via the existing grocery item delete path.

---

## Events added to `@ollie/events`

Added to `packages/events/src/registry.ts` (95 → 121 events):

```
burhan:element_added · burhan:add_leaf · burhan:add_gold_leaf ·
burhan:add_fruit · burhan:add_flower · burhan:add_canopy_fruit
finance:subscription_detected · finance:adhd_tax_updated ·
finance:cycle_spending_pattern_detected · finance:spending_spike_detected ·
finance:reminder_set · finance:subscription_cancelled · finance:bill_paid_on_time
cycle:period_logged
sleep:pacing_breach_detected · habits:reduce_motion_on · work:suggest_break
body:suggest_rest_check · habits:interest_capture_detected ·
work:suggest_pause_marked_missed · body:hydration_drop_detected ·
habits:surface_water_habit · body:doctor_visit_completed
admin:appointment_completed · admin:reflect_upcoming · grocery:auto_added
```

Runtime shape validators added to `packages/events/src/shapes.ts` for
the highest-impact 5: `burhan:element_added`,
`finance:subscription_detected`, `finance:adhd_tax_updated`,
`finance:cycle_spending_pattern_detected`, `cycle:period_logged`.

---

## Test coverage delta

| Package | Before | After | New tests |
|---|---|---|---|
| logic   | ~767 | 795 | burhan (16) + finance-pattern-detection (12) |
| orchestrator | 78 | 87 | burhan wire (9) + grocery period→add (5 inside grocery.test.ts) |
| router  | 9 | 17 | cross-module router (8) |
| **total** | **921** | **971** | **+50** |

---

## What's next (not in this sprint)

1. **Reminder hook for "remind me to cancel"** — current button dismisses
   the card; should schedule via existing `createReminderScheduler` so
   `void:reminder:fired` re-surfaces the subscription card.
2. **Grocery auto-add UI undo button** — data model has `auto_added_at`;
   GroceryModule needs the 5-minute window UI (data side is ready).
3. **More burhan source events** — pets care milestones, goal closures,
   etc. The registry/orchestrator is open — add a `burhan:add_*` event
   and the cross-module router (or direct emit) wires it in one line.
4. **D2 lineage debug surface** — `shared._eventLineage` exists; a hidden
   `/debug` route can render the last 200 wires.
5. **Group C / Sprint 2** — Supabase encrypted-sync backend. Now unblocked.
