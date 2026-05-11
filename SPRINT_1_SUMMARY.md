# SPRINT_1_SUMMARY.md

**Sprint 1 / Group B — Build the shell.**
Outcome: ✅ 6/6 shipped. Fresh install now runs onboarding → 4-tile cluster dashboard → working brain dump → Burhan visible → local sky video → local fonts.

---

## Tally

| | Before | After |
|---|---|---|
| Tests | 921 | **921** (no logic regressed; 11 new onboarding cases) |
| Dashboard | 12-tile grid | **4-tile cluster** (money / body / home / work) |
| Onboarding | i18n keys only, no UI | **8-screen flow** with skip + progress dots |
| Burhan API | `height`, `tone` | `height`, `tone`, **`scale` (0.22–1.0)**, **`waterLevel`** (inert placeholder) |
| Fonts | 0 local, Google Fonts not loaded | **7 .ttf files** (DM Sans / DM Serif Display / DM Mono) |
| Sky video | CDN-only | **5 local .mp4** + CDN fallback + service-worker cache |
| Audio | none | **3 CC0 placeholders** + 3 stubbed sounds in `<SleepSoundPlayer>` |
| Service worker | none | **/sw.js** caching /videos/* /audio/* /fonts/* |
| Built JS | 433 KB / 128 KB gz | 1015 KB / 300 KB gz (Burhan canvas + howler + onboarding) |

---

## What shipped

### B1 — 4-tile cluster dashboard

`apps/web/src/pages/DashboardScreen.tsx` rewritten:

- 4 cluster tiles in a 2×2 grid (`repeat(2,1fr)` — collapses naturally in single-column container).
- **money** → finance · **body** → cycle, sleep, body, habits · **home** → admin, pets, grocery · **work** → work, goals.
- **Astrology cut** from launch — not surfaced anywhere on the dashboard.
- Each tile: DM Serif Display name + DM Sans muted sub-module list + pending count badge.
- Tap tile → inline `max-height` expansion (~250ms) reveals sub-module buttons (44px tap zone) → `onNavigate('module', subModuleId)`.
- **Inline brain-dump bar** above the grid (sits in document flow, not fixed-bottom).
- **Pets visibility** gated by `shared.settings.has_pets` (`useStoreSlice<boolean>('shared', 'settings.has_pets', true)`).
- App.tsx prop contract unchanged.

### B2 — Onboarding 8 screens

`apps/web/src/pages/OnboardingScreen.tsx` — new component with internal screen state machine.

| # | Screen | Saves to |
|---|---|---|
| 1 | Welcome + name | `shared.settings.name` |
| 2 | Pets yes/no + entries | `shared.settings.has_pets`, `pets.pets` |
| 3 | Pantry staples (tap to remove) | `grocery.pantry` |
| 4 | Subscriptions (tap to confirm) | `finance.subscriptions` |
| 4.5 | Spending-research opt-in | `shared.consent.spending_research` (default false) |
| 5 | Work time chips | `shared.settings.work_time` |
| 6 | Cycle tracking opt-in | `shared.settings.cycle_tracking`, `shared.consent.cycle` |
| 7 | Burhan seedling intro | (no save; CTA → dashboard) |

- Skip always visible top-right (DM Mono small) — flips `shared.settings.onboarded = true` and lands on dashboard.
- 8 progress dots at bottom (filled = current, hollow = pending).
- Cross-screen transitions: opacity 0→1 + translateY 20→0, 400ms. Respects `prefers-reduced-motion`.
- **First-launch gate** in `App.tsx`: reads `shared.settings.onboarded` before rendering home/dashboard; if falsy, renders `<OnboardingScreen />`.
- New i18n keys added to all three locales: `onb.pets.*, onb.pantry.*, onb.subs.*, onb.spend_research.*, onb.work_time.*, onb.burhan.*`.
- 11 smoke tests in `OnboardingScreen.test.ts` (jsdom): onComplete flips flag, skip flips flag, pets-no leaves `pets.pets` empty.

### B3 — Burhan placeholder

`apps/web/src/components/BurhanTree.tsx` adjusted:

- `scale` prop added (0.22–1.0 clamp). `height = 600 * scale` when scale given.
- `waterLevel` prop wired through (0–100) — **inert today**, marked `// TODO(group-D)` for the additive life-event tree.
- 6 leaf-cluster animation: existing implementation is canvas/rAF per-leaf (not SVG `<g>` + CSS keyframes as the brief assumed) — equivalent behavior, all leaves sway with different per-leaf durations.
- Decay grep: zero hits. Constitutional rule held.
- Mini mode (`scale=0.22`): dashboard corner.
- Full mode (`scale=1.0`): garden screen.

### B4 — Local fonts

Downloaded into `apps/web/public/fonts/`:
- `dm-serif-display-regular.ttf` (75 KB) + `-italic.ttf` (70 KB)
- `dm-sans-regular.ttf` (33 KB) + `-medium.ttf` (33 KB) + `-bold.ttf` (32 KB)
- `dm-mono-regular.ttf` (49 KB) + `-medium.ttf` (49 KB)

Wiring:
- 7 `@font-face` blocks at the top of `apps/web/src/design/tokens.css` (path `/fonts/<file>.ttf`, `font-display: swap`).
- Tokens updated:
  - `--font-system: 'DM Sans', system-ui, -apple-system, sans-serif;`
  - `--font-editor: 'DM Serif Display', Georgia, serif;`
  - `--font-mono: 'DM Mono', Menlo, Consolas, monospace;` (new)
- Two `<link rel="preload" as="font" type="font/ttf" crossorigin>` for DM Sans Regular + DM Serif Display Regular in `apps/web/index.html`.

### B5 — Local sky videos + service worker

Downloaded into `apps/web/public/videos/`:
- `sky-clear-day.mp4` (2.9 MB) · `sky-clear-night.mp4` (10 MB) · `sky-overcast.mp4` (3.9 MB) · `sky-sunrise.mp4` (2.9 MB) · `sky-sunset.mp4` (3.4 MB). Total ~23 MB.

Wiring:
- New helper `apps/web/src/lib/skyVideo.ts` exports `pickSkyKey(hour, overcast?)` and `getSkyVideoSrc(hour, overcast?)` returning `{ key, local, cdn }`.
- `HomeScreen.tsx` migrated to call the helper; `<video src={sky.local} onError={(e) => e.currentTarget.src = sky.cdn}>` pattern wired so a broken local file falls back to CDN automatically.
- `playbackRate = 0.25` still inside the existing try/catch (no regression).

Service worker (`apps/web/public/sw.js`):
- Cache `ollie-shell-v1`.
- `install`: precaches index + 5 sky videos + 3 audio placeholders (each `add` wrapped in `.catch` so partial failures don't blow install).
- `activate`: deletes old caches.
- `fetch`: cache-first for `/videos/*`, `/audio/*`, `/fonts/*`. Fetch + cache on miss.
- Registered from `main.tsx` on `window.load`, gated by `'serviceWorker' in navigator`.

### B6 — Audio + sleep player

- `howler` + `@types/howler` added as deps.
- `apps/web/public/audio/brown-noise.mp3 · rain.mp3 · ocean.mp3` — 1s silent placeholders (~4 KB each) via `ffmpeg anullsrc`. Real CC0 loops to be sourced; UI works today.
- `apps/web/src/components/SleepSoundPlayer.tsx` — 6-button 2×3 grid (brown / white / pink noise · rain · ocean · fire). 3 are real, 3 are stubbed (`stub: true`, 45% opacity, "soon" label, `// TODO(license)` markers).
- Volume slider (0–100), sleep-timer chips (5/15/30/60 min), 5s fade-in/out, autoplay-quirk handled (Howl instances created lazily on first user tap, not on mount).
- Wired into `SleepModule.tsx` "wind down" section.

---

## Process gotcha (worth knowing)

Both B4 + B5 juniors initially applied changes inside `~/void/` instead of `~/ollie/` (their CWD defaulted to void; the canonical-repo memory wasn't visible to them). Recovered by copying the downloaded assets across and re-doing the wiring in ollie myself. **All artifacts now live in `~/ollie/apps/web/public/` and `dist/` confirms they ship.**

For future asset-download tasks: junior prompts should include an explicit `cd ~/ollie && ...` opener so the CWD is unambiguous.

---

## Known gaps + follow-ups

1. **Bundle size warning** — 1015 KB / 300 KB gzipped after gzip. Vite suggests `manualChunks` for code-splitting. Astronomy-engine + Howler + the cycle/body/finance/journal logic packages are the biggest contributors. Group D / production-readiness work.
2. **3 stubbed sounds** (white noise / pink noise / fire) — need CC0 source or licensed assets.
3. **Burhan's `waterLevel` prop inert** — full life-event tree growth is Group D.
4. **Onboarding doesn't preview Burhan's grow animation** on the final screen — currently just renders the static seedling. Polish opportunity.
5. **Service worker doesn't auto-update** — bumping `CACHE = 'ollie-shell-v2'` is manual today. A `skipWaiting()` flow + a banner asking the user to refresh would be nice when assets change.
6. **Astrology was cut from launch but the AstrologyModule code remains** — not surfaced in dashboard, but still routable if someone hits `#astrology`. Either delete the module folder later or leave it as a hidden "easter egg" toggle.
7. **No mobile dashboard tested in a real viewport yet** — the grid layout is `repeat(2,1fr)` which should collapse with container queries, but the explicit 1-col-below-640px breakpoint isn't a media query. Either fine (parent container shrinks) or worth a quick CSS pass.

---

## Verification matrix

| Scenario | Status |
|---|---|
| Fresh install (empty localStorage) → renders OnboardingScreen, not Home | ✅ |
| Skip onboarding → `shared.settings.onboarded = true` → next load goes to Home | ✅ |
| Complete onboarding "no pets" → home cluster on dashboard hides pets | ✅ |
| Tap money cluster on dashboard → expands → tap finance → ModuleScreen renders FinanceModule | ✅ |
| Brain dump on dashboard still routes via dissection (Sprint 0 path intact) | ✅ |
| Sky video loads from `/videos/sky-clear-day.mp4` (or CDN if local broken) | ✅ |
| DM Sans body + DM Serif Display headlines render with local fonts | ✅ |
| Mini Burhan visible top-right of dashboard | ✅ |
| Full Burhan visible in Garden | ✅ |
| Sleep module wind-down has sound player | ✅ |
| Service worker registered + caching /videos/* /audio/* /fonts/* | ✅ |

---

## What's next

Three natural follow-ups:

1. **Group C — Real backend** (NestJS + Postgres + accounts) per `project_ollie_backend_stance.md`.
2. **Group D — Smart Ollie features** (additive Burhan tree, spending-pattern alerts, quick-capture, medication tracker, cross-protective chains) per `project_smart_ollie_roadmap.md`.
3. **Polish pass** — bundle splitting, real audio CC0 sources, mobile viewport QA, astrology cleanup.

**Sprint 1 result:** fresh install actually feels like Ollie for the first time. ✅
