# Garden / Burhan 3D — Re-Audit (2026-05-14, post commit 188a602)

> **Note for Serra:** Documents path TCC-sandboxed. File at `audits/AUDIT_garden.md`. **CRITICAL** asset path mismatch found post-188a602.

**Status:** Production-ready on render path. **CRITICAL** asset path mismatch blocks builds.

---

## TL;DR (100 words)

**Garden 3D production-ready on rendering; CRITICAL asset path mismatch blocks builds.** Commit 188a602 created `@ollie/garden` package (stage.ts: canonical thresholds 1/7/30/90/365), migrated 4 new models to `/public/models/garden/`, and removed old assets from `/public/assets/garden/`. **Problem:** code still references `/assets/garden/*` for 7 core assets (daisies, ground, dirt-pile, fence, tree-ring, signboard, path-stone) — now missing → 404 on build. Package scaffolded (stage.ts exists) but **`index.ts` missing**, no consumers wired yet. **Stage thresholds divergent:** Burhan.tsx still hardcoded 15/61/181/541 vs `@ollie/garden` 1/7/30/90/365. All 5 Burhan GLBs present; rain, dolly-lock, Drei Sky all functional. `activeDays` logic inline in Burhan.tsx, not extracted.

---

## @ollie/garden package (NEW)

| File | Status | Notes |
|---|---|---|
| `package.json` | ✓ (v0.0.1 private) | Exports `./src/index.ts` |
| `tsconfig.json` | ✓ | |
| `src/stage.ts` | ✓ (26 lines) | Canonical thresholds |
| `src/index.ts` | ❌ **MISSING** | Package exports point here; consumers can't import yet |
| `src/activeDays.ts` | ❌ | Logic still inline in Burhan.tsx |

**Canonical thresholds (`stage.ts`):**
```
0-6     → seedling
7-29    → sapling
30-89   → young
90-364  → mature
365+    → ancient
```

**Imported by:** No files currently. Package is SCAFFOLDED, not WIRED.

---

## Stage threshold divergence (P0)

| Stage | Burhan.tsx (current) | @ollie/garden (canonical) |
|---|---|---|
| seedling | < 15 | < 7 |
| sapling | < 61 | 7-29 |
| young | < 181 | 30-89 |
| mature | < 541 | 90-364 |
| ancient | ≥ 541 | 365+ |

**Consequence:** User with 30 active days is `seedling` in Burhan.tsx but `young` in @ollie/garden.

**Fix:** Update Burhan.tsx to import from `@ollie/garden` (after index.ts created) OR document divergence rationale.

---

## Asset path mismatch (CRITICAL)

### Commit 188a602 migration
**Deleted from `/public/assets/garden/`:** daisies, dirt-pile, ground, lavender-stone, signboard, tree-ring, wooden-fence, sky.exr, sky.glb, sunrise.glb

**Added to `/public/models/garden/`:** cypress.glb, dry-stone-wall.glb, hills.glb, path-stone.glb (4 NEW, not yet in code)

**Mirrored to `/ios/www/models/garden/`** (Capacitor)

### Web app references — BROKEN
7 components reference `/assets/garden/*.glb` but files DELETED from `/public/assets/garden/`:

| Component | Reference | Status |
|---|---|---|
| Daisies.tsx | `/assets/garden/daisies.glb` | ❌ 404 |
| Ground.tsx | `/assets/garden/ground.glb` | ❌ 404 |
| DirtPile.tsx | `/assets/garden/dirt-pile.glb` | ❌ 404 |
| Fence.tsx | `/assets/garden/wooden-fence.glb` | ❌ 404 |
| TreeRing.tsx | `/assets/garden/tree-ring.glb` | ❌ 404 |
| Path.tsx | `/assets/garden/path-stone.glb` | ❌ 404 |
| Signboard.tsx | `/assets/garden/signboard.glb` | ❌ 404 |

**Fix:** Either (A) vite.config.ts build hook to copy `/assets/garden/*` → `/public/assets/garden/`, OR (B) update all 7 imports to `/models/garden/` and move assets accordingly.

---

## 5 Burhan growth stages — GLBs verified

| Stage | GLB | Status |
|---|---|---|
| seedling | `/assets/burhan/seedling.glb` | ✓ |
| sapling | seedling.glb (fallback by design) | ✓ |
| young | `/assets/burhan/young.glb` | ✓ |
| mature | `/assets/burhan/burhan-v1.glb` | ✓ |
| ancient | burhan-v1.glb (fallback by design) | ✓ |

All three preloaded on mount.

---

## Functional components

| Feature | Status | Notes |
|---|---|---|
| Burhan growth (5 stages) | WORKING | All GLBs present; thresholds divergent |
| Life-event decorations | WORKING | habits:completed→leaf, cycle:period_logged→flower, finance:bill_paid_on_time→gold_leaf, finance:subscription_cancelled→fruit, admin:appointment_completed→leaf|canopy_fruit, body:doctor_visit→canopy_fruit |
| Watering/Rain (Rain.tsx) | WORKING | 600 particles, 3s duration |
| Camera dolly lock | WORKING | Polar fixed π×0.45 ≈81°, azimuth ±20°, zoom 5-11 |
| Drei Sky | WORKING | Sunset preset (Rayleigh=2, turbidity=6) |
| Canvas perf (frameloop) | WORKING | demand/always/never modes; DPR [1, 1.25]; ACES tone mapping |
| Material fixes | WORKING | metalness=0, roughness=0.85 (Meshy AI workaround); idempotent guard |

---

## Hypotheses

| Hypothesis | Outcome |
|---|---|
| @ollie/garden package shipped (188a602) | **CONFIRMED** but index.ts missing |
| 5 stage GLBs present | **CONFIRMED** (3 unique + 2 fallbacks by design) |
| Stage threshold mismatch (15/61/181/541 vs 1/7/30/90/365) | **CONFIRMED** still divergent |
| Decorations wired | **CONFIRMED** (event bus → orchestrator → store → SVG render) |
| Watering / rain | **CONFIRMED working** |
| activeDays.ts exists | **REFUTED** (inline in Burhan.tsx) |
| Asset path correct | **REFUTED** (CRITICAL: 7 core assets 404) |

---

## P0 (immediate, blocks production builds)

1. **Resolve asset path mismatch:**
   - Option A: vite.config.ts build hook to copy `/assets/garden/*` → `/public/assets/garden/`
   - Option B: Move asset sources + update all 7 component imports to `/models/garden/`
   - Verify with `pnpm -F @ollie/web build` — no 404 on asset load
2. **Create `packages/garden/src/index.ts`:**
   ```ts
   export { getStage, type Stage } from './stage.js';
   ```
3. **Unify stage thresholds:** update Burhan.tsx getStage() to match `@ollie/garden` OR document rationale

## P1 (next sprint)

4. Extract `computeActiveDays()` from Burhan.tsx → `packages/garden/src/activeDays.ts`
5. Wire Burhan.tsx to import from `@ollie/garden`
6. Plan integration of new assets (cypress / dry-stone-wall / hills) for future scenes

## P2 (polish)

7. Vitest for @ollie/garden (getStage edge cases, activeDays snapshots)
8. Draco compression audit on /public/models/ assets

---

## Top 3 next steps

1. **CRITICAL:** Fix asset path mismatch (build hook OR import update) — production builds 404 today
2. Create `@ollie/garden/src/index.ts` re-export + wire Burhan.tsx
3. Unify stage thresholds — Burhan.tsx hardcoded 15/61/181/541 conflicts with canonical 1/7/30/90/365

## BLOCKED-EXTERNAL
None.

*Re-audit by Claude (Opus 4.7), 2026-05-14, post commit 188a602.*
