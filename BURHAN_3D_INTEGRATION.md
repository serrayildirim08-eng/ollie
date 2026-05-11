# Burhan 3D Integration

Date: 2026-05-11
Route: `/garden`
Source asset: `~/Documents/Claude/Projects/void app/assets/burhan/burhan-v1.glb` (100.77 MB)
Shipped asset: `apps/web/public/models/burhan.glb` (3.83 MB / 4,017,256 bytes)

## 1. Compression

Two-stage compression. First pass (Draco only via `gltf-pipeline`) shrank the
file from 100.77 MB to 38 MB — textures dominate the budget. Second pass with
`gltf-transform optimize` did the full pipeline:

```
gltf-transform optimize burhan-v1.glb burhan.glb \
  --texture-compress webp \
  --texture-size 1024 \
  --compress draco \
  --simplify true --simplify-ratio 0.5 --simplify-error 0.001
```

Stages run: dedup → instance → palette → flatten → join → weld → **simplify
(50% decimation)** → resample → prune → sparse → **textureCompress (WebP @
1024)** → **draco**.

Final: 100.77 MB → 4.02 MB. Under the 5 MB target. No further mesh decimation
was needed.

Tooling installed as dev deps:

- `gltf-pipeline@^4.3.1`
- `@gltf-transform/cli@^4.3.0`

## 2. Runtime dependencies

Added to `apps/web`:

- `three@^0.184.0`
- `@react-three/fiber@^9.6.1`
- `@react-three/drei@^10.7.7`
- `@types/three@^0.184.1` (dev)

## 3. Components

### `apps/web/src/components/Burhan3D.tsx`

Public API. Handles graceful degradation and accessibility:

- `role="img"` + `aria-label="Burhan, an olive tree"`
- `prefers-reduced-motion: reduce` → still renders 3D model, but rotation and
  sway are disabled and `frameloop` drops to `"demand"` (one render, no GPU
  loop).
- `visibilitychange` → `frameloop="never"` while the tab is hidden; resumes
  when visible again. No background GPU work.
- `React.Suspense` fallback → the existing 2D `<BurhanTree tone="garden" />`
  SVG while the lazy `Burhan3DCanvas` chunk and `vendor-three` are fetching.
- `CanvasErrorBoundary` → if three or the model errors out, the 2D SVG renders
  permanently. The user never sees an empty screen.

### `apps/web/src/components/Burhan3DCanvas.tsx`

The actual r3f Canvas, lazy-imported. Owns:

- `useGLTF('/models/burhan.glb')` with `useGLTF.preload()` at module top so
  fetch starts the moment the chunk is parsed.
- `<Bounds fit clip observe>` + `<Center>` for automatic scaling and framing
  regardless of source model dimensions.
- Lighting: warm cream ambient (`#FFF1D9`, 0.85) + golden-hour key
  (`#FFD7A0`, 1.5, front-right-high) + cool sky fill (`#DDE8F0`, 0.35,
  back-left). No HDR environment. Background is cream (`#F5F4F0`) per spec.
- Auto-rotation: 8s / 360° (`(2π) / 8` rad/s) on Y.
- Wind sway: transform-level Z-axis sin oscillation at 0.6 Hz, amplitude
  0.018 rad (gentle, no vertex displacement shader — keeps GPU cost flat).
- `dpr={[1, 2]}` so retina is sharp but doesn't render 4× on Pro Display XDR.

## 4. Wiring

`apps/web/src/pages/GardenScreen.tsx`: the centered full-size 2D
`<BurhanTree height={400} tone="garden" ...>` was replaced with
`<Burhan3D height={440} width={440} />`. The reflection in the pool still uses
the 2D SVG (cheap, single-paint). The store slice for `burhanState` was
removed from the garden screen since the 3D model does not yet consume
life-events.

Dashboard mini Burhan (`<BurhanTree height={66} tone="home" ...>`) is
**unchanged** — too heavy for the dashboard tile, and the existing SVG
already animates correctly.

## 5. Bundle budget

`vite build` output (gzip in parens):

| chunk | raw | gzip |
| --- | --- | --- |
| `index` (entry) | 89.03 KB | 29.51 KB |
| `vendor-react` | 141.93 KB | 45.46 KB |
| `vendor-ollie` | 367.76 KB | 119.51 KB |
| `GardenScreen` | 17.18 KB | 5.21 KB |
| **`Burhan3DCanvas`** | **1.21 KB** | **0.72 KB** |
| **`vendor-three`** | **973.60 KB** | **263.57 KB** |

The first-load JS bundle (entry + vendor-react + main module graph) is
**unchanged** — `vendor-three` is in its own chunk (added a `manualChunks`
rule to `vite.config.ts`) and only fetched after the user navigates to
`/garden` AND the lazy boundary in `Burhan3D` resolves. The increase to
first-load JS is **≈0 KB** (well under the 200 KB cap).

Visiting `/garden`:

1. `GardenScreen` chunk loads (5.21 KB gz). Screen paints with 2D fallback.
2. `Burhan3DCanvas` chunk + `vendor-three` resolve (~264 KB gz). 3D mounts.
3. `/models/burhan.glb` streams in (3.83 MB). Tree appears.

## 6. Accessibility

- `prefers-reduced-motion` → static frame, no rotation, no sway, `frameloop`
  drops to demand.
- `role="img"` + `aria-label="Burhan, an olive tree"`.
- `visibilitychange` listener pauses the GPU when the tab is hidden.
- If three.js fails to import or the model fails to decode, the
  `CanvasErrorBoundary` falls back to the 2D SVG — keyboard navigation and
  screen-reader labels are preserved on the wrapper either way.

## 7. Verification

- `tsc --noEmit` — clean.
- `vitest run` — 33/33 passing (2 files, no regressions in the existing
  onboarding / brain-dump suites).
- `vite build` — succeeds in ~2.4s, `dist/models/burhan.glb` shipped at
  3.83 MB.
- `vite dev` boots; `/models/burhan.glb` is served as
  `model/gltf-binary` with `Content-Length: 4017256`.

Not verified (no browser available from this session):

- 60 fps frame rate on desktop. The component is set up for it
  (dpr clamp, simple geometry under decimation, three lights, no shadows, no
  HDR env), but a human or instrumented browser check is the only way to
  confirm.
- Time-to-interactive ≤ 2 s on mid-tier mobile.
- Memory ≤ 80 MB for the 3D scene.

Recommend a manual pass on `/garden` to confirm the 60 fps and TTI targets
on the actual target hardware.
