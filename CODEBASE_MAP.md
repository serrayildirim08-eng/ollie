# CODEBASE_MAP.md

Fact sheet of `~/ollie/` as it stands today. No interpretation. File:line citations.

**Snapshot:** 2026-05-11 · 31 commits on `main` · last commit `d764eed`

---

## 1. STRUCTURE

### Folder layout (3 levels, no node_modules/.git/dist)

```
ollie/
├── apps/
│   ├── desktop/         Electron wrapper · scaffolded
│   ├── ios/             Capacitor iOS shell · scaffolded (no Xcode project yet)
│   └── web/             Vite + React 18 + TS · the app
│       └── src/
│           ├── components/    9 shared UI components
│           ├── design/        3 CSS files (tokens, animations, breakpoints)
│           ├── i18n/          3 locale JSONs + getString helper
│           ├── lib/           astronomy.ts (AstronomyAPI adapter)
│           ├── modules/       12 module UI folders (16,112 LOC)
│           └── pages/         4 screens (2,029 LOC)
└── packages/
    ├── events/          typed event bus
    ├── store/           localStorage facade + reactive subs
    ├── logic/           pure functional core · 20 sub-dirs
    └── orchestrator/    reactive glue · 7 wired sub-orchestrators
```

### Root files

| File | Purpose |
|---|---|
| `package.json` | pnpm workspace root · scripts: `dev`, `build`, `typecheck`, `test`, `ios:*`, `electron:*` |
| `pnpm-workspace.yaml` | globs `apps/*`, `packages/*` · `allowBuilds: { electron, esbuild }` |
| `pnpm-lock.yaml` | lockfile |
| `tsconfig.base.json` | shared TS config (ES2022 + Bundler resolution + strict) |
| `README.md` | dev/test/build instructions |

### Build setup

**Root scripts** (`package.json:6-19`):
```
dev               → pnpm --filter @ollie/web dev
build             → pnpm --filter @ollie/web build
typecheck         → pnpm -r typecheck
test              → pnpm -r test
ios:{sync,open,run}
electron:{dev,build:mac,build:win,build:linux,build:all}
```

**Web app** (`apps/web/`):
- `package.json` deps: `react@18.3.1`, `react-dom@18.3.1`, `astronomy-engine@2.1.19`, `@ollie/events`, `@ollie/logic`, `@ollie/store` (workspace links)
- `vite.config.ts:4-7` → `plugins: [react()], server: { port: 5173 }` (no manualChunks, no proxy, no PWA plugin)
- `index.html` → 12 lines · `<div id="app"></div>` · `<script type="module" src="/src/main.tsx">`

### Main app entry — what renders today

`apps/web/src/main.tsx:1-15`:
- Imports `App` + 3 CSS files (`tokens.css`, `animations.css`, `breakpoints.css`)
- `createRoot(#app).render(<StrictMode><App /></StrictMode>)`

`apps/web/src/App.tsx:1-276`:
- Wraps in `<ToastProvider>`
- Screen state machine (`App.tsx:19,31`): `'home' | 'dashboard' | 'garden' | 'module' | 'demo'` — default `'home'`
- Routes:
  - `home` (`L37`) → `<HomeScreen>` + `<ToastHost>`
  - `garden` (`L52`) → `<GardenScreen>`
  - `dashboard` (`L62`) → `<DashboardScreen>` + `<ToastHost>` + `<ChipFlyHost>`
  - `module` (`L82`) → `<ModuleScreen moduleId={selectedModule}>`
  - `demo` (`L100+`) → original scaffold demo with sample cycle prediction, FrostedCard, BurhanTree pair, ChipFly button

---

## 2. MODULES PRESENT

### apps/web/src/modules/

| Module | File | LOC | localStorage keys (via useStoreSlice) | Detectors imported |
|---|---|---|---|---|
| admin | `admin/AdminModule.tsx` | 1,536 | `admin.tasks`, `admin.patterns` | `@ollie/logic/admin` (A1–A15) |
| astrology | `astrology/AstrologyModule.tsx` | 1,452 | `astrology.birth`, `astrology.chart` | `@ollie/logic/astrology` (+ in-component Keplerian) |
| body | `body/BodyModule.tsx` | 1,983 | `body.episodes`, `body.water_log`, `body.water_target`, `body.supplements`, `body.treatment_plans`, `body.patterns`, `shared.signals`, `shared.settings` | `@ollie/logic/body` (14 detectors) |
| cycle | `cycle/CycleModule.tsx` | 957 | `cycle.items`, `cycle.settings`, `cycle.asks` | `@ollie/logic/cycle` (predictNextPeriod, detectBoundaries, detectHealthFlags, etc.) |
| dump | `dump/DumpModule.tsx` | 1,046 | `dump.items`, `journal.entries`, `journal.patterns`, `cycle.cycles` | `@ollie/logic/journal` |
| finance | `finance/FinanceModule.tsx` | 1,516 | `finance.records`, `finance.goals`, `finance.bills`, `finance.subscriptions`, `finance.adhd_tax`, `finance.transactions`, `finance.patterns`, `finance.anomalies`, `finance.settings` | `@ollie/logic/finance` |
| goals | `goals/GoalsModule.tsx` | 2,083 | `goals.items`, `goals.sessions`, `goals.reviews`, `goals.dumps`, `goals.patterns` | `@ollie/logic/goals` (G1–G16) |
| grocery | `grocery/GroceryModule.tsx` | 1,096 | `grocery.items`, `grocery.pantry`, `grocery.patterns` | `@ollie/logic/grocery` |
| habits | `habits/HabitsModule.tsx` | 863 | `habits.patterns` | `@ollie/logic/habits` (16 detectors) |
| pets | `pets/PetsModule.tsx` (+ 4 subcomponents) | 1,796 total | `pets.pets`, `pets.care_log`, `pets.observations`, `pets.care_gaps`, `pets.settings`, `pets.milestones`, `pets.away`, `pets.patterns` | `@ollie/logic/pets` |
| sleep | `sleep/SleepModule.tsx` | 985 | `sleep.records`, `sleep.settings`, `sleep.sessions`, `sleep.sounds`, `sleep.patterns` | `@ollie/logic/sleep` |
| work | `work/WorkModule.tsx` | 799 | `work.tasks`, `work.focus_duration`, `work.focus_log`, `work.patterns` | `@ollie/logic/work` (W0–W17) |

**Total module UI:** 16,112 LOC across 16 .tsx files.

### packages/logic/ sub-namespaces (20 dirs)

```
admin   astrology   body   consumption   corrections   cycle
dissection   finance   goals   grocery   habits   journal
patterns   pets   predict   products   prompts   ritual   sleep   work
```

**Logic LOC total:** 23,362 lines across all `.ts` files.

**Subpath exports** (`packages/logic/package.json:8-23`): `cycle, pets, grocery, finance, habits, sleep, work, body, goals, admin, journal, astrology, patterns`. Missing from exports: `consumption, corrections, dissection, predict, products, prompts, ritual` (importable only via the root `index.ts` namespace).

---

## 3. STORAGE LAYER

### packages/store/

| File | Purpose |
|---|---|
| `adapter.ts` | `StorageAdapter` interface · `browserAdapter` (localStorage) · `createMemoryAdapter` (tests) |
| `store.ts` | `createStore(adapter)` factory · pub/sub on key + module |
| `migrations.ts` | `runMigrations(adapter, map)` framework (no actual migration callbacks — fresh at v5) |
| `cross-tab.ts` | `installCrossTabSync(store, adapter)` via `storage` events |
| `react.ts` | `useStoreSlice(store, mod, key, default)` hook |
| `index.ts` | barrel exports |

### localStorage key layout

- `store.ts:19` → `STORE_VERSION = 5`
- `store.ts:20` → `STORE_META_KEY = 'void.state._meta.v1'`
- `store.ts:21-22` → `storeModuleKey(mod) = 'void.state.<mod>.v5'`
- `store.ts:50,69,71` → reads/writes via adapter

### Modules writing to store (from §2)

`admin`, `astrology`, `body`, `cycle`, `dump`, `finance`, `goals`, `grocery`, `habits`, `journal`, `pets`, `sleep`, `work`, `shared` (catch-all for `signals`, `settings`, `actionLog`, `patterns`, `visit_count`).

### Schema versions

Single `v5` schema. `migrations.ts` has the framework but `STORE_MIGRATIONS = {}` (empty map) — see `migrations.ts:30` `NO_MIGRATIONS`.

### Encryption

**No `packages/crypto/`, `packages/backup/`, `packages/sync/`, or `apps/api/` directories exist.**

`grep -rIlE 'AES-GCM|PBKDF2|crypto.subtle|deriveKey' packages/ apps/web/src/` → only hit is `apps/web/src/modules/sleep/SleepModule.tsx` (a string literal in copy, not real crypto). The legacy `window.VOID.backup` (AES-GCM-256 + PBKDF2 .void file export) is NOT ported.

---

## 4. ROUTER / BRAIN DUMP

### Input processing path

**Component:** `apps/web/src/components/BrainDumpInput.tsx` (110 lines). Pure UI: takes text, calls `onSubmit` prop on Enter, clears input. **Does not route anything itself.**

**Routing logic (fallback only):** `packages/logic/src/dissection/` — 314 lines total:
- `index.ts` (24 lines) → exports `extract(text, context?)`
- `fallback-route.ts` (242 lines) → keyword-based router (the ported `VOID.fallbackRoute`)
- `types.ts` (48 lines)

**Caller wiring in App.tsx:** Home/Dashboard's `onBrainDump` prop currently runs `toast.show("routed → " + text)`. There is **no call to `dissection.extract(text)` from any UI handler** in App.tsx, HomeScreen, or DashboardScreen. The router exists; nothing in the running app calls it.

### 4-step pipeline (dedup → keywords → rate-limit → Haiku)

| Step | Status in ollie | Notes |
|---|---|---|
| dedup | Not implemented in ollie | Legacy had `idempotency_key` in `VOID.router` (lines ~5561-6213 of void-app.html); not yet ported |
| keywords | Present in `dissection/fallback-route.ts` | Not called from UI |
| rate-limit | Not implemented | Legacy had session dedup cache (1h TTL) |
| Haiku | Not implemented | See below |

### Anthropic Haiku

`grep -rIlnE 'haiku|anthropic|claude.ai|@anthropic|/v1/messages' packages/ apps/web/src/`:
- `packages/logic/tests/journal.test.ts:444` → expects `model: 'claude-haiku-4-5-20251001'`
- `packages/logic/src/journal/prompt.ts:56` → constructs an Anthropic API request body with that model

**No HTTP code calls Anthropic from ollie.** The journal/prompt builder produces the request payload; nothing fires it. There is no Cloudflare Worker, no `fetch()` to the Anthropic endpoint, no API key handling in ollie.

---

## 5. CROSS-MODULE INFRA

### Event bus

**File:** `packages/events/src/`:
- `index.ts` (80 lines) → `emit(name, payload)`, `on(name, handler)`, `once(name, handler)`, `_clearAllHandlers()`
- `registry.ts` (140 lines) → **95 registered event names** (grep `^  '[a-z:_]+':` count)
- `shapes.ts` (84 lines) → runtime payload validation for ~10 highest-impact events

**Emit + listen wiring** (from grep of `packages/orchestrator/src/*.ts`):

| Orchestrator | Subscribes to (store keys) | Listens to (events) | Emits |
|---|---|---|---|
| cycle | `cycle.items`, `cycle.lastEditedByCycle` | — | `void:prediction:updated`, `void:flag:raised` |
| pets | `pets.pets`, `pets.care_log`, `pets.observations` | — | `pets:care_gap_detected`, `pets:guilt_copy_generated`, `pets:health_flag_raised` |
| body | `body.water_log`, `body.supplements`, `body.episodes`, `shared.actionLog`, `cycle.cycles`, `sleep.records` | `void:braindump:submitted` | `body:pattern_detected` |
| grocery | `grocery.items`, `grocery.pantry` | — | `grocery:pattern_detected`, `grocery:duplicate_detected` |
| sleep | `sleep.records`, `sleep.items`, `dump.items`, `cycle.cycles` | `void:braindump:submitted`, `body:pattern_detected` | `sleep:record_updated`, `sleep:pattern_detected` |
| finance | `finance.records`, `finance.items`, `dump.items` | `void:braindump:submitted` | `finance:record_added`, `finance:pattern_detected` |
| patterns | `cycle.cycles`, `cycle.items`, `sleep.records`, `finance.records`, `dump.items` | — | (writes `shared.patterns`) |

**`createOrchestrator(store)` is NEVER called in `apps/web/src/`.** `grep -rnE 'createOrchestrator|orchestrator\.init' apps/web/src/` returns nothing. The orchestrators exist as code with passing tests but are not booted by the running web app.

**Exception:** an inline astrology orchestrator is set up directly in `apps/web/src/store.ts:41-78` (subscribes to `astrology.birth`, recomputes `astrology.chart` via `computeNatalChart`).

### Reminders

`grep -rIlnE 'parseReminder|reminder:scheduled|reminder:fired|fireAt' packages/ apps/web/src/`:
- `packages/events/src/registry.ts:58-59` → `void:reminder:scheduled`, `void:reminder:fired` events declared
- `packages/events/src/shapes.ts:36` → reminder payload shape
- `packages/logic/src/prompts/index.ts:35,106-107` → `prompts.buildCandidates` reads a `reminders` array prop to detect recent fires

**No scheduling code exists.** Legacy `VOID.parseReminder` (line 29153 of void-app.html) was NOT ported. No `setTimeout(..., fireAt)`, no notification trigger, nothing fires `void:reminder:fired`.

### Crisis layer

`grep -rIlnE 'crisis|hotline|988|suicide|self.?harm'`:
- `apps/web/src/i18n/strings.en.json` → top-level `"crisis"` key with subkeys: `opener_with_name`, `opener_no_name`, `contact`, `hotline_line`, **`hotline_TR`, `hotline_US`, `hotline_GB`**, `close`
- `apps/web/src/i18n/strings.en.literal.json`, `strings.es.json` → mirror
- `apps/web/src/modules/cycle/CycleModule.tsx` → reads crisis strings
- `apps/web/src/design/tokens.css` → unrelated (different match)
- `packages/logic/src/predict/math.ts`, `packages/logic/src/habits/constants.ts` → unrelated (different match)

**Hotlines:** 3 countries (TR, US, GB). Legacy had 12 — 9 missing.

**Crisis regex bypass:** no `crisis.*regex` or `CRISIS_RE` constant exists in ollie. The crisis i18n strings are referenced from CycleModule but there's no routing layer that detects crisis input and short-circuits before pattern engines.

---

## 6. UI SHELL

### Dashboard tiles

`apps/web/src/pages/DashboardScreen.tsx:29-42` — `MODULES` constant array, 12 entries, order:

| # | id | label | emoji | sub |
|---|---|---|---|---|
| 1 | grocery | grocery | 🛒 | pantry · lists · recipes |
| 2 | pets | pets | 🐾 | care · meds · vet |
| 3 | finance | finance | 💳 | bills · goals · adhd tax |
| 4 | habits | habits | ⟳ | daily · resets at midnight |
| 5 | sleep | sleep | ◐ | wind-down · sounds |
| 6 | cycle | cycle | ○ | tracking · patterns |
| 7 | work | work | ▦ | tasks · focus · deadlines |
| 8 | goals | goals | ◎ | long-term · aspirations |
| 9 | admin | admin | ◻ | renewals · appointments |
| 10 | astrology | astrology | ✦ | chart · transits |
| 11 | body | body | ◇ | water · supplements |
| 12 | dump | dump | ∿ | thoughts · journal |

Render at `DashboardScreen.tsx:310` (`{tile.emoji}`).

### Brain dump input

`apps/web/src/components/BrainDumpInput.tsx` — 110 lines. Used by `HomeScreen.tsx`, `DashboardScreen.tsx`, `ModuleScreen.tsx`. Calls `onSubmit(text)` prop only.

### Onboarding flow

`find apps/web/src -iname '*onbo*' -o -iname '*welcome*' -o -iname '*intro*'` → **0 files**.

`strings.en.json` has an `onb` top-level key with intro/age/country/locale/menstr/goals subkeys (the legacy onboarding copy), but **no React component renders these**. Onboarding UI does not exist in ollie.

### Pages

| Page | File | LOC |
|---|---|---|
| Home | `pages/HomeScreen.tsx` | 420 |
| Dashboard | `pages/DashboardScreen.tsx` | 344 |
| Module | `pages/ModuleScreen.tsx` | 450 |
| Garden | `pages/GardenScreen.tsx` | 815 |

### Shared components

| Component | File | LOC |
|---|---|---|
| BurhanTree | `components/BurhanTree.tsx` | 476 |
| ChipFly + Host | `components/ChipFly.tsx` | 223 |
| ModuleHelp | `components/ModuleHelp.tsx` | 190 |
| SourcesLink | `components/SourcesLink.tsx` | 138 |
| BrainDumpInput | `components/BrainDumpInput.tsx` | 110 |
| Toast | `components/Toast.tsx` | 82 |
| ToastContext | `components/ToastContext.tsx` | 70 |
| ToastHost | `components/ToastHost.tsx` | 39 |
| FrostedCard | `components/FrostedCard.tsx` | 37 |

---

## 7. ASSETS

### Public dir

`apps/web/public/` — **does not exist.**

### Fonts

`grep -nE 'Inter Tight|Fraunces|DM Serif|DM Mono|DM Sans|@font-face|googleapis'`:
- `apps/web/index.html` → **no font imports**
- `apps/web/src/design/tokens.css` → declares `--font-system`, `--font-editor` CSS variables but **does not load fonts**

**No Google Fonts `<link>` tag, no `@font-face`, no font files.** Fonts referenced by tokens (`Fraunces`, `DM Serif Display`, `DM Mono`) will fall back to system serif / mono.

### Sky video

`grep -rnE 'mixkit|sky-video|skyVideo|videoUrl|skyUrl|getSkyVideo' apps/web/src/`:
- Code references in HomeScreen / DashboardScreen / ModuleScreen / GardenScreen exist (string `mixkit` URLs).
- **No `.mp4` files in `apps/web/`.** `find apps/web -type f \( -name '*.mp4' -o -name '*.mp3' -o -name '*.wav' -o -name '*.webm' \)` returned no results.

Sky video is loaded from external CDN URLs at runtime. No local copies.

### Burhan SVG

`components/BurhanTree.tsx` (476 lines) — inline SVG, no external file. Rendered at:
- `HomeScreen.tsx:268`
- `DashboardScreen.tsx:177` (mini, height=66)
- `GardenScreen.tsx:610,632` (full size, height=400)

### Sound files

No audio files in `apps/web/`. `SleepModule.tsx` references `sleep.sounds` store slice but no `<audio>` element or `Audio()` constructor exists. Legacy sound player UI was NOT ported.

### Design CSS files

| File | Imported at |
|---|---|
| `apps/web/src/design/tokens.css` | `main.tsx:4` |
| `apps/web/src/design/animations.css` | `main.tsx:5` |
| `apps/web/src/design/breakpoints.css` | `main.tsx:6` |

---

## Appendix · Test + git state

| Package | Tests | Source LOC |
|---|---|---|
| `@ollie/events` | 11 (1 file) | 304 |
| `@ollie/store` | 19 (1 file) | ~700 (6 files) |
| `@ollie/logic` | 744 (23 files) | 23,362 |
| `@ollie/orchestrator` | 41 (7 files) | ~6,800 (9 files) |
| **Total** | **815** | ~47,000 |

`apps/web/src/` (no tests yet): ~19,600 LOC across 39 files.

**git:** 31 commits on `main`, head `d764eed`.
