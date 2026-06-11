# Garden — 3D Asset Production Brief

Date: 2026-05-18
Pairs with: `GARDEN_GAME_DESIGN.md` (the game) · `GARDEN_3D_SCENE.md` (the scene)
Tool: **Meshy.ai**

> This brief says **what to make** and **how to export it** so assets drop
> into the garden without the triangle-soup crash we hit with `daisies.glb`
> (2.17M verts, 324K disconnected fragments, ~88 MB GPU — froze WebGL).

---

## 0. Meshy.ai production rules — READ FIRST

The daisy disaster had three causes. Every rule below kills one:

1. **One UNIT per asset — never a field.** `daisies.glb` was a whole baked
   field of daisies. Make **one daisy**; the code instances it 20×. Same for
   grass, pebbles, flowers. One tree, one herb, one mushroom — per file.

2. **Remesh in Meshy before download.** Meshy's raw mesh is high-poly and
   often non-manifold "triangle soup". In Meshy's **Remesh** step:
   - topology: **Quad** (gives clean connected geometry — this alone would
     have prevented the soup)
   - target polycount: **low** (see budgets below)
   - Download the *remeshed* asset, not the raw generation.

3. **No baked ground / backdrop.** Don't let the prompt add a base plate,
   terrain disc, or sky. Just the object, floating, neutral. We place it on
   our own ground.

Other rules:
- Export **GLB**, PBR textures, 1024px.
- Real-world scale doesn't matter — we scale in code. Just keep it **one
  object, centred, upright**.
- Every Meshy download still goes through our processing pipeline (§4)
  before it lands in `public/models/` — non-negotiable.

### Poly budgets (triangles, AFTER processing)

| asset class | budget | examples |
|---|---|---|
| hero | ≤ 40K | Burhan |
| zone scenery | ≤ 15K | orchard tree, big shrub |
| plantable | ≤ 6K | herbs, small flowers, fruit bush |
| small prop | ≤ 3K | lantern, mushroom, stepping stone |
| scatter unit | ≤ 800 | one daisy, one grass tuft, one pebble |

---

## 1. What the garden needs

The game (GARDEN_GAME_DESIGN.md) is a cozy expanding garden — Burhan at the
centre, one zone per module, slot-based planting. Assets fall into three
buckets:

- **Plantables** — what the player puts in slots (the game objects).
- **Zone scenery** — the static identity of each zone.
- **Hero + polish** — Burhan stages, environment dressing.

---

## 2. Asset list — prioritised

### P1 · unblocks the built habits zone + the hero

The habits zone ("herb beds") is live with placeholder geometry (`Plant.tsx`,
kinds `sprout` / `bloom` / `bush`). Three real herbs replace those — the
`PlantKind` enum stays, each kind just maps to one asset:

| # | asset | maps to kind | notes |
|---|---|---|---|
| 1 | `herb-chamomile` | `bloom` | small white-petal flower clump |
| 2 | `herb-lavender` | `sprout` | upright purple spike |
| 3 | `herb-sage` | `bush` | low rounded silvery-green shrub |
| 4 | `burhan-sapling` | — | real stage between seedling + young (today falls back to seedling) |
| 5 | `burhan-ancient` | — | grand old Burhan (today falls back to mature) |

> One model per herb. Growth (0–3) is **scale** in code — no separate
> per-stage models needed. Variant (colour) is a **material tint** in code —
> Meshy gives one neutral/light texture, we tint it.

### P2 · the next zones (expansion)

| zone | assets |
|---|---|
| finance · "orchard" | `fruit-tree-young` (≤15K), `berry-bush` (plantable), loose `fruit` pickup |
| body · "pond bank" | `pond-surface` (flat water mesh — can be in-code), `reeds`, `water-iris` (plantable) |
| admin · "stone path" | `stepping-stone`, `stone-lantern`, `low-planter` (plantable: potted plant) |
| dump · "quiet corner" | `compost-bin`, `mushroom-cluster`, `garden-bench` |

### P3 · polish

- `watering-can` — show it during the "water ollie" action (currently just rain)
- `garden-gate` / arch — entrance framing
- `potted-plant` — generic filler
- `butterfly` / small bird — static mesh, animated in code

### Already made — reuse, don't remake

`cypress.glb`, `hills.glb`, `dry-stone-wall.glb` are produced but unused.
Fold them in: cypress + hills as orchard / pond backdrop, dry-stone-wall as
the admin or body zone border. (They are also high-poly — run them through
§4 first.)

---

## 3. Meshy prompt seeds

Base template — append to every prompt:

> *"…, low-poly stylized, soft matte finish, single object, upright, neutral
> centred pose, no ground plane, no base, warm muted natural palette."*

Per-asset starting prompts:

| asset | prompt seed |
|---|---|
| herb-chamomile | "a small chamomile herb plant, a few white daisy-like flowers on thin green stems" |
| herb-lavender | "a single lavender plant, one upright purple flower spike, slender grey-green leaves" |
| herb-sage | "a low rounded sage shrub, soft silvery-green leaves, compact bushy form" |
| burhan-sapling | "a young slender tree sapling, thin trunk, a small sparse leafy crown" |
| burhan-ancient | "an ancient majestic tree, thick gnarled trunk, broad full canopy, weathered bark" |
| fruit-tree-young | "a young citrus fruit tree, slender trunk, round leafy crown with a few small fruits" |
| stone-lantern | "a small Japanese-style stone garden lantern, weathered grey stone" |
| compost-bin | "a small wooden garden compost bin, slatted planks, open top" |
| watering-can | "a vintage metal watering can, rounded body, long spout" |

Keep Ollie's palette in mind: ceramic / cream / sage / sky / soft blush. If
Meshy's texture comes out garish, neutralise it — we can tint in code.

---

## 4. Processing pipeline — every Meshy asset goes through this

Meshy output is never drop-in ready. The fix pipeline (proven on the daisy
repair):

```
1. distance-weld   → reconnect triangle soup    (Blender "Merge by Distance"
                      equivalent — node script)
2. simplify        → topology-preserving decimation to the poly budget
3. draco + webp    → geometry + texture compression
4. inspect         → confirm verts under budget, bbox sane
```

The daisy repair took it 2.17M → 66K verts, 7.6 MB → 1.1 MB, with no visual
rebuild. **Next step: wire this into a repo tool** — `tools/meshy-to-garden`
— so processing any new asset is one command. (Scaffolding lives in
`/tmp/daisycrop/` from the daisy session; it should move into the repo.)

Until then: each asset is processed by hand via `@gltf-transform/cli` +
the distance-weld script.

---

## 5. Suggested order of work

1. **P1 herbs (1–3)** — they replace ugly placeholders in the *built* zone;
   biggest visible payoff. Pick one (`herb-lavender`) as the pipeline
   test-drive end to end.
2. **Burhan sapling + ancient (4–5)** — completes the hero's 5 stages.
3. **`tools/meshy-to-garden` script** — before P2, so the orchard/pond/etc.
   assets process in one command instead of by hand.
4. **P2 zones**, in build order (finance → body → admin → dump), each landing
   with `GARDEN_GAME_DESIGN.md` Phase 2.
5. **P3 polish** last.

*Brief by Claude (Opus 4.7), 2026-05-18. Pairs with the garden game design.*
