# Feed Me v2 — AI Recipe Suggestion

**Status**: SPEC — Serra approved "hepsi" 2026-05-22 ~01:30 +03.

## Scope (5 directions in one)

1. **AI recipe generation** — pantry contents → Gemini → 3 dynamic suggestions
2. **Multiple suggestions** — 3 cards default (configurable), not just one
3. **Real diet filter** — vegetarian / vegan / mediterranean / turkish actually
   filters the AI prompt (today they're presentation-only)
4. **Adaptive learning** — track what user cooked, weight future suggestions by
   their pattern (frequent + thumbs-up boost, recent thumbs-down suppress)
5. **Pet feed** — `feedTarget: 'pet'` mode for pigs / tontin / pinpon; reuses the
   same endpoint with a different ModuleConfig-style brief

## Architecture

### Endpoint

`POST /feed-me/:user`

Request:
```ts
{
  pantry: string[];           // canonical names of in-pantry items
  diet?: 'all' | 'vegetarian' | 'vegan' | 'mediterranean' | 'turkish';
  feedTarget?: 'user' | 'pet';
  petName?: string;           // e.g. "tontin" — drives species-aware suggestion
  count?: number;             // default 3, max 5
  locale: 'en' | 'es' | 'tr';
  excludeDishes?: string[];   // dishes the user just rejected this session
}
```

Response:
```ts
{
  suggestions: RecipeSuggestion[];
  source: 'gemini' | 'cache_hit' | 'static_fallback';
  latencyMs: number;
}

type RecipeSuggestion = {
  dish: string;
  cuisine: string;
  diet: string[];                     // tags ['vegetarian', 'mediterranean']
  ingredients: {
    name: string;
    canonical: string | null;
    have: boolean;
    qty?: number;
    unit?: string;
  }[];
  steps: string[];                    // 3-7 short imperative steps
  prepMinutes: number;
  cookMinutes: number;
  servings: number;
  reasonSuggested?: string;           // "milk and tomatoes are turning soon"
};
```

### Cache

pgvector on the **pantry composition embedding** (sorted canonical list joined,
embedded via Voyage). Reuse `routing_cache` table with `module='feed_me'`. Same
0.85 cosine threshold; tightens to 0.92 if false positives emerge.

Cache key includes diet + feedTarget + locale (concat with text before embed).

### Adaptive scoring

New Supabase table:

```sql
CREATE TABLE cook_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dish text NOT NULL,
  cuisine text,
  diet text[],
  cooked_at timestamptz NOT NULL DEFAULT now(),
  rating smallint CHECK (rating IN (-1, 0, 1)),  -- 1=loved, 0=neutral, -1=disliked
  ingredients_used jsonb
);

CREATE INDEX cook_history_user_cooked ON cook_history (user_id, cooked_at DESC);
ALTER TABLE cook_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY cook_history_self ON cook_history FOR ALL TO authenticated USING (auth.uid() = user_id);
CREATE POLICY cook_history_service_write ON cook_history FOR INSERT TO service_role WITH CHECK (true);
```

Endpoint reads last 50 cook events for the user → folds into Gemini system
prompt as `recently cooked: [...]; loved: [...]; rejected: [...]`. Gemini
prefers loved cuisines + diet patterns, avoids recently-cooked dishes and
explicit thumbs-down.

### Pet feed mode

`feedTarget: 'pet'` switches the Gemini system prompt to a pet-specific brief:
- Species-aware (pigs eat veggies + pellets + supplements; cats need taurine; etc)
- No "cuisine" — replaced with "meal type" (morning ration / treat / supplement)
- Ingredient safety filter (no chocolate for dogs, no onion for cats, etc)
- Output schema same, only system prompt + few-shot examples differ

Pet config lives in `workers/ai-proxy/src/modules/pet-feed.config.ts`. Endpoint
auto-loads the right config based on `feedTarget`.

### Static fallback

When Gemini fails / Voyage fails / endpoint 502s, frontend falls back to the
existing `@ollie/logic/grocery` `inferRecipe` static table. Same pattern as
replenishment static SHELF_LIFE_MAP — never leaves the user hanging.

## Frontend

`FeedMeView` v2:

- **3-card layout** instead of single recipe (cards stack vertically, NOT a grid)
- Each card: dish name (32px Fraunces serif, light weight), cuisine, coverage pip
  row, soon-reframe line, ingredient have/missing split, "add missing" amber button
- **Diet pills** wired to query — switching pill triggers refetch with new diet param
- **Pet mode toggle** — small chip "for tontin" / "for pinpon" / "for the pigs"
  next to the search bar; tap to switch feedTarget
- **"I cooked this" button** — tap on a suggestion → opens a tiny modal with 3
  options: 👎 / 👍 / "just cooked" — writes `cook_history` row
- **Reject button** per card — adds dish to session `excludeDishes`, refetches
- Loading state: skeleton 3-card with `PendingHair` shimmer (same pattern as grocery)

## Telemetry

New events in `@ollie/events`:
- `feedme:requested` — `{ pantryCount, diet, feedTarget, ts }`
- `feedme:suggested` — `{ source, count, latencyMs, ts }`
- `feedme:cooked` — `{ dish, rating, ts }` (from "I cooked this" button)
- `feedme:rejected` — `{ dish, ts }` (per-card reject)

## What we're explicitly NOT doing in v1

- ❌ Recipe images (later; needs media pipeline)
- ❌ Grocery delivery integration (way later)
- ❌ Multi-day meal planning (separate module)
- ❌ Calorie / macro nutrition data (defer to v2)
- ❌ Voice-driven cook-along (defer)

## Honest effort breakdown

| Piece                                                         | Real time |
|---------------------------------------------------------------|-----------|
| cook_history migration + RLS + index                          | 30 min    |
| `/feed-me/:user` endpoint (Gemini + cache + history fold)     | 3 h       |
| Pet feed ModuleConfig (`pet-feed.config.ts`)                  | 1.5 h     |
| Frontend hook + 3-card FeedMeView refactor                    | 3 h       |
| Diet/pet toggle wire + "I cooked this" + reject               | 1.5 h     |
| Cook history write hook + telemetry events                    | 1 h       |
| Tests (DB + endpoint + frontend)                              | 2 h       |
| **Total**                                                     | **12.5 h**|

Padding for context-switching not included. With 4-agent fan-out parallel:
target wall-clock ~2 hours.

## Decisions baked in (so agents don't ask)

- **3 suggestions default**, configurable up to 5
- **Steps generated by Gemini** alongside ingredients (single API call, no
  separate "tap to see recipe" round trip)
- **Pet feed is a filter, not a separate tab** — toggle inline in feed me face
- **Diet filter routes to Gemini prompt**, not client-side filter
- **Static fallback stays** as cold-start safety net (existing `inferRecipe`)
- **Cache key includes diet + locale + feedTarget** — different diets get
  different cache entries
- **Cook history overrides cache** — when user has 5+ cooks, score with history
  even on cache hits (post-process the cached suggestions through scoring)

## Open questions parked for Serra (next session, not now)

- Recipe localization: should Gemini respond in the user's locale, or always
  EN with Serra's UI translating? Default: respond in locale.
- Recipe attribution: do we credit recipe sources (Wikipedia / NYT Cooking)?
  Default: no, treat as AI-generated, no scraped content claim.
- Cook history privacy: separate consent toggle, or rolled into existing
  research-corpus consent? Default: rolled in (already opt-in).
- Pet identity: per-pet history or one bucket? Default: per-pet (tontin's
  history ≠ pinpon's).
