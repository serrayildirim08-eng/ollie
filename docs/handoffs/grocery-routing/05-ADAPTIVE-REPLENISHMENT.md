# Adaptive Replenishment Learning

**Status**: SPEC — not yet built. Serra called this out 2026-05-22 ~01:10 +03.

## Problem

Today the UI shows "2 weeks left" / "months left" badges for grocery items
straight out of a hardcoded `SHELF_LIFE_MAP` in
`workers/ai-proxy/src/modules/grocery.config.ts`:

```ts
const SHELF_LIFE_MAP = {
  milk: 7, yogurt: 21, cheese: 30, ..., bread: 7,
  pasta: 730, rice: 1825, flour: 365, ...
};
```

This is a **population average**, not Serra's average. It doesn't reflect:
- Household size (single person vs family vs pet household)
- Consumption rate (Serra drinks 1L milk/week, someone else drinks 4L/week)
- Whether the user actually finishes the item before it spoils
- Seasonal variation (more iced coffee in summer)

The badge is **lying** to the user in any case where their pattern diverges
from the population average.

## What Serra wants

> "my AI should track the last time and the current time and like adapt these
> times based on actual user data"

A per-user, per-canonical-item replenishment estimator that learns from the
user's actual purchase history.

## Design

### Data model

New Supabase table:

```sql
CREATE TABLE grocery_purchase_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  canonical text NOT NULL,           -- canonical key from grocery.config CANONICAL_ITEMS
  qty numeric,                       -- optional, when user provided
  unit text,                         -- optional
  source text NOT NULL,              -- 'pantry_add' | 'shop_checked' | 'ai_inferred'
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX grocery_purchase_history_user_canonical_ts
  ON grocery_purchase_history (user_id, canonical, ts DESC);

ALTER TABLE grocery_purchase_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY grocery_purchase_history_self
  ON grocery_purchase_history
  FOR ALL TO authenticated
  USING (auth.uid() = user_id);
```

### When to write a row

Three triggers:

1. **`pantry_add`** — user dumps "got milk" or "matcha aldım"; the dispatch's
   pantry path logs immediately.
2. **`shop_checked`** — user taps a shopping list item to mark it bought
   (assumes today is the purchase day).
3. **`ai_inferred`** — when AI classification confidence is high AND target
   resolves to pantry, write a history row too (otherwise we miss organic
   purchases captured via brain dump).

Frontend hook into `apps/web/src/store.ts` or the orchestrator's pantry write
path (`packages/orchestrator/src/braindump-dispatch.ts` grocery branch).

### Estimation algorithm

```ts
type ReplenishmentEstimate = {
  daysLeft: number;
  confidence: 'static' | 'low-data' | 'observed';
  sampleSize: number;          // how many past purchases informed this
  medianIntervalDays: number;  // user's cadence (or static fallback)
  lastPurchaseTs: number | null;
};

function estimateReplenishment(
  userId: string,
  canonical: string,
  now: number = Date.now(),
): ReplenishmentEstimate {
  const purchases = fetchLastNPurchases(userId, canonical, 10);

  // Fallback: no data, use static map
  if (purchases.length === 0) {
    return {
      daysLeft: SHELF_LIFE_MAP[canonical] ?? 14,
      confidence: 'static',
      sampleSize: 0,
      medianIntervalDays: SHELF_LIFE_MAP[canonical] ?? 14,
      lastPurchaseTs: null,
    };
  }

  // Low data: 1 purchase — show "time since last" only
  if (purchases.length === 1) {
    const daysSince = (now - purchases[0].ts) / DAY_MS;
    const staticDays = SHELF_LIFE_MAP[canonical] ?? 14;
    return {
      daysLeft: Math.max(0, staticDays - daysSince),
      confidence: 'low-data',
      sampleSize: 1,
      medianIntervalDays: staticDays,
      lastPurchaseTs: purchases[0].ts,
    };
  }

  // Observed: 2+ purchases — compute median interval, project
  const intervals = computeIntervals(purchases);  // days between consecutive purchases
  const median = medianOf(intervals);
  const daysSinceLast = (now - purchases[0].ts) / DAY_MS;
  return {
    daysLeft: Math.max(0, median - daysSinceLast),
    confidence: 'observed',
    sampleSize: purchases.length,
    medianIntervalDays: median,
    lastPurchaseTs: purchases[0].ts,
  };
}
```

Use **median** not mean — robust to outliers (one big stock-up trip
shouldn't move the average for 6 months).

### UI surface

Replace the current static badge with a confidence-aware display:

| State        | Badge text                  | Tooltip / hover                                |
|--------------|-----------------------------|------------------------------------------------|
| `static`     | `~7 days` (italic, faded)   | "based on typical shelf life — buy a few times to teach me your pattern" |
| `low-data`   | `~5 days` (regular)         | "1 purchase logged — still learning"           |
| `observed`   | `3 days` (solid, accent)    | "based on your last N purchases (avg every X days)" |

Surface confidence visually — don't pretend a static guess is observed truth.

### Backend hosting

Two options:

**A. Embed in `/route/grocery` response**
- Add `estimate: ReplenishmentEstimate` field per item in the route response.
- Worker reads `grocery_purchase_history` for the user during classification.
- Pro: single round trip. Con: adds DB read latency to every classification.

**B. Separate `/replenishment/:user` endpoint**
- Frontend fetches estimates on grocery module mount, refreshes on writes.
- Pro: classification stays fast. Con: extra request.

Recommend **B** for simplicity; classification doesn't need replenishment.

### Migration of static SHELF_LIFE_MAP

Keep the static map as the **cold-start fallback** — it seeds the estimate
for users with no history yet. Once a user logs 2+ purchases of an item,
their observed cadence takes over.

## Edge cases

- **Bulk purchase**: user buys 2L milk → estimate should scale by qty. If
  median interval is 7 days for 1L and user just bought 2L, project 14 days.
- **Pet vs human**: "hay for the pigs" has totally different cadence than
  human-eating hay. Tag items with `consumer` field (default 'user', can be
  'pet', 'household')? Defer to v2.
- **Seasonal**: weight recent purchases more than older ones. Exponential
  decay weighted median? Defer to v2.
- **Item swap**: user switches from cow milk to oat milk. History on `milk`
  canonical still feeds estimate for both. Acceptable.
- **First-time empty**: if user just downloaded the app and has no history,
  the static fallback hides this awkward moment.

## Scope tonight vs later

- ❌ NOT tonight: full table + worker + endpoint + UI
- ❌ NOT tomorrow morning: needs design pass on the UI confidence treatment
- ✅ Spec ready (this doc)
- ✅ Backend-junior can take after Day 2 split sprint settles

## Estimated effort

- Migration + table + index + RLS: 1h (backend-junior-1)
- Trigger writes in dispatch + checkbox handler: 2h (backend-junior-2)
- `/replenishment/:user` endpoint: 2h (backend-senior or junior-2)
- Frontend hook + badge component refactor: 3h (frontend-senior)
- ui-designer pass on confidence treatment: 2h

Total: ~10h. Doable in a single sprint day if the team is focused.

## Open questions for Serra (next session)

1. Median or weighted-recent-median? (Default: plain median for v1)
2. Should the static fallback show "?" instead of a number to be honest about
   uncertainty? (Default: show number, italic+faded so it reads as estimate)
3. Pet/household scope tag at v1 or defer to v2? (Default: v2)
4. Surface "you're due for milk" notifications when daysLeft hits 0? (Default:
   v2 — needs notification scheduler integration)
