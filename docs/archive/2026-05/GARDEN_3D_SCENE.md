# Garden 3D Scene

Date: 2026-05-12
Route: `/garden` (gated on `shared.consent.spending_research`)

## 1. Compressed asset sizes

All `.glb` files passed through `gltf-transform optimize` with the same
pipeline used for burhan: `dedup → instance → palette → flatten → join →
weld → simplify(0.5) → resample → prune → sparse → textureCompress(webp,
1024) → draco`.

| asset             | source (MB) | shipped (MB) | target | served at                                       |
| ----------------- | ----------- | ------------ | ------ | ----------------------------------------------- |
| `burhan.glb`      | 100.77      | 3.83         | <12    | `/models/burhan.glb` (existing)                 |
| `cypress.glb`     | 87.38       | 4.47         | <10    | `/models/garden/cypress.glb`                    |
| `dry-stone-wall`  | 47.69       | 1.11         | <8     | `/models/garden/dry-stone-wall.glb`             |
| `hills.glb`       | 32.57       | 0.77         | <6     | `/models/garden/hills.glb`                      |
| `path-stone.glb`  | 34.53       | 0.91         | <5     | `/models/garden/path-stone.glb`                 |
| `lavender.glb`    | —           | —            | <5     | **placeholder** (sage sphere `<Lavender>`)      |
| **total**         | 302.94      | **11.10**    | <50    | within budget by ~78%                           |

Originals stay in `~/ollie/assets/{burhan,garden}/` for archival. The
`.min.glb` files alongside them are the build inputs. Production reads
the copies under `apps/web/public/models/`.

## 2. Component tree

```
<GardenScreen>                                  apps/web/src/pages/GardenScreen.tsx
├─ <Garden3DScene>                              apps/web/src/components/Garden3DScene.tsx
│  ├─ sky gradient div (cream → peach)
│  ├─ <CanvasErrorBoundary>
│  │   fallback: cream gradient + "garden unavailable"
│  └─ <Suspense fallback={"preparing the garden..."}>
│      └─ lazy() Garden3DCanvas                 apps/web/src/modules/garden/Garden3DCanvas.tsx
│         ├─ <Canvas dpr={[1,2]} frameloop=demand|always|never shadows>
│         ├─ lights: ambient cream + warm key (UL) + sage rim
│         ├─ <OrbitRig active={autoOrbit && animate}>
│         │   ├─ <HillsModel> × 2     (backdrop)
│         │   ├─ <CypressModel> × 2   (L+R framing, sway phase offset)
│         │   ├─ <WallModel> × 4      (mid-ground tile)
│         │   ├─ <PathStoneModel> × 5 (foreground)
│         │   ├─ <BurhanModel> (centre, raised, gentle sway)
│         │   ├─ <LifeEventSprites events={...}>
│         │   │   └─ <Billboard|sphere> × N (canopy)
│         │   ├─ <Lavender> × 4       (sage sphere placeholder)
│         │   └─ shadow-receiving ground plane
│         ├─ <DustMotes count=50>     (outside OrbitRig → screen-space drift)
│         └─ <OrbitControls enabled={false}>
├─ bottom frosted card (elements count + this-month delta)
└─ back button → home
```

Co-located helpers in `apps/web/src/modules/garden/`:

- `GardenElements.tsx` — `BurhanModel` / `CypressModel` / `WallModel` /
  `HillsModel` / `PathStoneModel` (all `useGLTF.preload()` at module
  scope so fetch starts the moment the chunk parses).
- `Lavender.tsx` — sage-green low-poly sphere cluster placeholder.
  Single component; swap internals when `lavender.min.glb` lands.
- `LifeEventSprites.tsx` — billboarded planes (leaf/flower/gold leaf) or
  small spheres (fruit/canopy_fruit) at canopy positions.
- `canopyPosition.ts` — pure helpers: `spriteFor(type)` colour/size map +
  `canopyPositionFor(event)` deterministic hash-to-spherical mapping.
- `DustMotes.tsx` — single `<points>` mesh, ~50 motes, gentle sin drift.

Shared hooks in `apps/web/src/hooks/useReducedMotion.ts`:
`useReducedMotion()` + `usePageVisible()`. Used by both `Burhan3D` (small
embed) and `Garden3DScene` (full scene).

## 3. Route wiring + consent gate

App router is `apps/web/src/App.tsx`'s `screen` state machine. The garden
branch (Decision #15) was already wired before this sprint:

```tsx
const consent = store.get<boolean>('shared', 'consent.spending_research', false);
content = consent ? <GardenScreen /> : <GardenConsentScreen />;
```

- `false` → `<GardenConsentScreen>` (cream gradient, "turn it on?" /
  "yes — open the garden" + "not now"). Accept routes the consent grant
  through `getAccount().research.grantConsent()` when the account layer
  has booted, otherwise raw store-write fallback.
- `true` → `<GardenScreen>` → `<Garden3DScene>` (lazy, suspense fallback
  is `"preparing the garden..."` in DM Mono caps over the cream
  gradient).

Both screens are already wrapped in `<Suspense fallback={<PageLoading
/>}>` at the App.tsx level. `Garden3DScene` adds its own inner
`<Suspense>` so the 3D chunk + GLB fetches don't show a blank page —
the cream gradient + label persists while `vendor-three` and the
models stream in.

## 4. Life-event sprite mapping

`spriteFor(type)` in `apps/web/src/modules/garden/canopyPosition.ts`:

| event type     | shape     | color     | size  | source (D1 emitters)            |
| -------------- | --------- | --------- | ----- | -------------------------------- |
| `leaf`         | billboard | `#7C9E87` | 0.060 | appointment kept                 |
| `gold_leaf`    | billboard | `#C9A961` | 0.070 | bill on time                     |
| `flower`       | billboard | `#E8B4B8` | 0.070 | period logged                    |
| `fruit`        | sphere    | `#8B5A3C` | 0.050 | sub cancelled                    |
| `canopy_fruit` | sphere    | `#6E4A2E` | 0.045 | doctor visit                     |

Positions are deterministic: `hashId(event.id)` →
`(theta in [0,2π], phi in [0,π/2])` → cartesian on a 0.6-radius half-dome
above the trunk at `y = 1.05`. Small per-event radial jitter so sprites
don't sit on a perfect shell.

`GardenScreen` reads `store('burhan', 'state').events`. When empty (dev,
fresh install) it falls back to 5 mock events so the canopy isn't
empty — the mock is in `GardenScreen.tsx` and is a no-op once real
events accumulate.

## 5. Performance

### Bundle (vite build, gzip in parens)

| chunk                       |    raw |    gz | when             |
| --------------------------- | -----: | ----: | ---------------- |
| `index` (entry)             |   117k |  39 k | initial          |
| `vendor-react`              |   142k |  45 k | initial          |
| `vendor-ollie`              |   378k | 123 k | initial          |
| **initial JS (no /garden)** | **637 k** | **207 k** | gz under the 250 k cap |
| `GardenConsentScreen`       |   2.2k |   1 k | lazy /garden     |
| `GardenScreen`              |   6.0k | 2.3 k | lazy /garden     |
| **`Garden3DCanvas`**        | **6.6 k** | **2.4 k** | lazy /garden + consent |
| `vendor-three`              |   960k | 260 k | lazy /garden + consent |
| **incremental on entry**    | **0 k** | **0 k** | three is fully gated |

Visit `/garden` consent → click "yes" flow:

1. `GardenConsentScreen` chunk paints (1 KB gz).
2. User accepts → `GardenScreen` + `Garden3DCanvas` chunks resolve (4.7 KB gz).
3. `vendor-three` resolves (260 KB gz, cached on second visit).
4. `/models/burhan.glb` + four garden GLBs stream (11.1 MB total).

### Runtime budgets

| target                                         | status                                           |
| ---------------------------------------------- | ------------------------------------------------ |
| `/garden` initial JS < 250 KB gz               | **207 KB gz** — passes (no /garden code in entry) |
| 3D assets total < 50 MB                        | **11.1 MB** — passes by ~78% headroom            |
| TTI on mobile < 3 s after route entry          | not measured (no instrumented browser session)   |
| Memory < 120 MB peak                           | not measured — design is single Canvas, 5 cloned scenes, ~50 points, 1024² shadow map |
| 60 fps desktop / 30 fps mobile                 | not measured — needs human pass                  |

The component design is set up for the targets: `frameloop` drops to
`demand` under reduced motion and to `never` when the tab is hidden;
`dpr` is clamped to `[1, 2]`; shadows are a single 1024² map; lighting
is three directional/ambient lights with no env HDR; meshes are decimated
50% with Draco geometry + WebP textures @ 1024.

## 6. Accessibility

- `<Garden3DScene>` wrapper sets `role="img"` +
  `aria-label="ollie's garden — your life event tree"` — the canvas is
  treated as a single image, not an interactive widget.
- `useReducedMotion()` switches `frameloop` from `always` to `demand`
  (one render, no GPU loop), disables auto-orbit, disables burhan +
  cypress sway, freezes dust motes.
- `usePageVisible()` listens to `document.visibilitychange` — when the
  tab is hidden, `frameloop="never"` (zero GPU work).
- `CanvasErrorBoundary` → if three or any GLB fails to decode, falls
  back to the cream gradient + "garden unavailable" so the user never
  sees a blank screen. Keyboard nav (back button + bottom card) keeps
  working in the fallback state.
- Back button on `GardenScreen` is a real `<button>` with
  `aria-label="back to home"` — keyboard-focusable, screen-reader-readable.
- Consent screen buttons (`yes — open the garden`, `not now`) are real
  `<button>` elements, focusable in tab order, no custom keyboard
  handlers needed.

## 7. Known gaps

- **`lavender.min.glb` is a placeholder.** Currently `<Lavender>` renders
  3 sage-green spheres. When the real GLB lands, swap the internals in
  `apps/web/src/modules/garden/Lavender.tsx` — the prop contract
  (`position`, `scale`, `seed`) is stable.
- **No measured FPS / TTI / memory.** All three are architected-for but
  not human-verified — needs a manual `/garden` pass on real devices.
- **Backend `burhan.events` emitters** are wired only for a subset of D1
  surfaces. The mock in `GardenScreen.tsx` covers the visual canopy in
  dev; in production users with no logged events will see an empty canopy
  (intentional — never seed fake data into the real store).
- **Auto-orbit defaults to off.** `Garden3DScene` accepts `autoOrbit`
  but `GardenScreen` doesn't pass it. Wire `autoOrbit={true}` if Serra
  wants the slow 10s/360° pan by default; it already honours
  reduced-motion.

## 8. How to test locally

```sh
cd ~/ollie/apps/web
pnpm dev                # vite at http://localhost:5173
# in the app:
# 1. complete onboarding (or wipe localStorage to skip → re-onboard)
# 2. navigate home → "garden"
# 3. if consent.spending_research is false (default), GardenConsentScreen
#    shows; click "yes — open the garden"
# 4. cream gradient + "preparing the garden..." → 3D scene mounts

# Reduced-motion: macOS System Settings → Accessibility → Display →
# "Reduce motion" — reload and confirm sway/orbit/dust all freeze.

# Build + verify dist:
pnpm build              # also runs `tsc --noEmit`
ls -lh dist/models/garden/   # confirm 4 GLBs shipped
pnpm preview            # serves the production build at :4173
```

## 9. Files touched

New:

- `apps/web/src/components/Garden3DScene.tsx`
- `apps/web/src/modules/garden/Garden3DCanvas.tsx`
- `apps/web/src/modules/garden/GardenElements.tsx`
- `apps/web/src/modules/garden/Lavender.tsx`
- `apps/web/src/modules/garden/LifeEventSprites.tsx`
- `apps/web/src/modules/garden/canopyPosition.ts`
- `apps/web/src/modules/garden/DustMotes.tsx`
- `apps/web/src/hooks/useReducedMotion.ts`
- `apps/web/public/models/garden/{cypress,dry-stone-wall,hills,path-stone}.glb`
- `assets/{burhan,garden}/*.min.glb` (archival copies of the compressed inputs)

Modified:

- `apps/web/src/pages/GardenScreen.tsx` — rewrote to host `<Garden3DScene>`
  full-bleed; removed the 2D SVG sky/arches/pool/pots in favour of the
  3D scene. Kept the bottom frosted card (elements count) and the back
  button.

Untouched:

- `apps/web/src/components/Burhan3D.tsx` + `Burhan3DCanvas.tsx` — the
  small burhan embed used elsewhere (demo screen) still works
  independently. The new `Garden3DScene` does not depend on it.
- `apps/web/src/pages/GardenConsentScreen.tsx` — consent gate already
  shipped in Sprint 4.
- `apps/web/vite.config.ts` — the existing `vendor-three` chunk rule
  picks up the new garden modules without change.

## Fix pass 1 — 2026-05-12

Five render fixes against the first live browser pass.

1. **Cypress rendering black** → added `<hemisphereLight args={['#FDF4D6','#7C9E87',0.6]} />`, bumped ambient `0.4 → 0.55` and key directional `1.2 → 1.6`. Dense MeshStandard foliage needed sky/ground fill from every upward normal; hemisphere is the cheap fix that preserves the golden-hour key shaping. Sage rim nudged `0.2 → 0.25`.
2. **Floating debug box mid-air** → traced to `canopyPositionFor` placing sprites with `phi=0` at the apex of a sphere centred y=1.05, ~0.6m above burhan's actual canopy. Rewrote: phi band `[0.18π, 0.5π]` (no apex), centre y=1.25, radius 0.35 — sprites now land on the canopy surface instead of hovering above it. No stray `<Box>` or fallback primitive found in any module or GLB.
3. **Path stones not coplanar** → all GLBs are bbox-centred (y∈±0.137), so `y=0` left every stone half-buried and the apparent floor varied with scale. Lifted each by `0.137 * scale` so the *base* (not the centre) sits on y=0.
4. **Burhan pot floating** → confirmed by inspecting burhan.glb accessor bounds: bbox is centred (y_min = -0.817). At `position.y=0.18` the pot was 0.64m below the invisible ground plane — reading as a tree on no floor. New position `y = 0.817` puts the pot base exactly on the shadow-receiving ground plane.
5. **Lavender placeholders @ 0.3 opacity** → added `placeholder` prop (defaults `true` until `lavender.min.glb` lands), set `MeshStandardMaterial { transparent: true, opacity: 0.3, depthWrite: false }`. Swap to the real GLB by passing `placeholder={false}` and replacing the sphere mesh.

Files touched:

- `apps/web/src/modules/garden/Garden3DCanvas.tsx` — lighting, path-stone Y, burhan Y
- `apps/web/src/modules/garden/canopyPosition.ts` — phi band + canopy centre
- `apps/web/src/modules/garden/Lavender.tsx` — placeholder prop, transparency

Build/test:

- `pnpm --filter @ollie/web typecheck` — clean
- `pnpm --filter @ollie/web test` — 59/59 passed
- `pnpm --filter @ollie/web build` — built in 2.43s, no new warnings (only pre-existing >500kB vendor-three chunk and notifications dynamic-import notice)


## v2 rebuild — 2026-05-12

Full rebuild of the /garden scene against Serra's v2 spatial spec. Previous
state read as "assets dumped into a viewer" — Burhan on the wall, path tiles
floating, cypresses black, lavender ghosts. v2 rebuilds positioning + lighting
from scratch.

### Layer-by-layer summary

| Layer | File | Notes |
| --- | --- | --- |
| Camera | `GardenCanvas.tsx` | PerspectiveCamera [4, 2.5, 6] fov=45. OrbitControls target=[0,0.5,0], no pan, dist 3–10, polar 0.15π–0.48π, damping (off under reduced-motion). |
| Lighting | `Lighting.tsx` | 3-point: warm key (1.2) from [6,8,4], cool fill (0.3) from [-4,3,-2], hemisphere wash 0.4. Ambient 0.55 cream. Shadows 2048². |
| Ground | `Ground.tsx` | Flat 40×40 warm-sand (#d4c3a0) plane at y=0, receiveShadow, roughness 0.95. |
| Sky | `SkyDome.tsx` | Inverted r=50 sphere, BackSide cream (#f0e8d8). |
| Hills | `Hills.tsx` | One Clone at [0,-0.5,-8] scale 1.5, no cast. |
| Wall | `StoneWall.tsx` | One Clone at z=-3 (behind Burhan, not under). |
| Cypress | `Cypress.tsx` | Left at [-3.5,0,-1.5] s=1.1, right at [3.2,0,-2.2] s=0.95. castShadow. |
| Lavender | `LavenderPlaceholder.tsx` | 4× translucent purple-grey spheres with `<Html>` "lavender placeholder" tag. Marked, not silent. |
| Path | `StonePath.tsx` | 6 cloned tiles z∈[-1,4] at y=0.02 in slight curve with rotation jitter. |
| Burhan | `Burhan.tsx` | Hero at [0.4, 0.817, 0] rot [0,-0.2,0]. LifeEventSprites nested inside group. |

### Files added

```
apps/web/src/garden/
├── Burhan.tsx
├── canopyPosition.ts        (moved from modules/garden/)
├── Cypress.tsx
├── GardenCanvas.tsx
├── GardenScene.tsx
├── Ground.tsx
├── Hills.tsx
├── LavenderPlaceholder.tsx
├── LifeEventSprites.tsx     (moved from modules/garden/, simplified to local space)
├── Lighting.tsx
├── SkyDome.tsx
├── StonePath.tsx
└── StoneWall.tsx
```

### Files deleted

- `apps/web/src/components/Garden3DScene.tsx`
- `apps/web/src/modules/garden/Garden3DCanvas.tsx`
- `apps/web/src/modules/garden/GardenElements.tsx`
- `apps/web/src/modules/garden/Lavender.tsx`
- `apps/web/src/modules/garden/DustMotes.tsx` (dropped per "no atmosphere in v2 brief")
- `apps/web/src/modules/garden/LifeEventSprites.tsx` (relocated)
- `apps/web/src/modules/garden/canopyPosition.ts` (relocated)

### Burhan y-position

`y = 0.817` — derived from burhan.glb accessor `min.y = -0.817` (pivot at
trunk base, not pot bottom). Confirmed in code at
`apps/web/src/garden/Burhan.tsx:14` via exported `BURHAN_Y` constant. Same
value as the prior session's lift, preserved.

### Bundle size

- `GardenCanvas-*.js`: 4.74 kB (gzip 1.82 kB)
- `GardenScreen-*.js`: 5.60 kB (gzip 2.21 kB)
- `vendor-three-*.js`: 974.54 kB (gzip 264.44 kB) — unchanged, lazy-loaded on /garden enter
- Build time: 2.38s
- No new chunk warnings; only pre-existing vendor-three >500kB and the
  `notifications` dynamic-import notice.

### Validation

- `pnpm --filter @ollie/web typecheck` — clean
- `pnpm --filter @ollie/web test` — 66/66 passed
- `pnpm --filter @ollie/web build` — built in 2.38s

### Acceptance items verified in code

1. Cypress trees readable — hemisphere fill 0.4 + ambient 0.55 in `Lighting.tsx`.
2. Burhan pot flush on ground — `BURHAN_Y = 0.817` cancels glb min.y.
3. Burhan in front of wall — wall at z=-3, Burhan at z=0.
4. Path tiles flush — y=0.02 in `StonePath.tsx:POSITIONS`.
5. Lavender visibly placeholder — translucent + `<Html>` tag in `LavenderPlaceholder.tsx`.
7. Shadows — `shadows` on Canvas, `castShadow` on all heroes, `receiveShadow` on Ground.
10. Build/test/typecheck — all clean.

### Acceptance items requiring Serra's visual verification

- (6) Orbit camera at all bounds → coherent scene, no white voids/clipping
- (8) No console errors / NaN / z-fighting at runtime
- (9) Initial load under 4s on broadband
- Overall taste read: warm light catches cypress tops, wall behind Burhan,
  path leads eye in, lavender placeholders read as "TODO" not as ghosts.

### Notes

- No screenshot tool available; visual verification is on Serra.
- Dust motes + wind sway dropped per v2 brief silence on atmosphere; reduced
  motion still honoured by disabling OrbitControls damping.
- `frameloop="demand"` (not "always") — idle CPU ~0; drei re-invalidates on
  pointer/wheel + damping ticks so drag stays smooth.
- LifeEventSprites are now children of `<Burhan>` (burhan-local space) instead
  of world-space — they orbit with the tree.
- Not committed. Awaiting Serra's visual verification.
