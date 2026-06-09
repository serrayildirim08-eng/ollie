# ollie · audit report · 2026-05-12

Audit scope: full monorepo on `main` at commit `b545a16`. No uncommitted changes (`git status` clean). Tests run from a clean checkout. All file:line refs verified by reading the file.

---

## 1. WHAT'S ACTUALLY RUNNING

### Boot path (web)
- Entry: `apps/web/index.html` → mounts `<div id="app">`, loads `apps/web/src/main.tsx`.
- `main.tsx:9` calls `bootAccount()` which instantiates `@ollie/api`, `@ollie/auth`, `@ollie/sync`, `@ollie/research-stream` (`apps/web/src/lib/account-boot.ts:58`). No sign-in screen consumes them (see §3, §4).
- `main.tsx:23` boots the notification layer + savings digest loop.
- `main.tsx:28` registers `sw.js` (caches `/videos/* /audio/* /fonts/*`).
- `main.tsx:35` renders `<App/>` from `apps/web/src/App.tsx`.

### First-paint screen
- `App.tsx:43-45` reads `shared.onboarded` from localStorage. If false → `<OnboardingScreen/>` (8-screen first-launch flow, `pages/OnboardingScreen.tsx:1-19`).
- If true → `<HomeScreen/>` is the default (`App.tsx:74`). Home shows: glassy sky video + sky orb + "ISTANBUL · 14° · CLEAR" hard-coded location pill (`pages/HomeScreen.tsx:196,219`) + Burhan 3D tree + inline brain-dump input + bottom mic button.
- From Home the user can navigate to Dashboard (4-cluster grid) or Garden. Garden requires `shared.consent.spending_research === true`, otherwise `<GardenConsentScreen/>` (`App.tsx:108-121`).

### Flows that WORK end-to-end (verified by tracing code, not just commit messages)
1. **Onboarding 8 screens** → writes `shared.name`, `shared.settings.has_pets`, `consent.spending_research`, `consent.cycle`, `pets.pets`, `grocery.pantry`, `finance.subscriptions`, `shared.onboarded=true` (`pages/OnboardingScreen.tsx:155-201`). Persisted to localStorage via `browserAdapter` (`apps/web/src/store.ts:27`). Reload → returns to dashboard. Verified: `pages/OnboardingScreen.test.ts` covers the writes (though with stale flat-key schema — see §5/§9).
2. **Brain dump → routing**. Typing into `BrainDumpInput` calls `useApplyBrainDump()` (`hooks/useApplyBrainDump.ts:46`). Pipeline: crisis guard → reminder parse → dissection keyword router (`@ollie/logic/dissection`) → `applyRoute()` writes to per-module store keys → chip animation → "routed → X" toast. End-to-end traceable. `hooks/useApplyBrainDump.test.ts` has 22 green tests covering this.
3. **Crisis path**. Match → emit `void:crisis:detected` → render localized hotline string (`useApplyBrainDump.ts:55-67`). 11 country hotlines + 1 international (`i18n/strings.en.json:hotline_*`).
4. **Cycle: log period → Burhan flower**. Orchestrator emits `cycle:period_logged` (`packages/orchestrator/src/cycle.ts`) → Burhan orchestrator appends `flower` event to `burhan.state` (`packages/orchestrator/src/burhan.ts`) → `DashboardScreen.tsx:128` reads `burhan.state` → passes `lastN(state,12)` to `<Burhan3D lifeEvents={…}/>` (`pages/DashboardScreen.tsx:281`). Verified end-to-end.
5. **Reminder set via brain dump**. `parseReminder()` produces a scheduled item → `reminderScheduler.add()` (`useApplyBrainDump.ts:74-77`). Single shared scheduler exported from `store.ts:122`. Fires → emits `void:toast` → caught by listener in `App.tsx:57`. Verified chain.
6. **Garden consent gate**. Default off → user sees `GardenConsentScreen`. Accept → flips `consent.spending_research`, ALSO calls `research.grantConsent()` if account-boot has run (`pages/GardenConsentScreen.tsx:32-37`).
7. **Voice capture**. `MicButton` (`components/MicButton.tsx`) renders unconditionally after onboarding (`App.tsx:336`). Web uses `webkitSpeechRecognition` (Chrome/Safari only). Transcript → toast "heard · …" → routes via `useApplyBrainDump`. Desktop wires Cmd+Shift+Space (`apps/desktop/main.js` registers globalShortcut, per recent commit b545a16). iOS path is documented but not deployed.
8. **Service worker offline reload**. `apps/web/public/sw.js` caches static assets. After first load, reload offline works for cached chunks.

### Flows that ALMOST work but are broken
- **Multi-device sync**. `bootAccount()` instantiates `auth + sync + research` but **NO sign-in/sign-up UI exists in `apps/web/src/`**. `grep` for `auth.signIn|auth.signUp` in apps/web returns zero hits outside `lib/account-boot.ts`. Without a sign-in screen, `attachSync()` never fires → encrypted sync never happens. The promise is plumbing-only.
- **iOS shell**. `apps/ios/` has Capacitor config + INTENTS.md, but `pnpm cap add ios` has not been run. `pnpm -r build` fails on the ios target because xcodebuild requires Xcode (not Command Line Tools): `xcode-select: error: tool 'xcodebuild' requires Xcode`.
- **APNs push**. `apps/api/wrangler.toml:32` has `id = "REPLACE_AFTER_wrangler_kv_create_DEVICE_TOKENS"`. Worker is not deployed. `SCHEDULED_JOBS_ENABLED="0"`. No `.p8` key in any env or secret.
- **4 of 6 cross-module chains terminate without UI**. Detectors emit, router writes reflect targets — but `body.protective_cards`, `shared.reduce_motion_today`, `admin.reflected`, `habits.surface_water_habit` have NO `useStoreSlice` consumers anywhere in `apps/web/src/` (grep returns zero). Only `finance.protective_cards` + `finance.cycle_card_visible` render (`modules/finance/FinanceModule.tsx:395-396`).
- **Reminder set from `FinanceModule` "remind me to cancel" button**. Emits `void:reminder:scheduled` (`modules/finance/FinanceModule.tsx:332`). Bridge listener was added in audit-fix #3 (`store.ts:130`) so it now lands as a real scheduled reminder. This one is fixed.
- **Notification permission**. `packages/notifications/src/backends/web.ts` requests permission lazily on first notify call; the only place that calls `notify()` in apps/web is the savings-digest loop (`apps/web/src/lib/savings-digest.ts:101`) which fires from a background scheduler — Chrome blocks permission prompts not tied to user gesture. Users will not get a prompt.

---

## 2. CODEBASE STATE

### Tests
- `pnpm -r test` from repo root → ALL GREEN.
- Total: **1091 tests passing across 16 packages** (apps/api `--passWithNoTests`). Breakdown:
  - `@ollie/events` 11 · `@ollie/store` 19 · `@ollie/crypto` 19 · `@ollie/logic` 822 (28 files) · `@ollie/api` 23 · `@ollie/router` 17 · `@ollie/orchestrator` 87 · `@ollie/backup` 11 · `@ollie/auth` 9 · `@ollie/notifications` 12 · `@ollie/research-stream` 12 · `@ollie/sync` 6 · `apps/web` 33.
- Zero skipped tests (`it.skip`, `describe.skip`, `xit`, `xdescribe` — grep returns nothing).
- Pretest hook also runs `tools/banned-phrases.test.cjs` + `tools/scan-banned-phrases.cjs` — both clean across 229 files scanned.

### Counts
- Packages: **12** in `packages/` (api, auth, backup, crypto, events, logic, notifications, orchestrator, research-stream, router, store, sync).
- Apps: **4** in `apps/` (api worker, desktop electron shell, ios capacitor shell, web).
- Total LOC: **78,808** (`find apps packages -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) -not -path "*/node_modules/*" -not -path "*/dist/*" | xargs wc -l | tail -1`).

### Build
- `pnpm -r build` → **partially red**.
  - `apps/web` builds clean (`vite build` → 22 chunks, 2.56s, all sizes documented in §3).
  - `apps/api` (Cloudflare Worker) has no `build` script.
  - `apps/desktop` has no `build` script (only `build:mac/win/linux/all`).
  - `apps/ios` fails: tries to `cap sync ios` after building web bundle. Fails at `pod install` step because Xcode is not installed on this Mac (Command Line Tools only). Error: `xcode-select: error: tool 'xcodebuild' requires Xcode, but active developer directory '/Library/Developer/CommandLineTools' is a command line tools instance`. **This is an environment issue, not a code issue** — but it does mean nobody on this machine can do an iOS build today.

### Bundle size (gzipped, from vite build output)
```
vendor-three        254 KB   ← heaviest, only loaded if Burhan3D mounts
vendor-ollie        122 KB   lazy
vendor-react         45 KB   always
index                38 KB   always
vendor-astronomy     22 KB   lazy when astrology used
AstrologyModule      16 KB
FinanceModule        10 KB
vendor-howler        10 KB   lazy on first sound
SleepModule           9 KB
AdminModule           9 KB
GoalsModule           7 KB
…rest 1-7 KB each
```
Initial download (always-loaded chunks): ~83 KB gzip. Page warns "Some chunks larger than 500 KB" — that's `vendor-three`. Acceptable for an app whose mascot is a 3D tree, but a candidate for further code-splitting (only load on `/garden` or when the user opens the dashboard).

### Typecheck
- `pnpm -r typecheck` → **all 14 workspaces green**. No errors reported.

### Lint
- No `eslint` config detected at root or in workspaces. No `lint` script. No lint output to report. **Eslint is not running anywhere — neither locally nor in CI.** This is a gap; the banned-phrase scanner partially compensates by checking string-literal content, but there is no AST-level lint.

---

## 3. WHAT'S BUILT BUT NOT WIRED

### Unwired packages
- **`@ollie/backup`** — exports encrypted `.json` export/import. Zero imports in `apps/web/src/`. `packages/backup/src/index.ts:1-30` describes the file envelope; 11 tests pass. No UI calls `exportEncrypted()` or `importEncrypted()`. The package exists in `apps/web/package.json:18` (workspace dep declared) but is never imported in source. **Dead.**
- **`@ollie/crypto`** is imported 0 times in `apps/web/src` directly (`grep -rn "@ollie/crypto"`), but used transitively by `@ollie/auth` and `@ollie/sync`. So it's reachable, just not by user-visible code paths until auth is unlocked — which requires a sign-in UI that doesn't exist.

### Wired but never reached at runtime
- **`@ollie/auth`** — imported in `lib/account-boot.ts:25, 69`, `createAuthClient` is called at boot. But no UI ever calls `auth.signIn()` or `auth.signUp()`. Verified by `grep -rn "auth.signIn\|auth.signUp\|createAuthClient" apps/web/src/` → only one hit (the boot itself).
- **`@ollie/sync`** — imported, instantiated lazily inside `attachSync()` which only runs after the `auth:signed_in` event fires. That event is never emitted because no UI calls signIn. Sync code never runs in practice.
- **`@ollie/research-stream`** — `research.start()` runs at boot (`lib/account-boot.ts:79`). `track()` is gated on consent — fine. But `flush()` would post to `VITE_RESEARCH_ENDPOINT` which has no value in any committed env file. **The opt-in plumbing exists end-to-end but never sends to a real endpoint.**

### Modules with backend logic but no UI surface
- **Cycle orchestrator outputs** unused. Writes `cycle.prediction`, `cycle.healthFlags`, `cycle.adherence`, `cycle.stats`, `cycle.insights`, `cycle.cycles` to store on every recompute. `CycleModule.tsx` re-derives all of these inline via `useMemo`. The orchestrator-written keys are read by no React component. Same pattern in Finance, Grocery, Body, Pets, Habits, Work, Admin per audit #2 finding NH5.
- **`cycle_card_visible` is a 2-of-6 chain** that renders; the rest do not. See §6 "cross-module chains".
- **`consent.cycle`** is written in onboarding (`OnboardingScreen.tsx:168`) but never read anywhere. `grep -rn "consent.cycle\b" apps/web` finds only writes. Dead consent flag.
- **`@ollie/logic/prompts`** (`packages/logic/src/prompts/index.ts`) — exists, no production import. Audit #2 NM1.
- **`@ollie/logic/journal`** — partially used. DumpModule imports `resurface*` functions (`modules/dump/DumpModule.tsx:17,26`), but the standalone "journal" module that lived in legacy void-app is folded into Dump. No standalone journal UI.

### Tests that pass but cover unreached code
- `packages/sync/tests/sync.test.ts` (6 tests) — sync client is wired but never started because no sign-in. Tests pass; code is dead at runtime.
- `packages/backup/tests/backup.test.ts` (11 tests) — backup has zero callers. Tests prove correctness of code nobody invokes.
- `packages/orchestrator/tests/*.test.ts` (87 tests) — orchestrators run at boot via `createOrchestrator(store).init()` (`apps/web/src/store.ts:111`), but the derived store keys they write are read by 0 of the modules per audit #2 NH4/NH5.

---

## 4. WHAT'S WIRED BUT INCOMPLETE

### Partial UIs
- **No global Settings screen anywhere.** Grep for "Settings" in `apps/web/src/pages/` returns nothing. Per-module settings exist (sleep, body), but there is no top-level settings page. Therefore:
  - Notification budget (`shared.settings.notification_budget`) has a data model in `packages/notifications/src/budget.ts:19` (default `daily_cap: 4`) but **no UI to change it.**
  - Per-category mute toggles: data model exists, no UI.
  - Locale / country setting: read by `useApplyBrainDump.ts:51` to pick crisis hotline, but no UI lets the user change either. They are stuck on default `en` + `TR`.
  - Sign-out: would be in settings. Doesn't exist because no Settings page and no sign-in either.
- **Onboarding leaves the user signed-out**. After 8 screens the user has local state but no account. No email/passphrase prompt anywhere in onboarding.
- **`/garden`** route: full Burhan tree with petal animations renders, but the bottom "growth/water" decay primitives were stripped per audit #2 NH7/NH8. Verified: `GardenScreen.tsx:13-17` `GardenStats = { elementCount }` only. The legacy `WaterDroplets` component is still defined in the file but never rendered (audit #2 NEW REGRESSION still unfixed).
- **HomeScreen weather**: `ISTANBUL · 14° · CLEAR` is a literal string at `pages/HomeScreen.tsx:219`. Comment at `:196` literally says `(hardcoded placeholder)`. No geolocation, no weather API.
- **HomeScreen 4-tile dashboard** (per sprint 1) — works.
- **No sign-up / sign-in screens** (repeated because it is THE biggest gap).

### TODO / FIXME / XXX in apps/web
- `apps/web/src/lib/capacitor-deeplink.ts:11` — `ollie://admin?… → navigate to admin (TODO when routing exists)`
- `apps/web/src/lib/capacitor-deeplink.ts:12` — `ollie://dashboard?… → navigate to dashboard (TODO)`
- No other TODO/FIXME/XXX in `apps/web/src` or `packages/`. Surprisingly clean.

### Mock data standing in for real
- `apps/web/src/App.tsx:36-41` builds `SAMPLE_STARTS` (6 fake cycle starts at 28-day intervals) used only by the unreachable `demo` screen. Not user-visible.
- `apps/web/src/lib/astronomy.ts:49` mentions test mocks for astronomy data — not user-facing.
- `App.tsx:159-322` is a `demo` screen branch reachable only by `setScreen('demo')` calls, which no production button performs. Dead branch but not strictly mock data.
- No `*demo*.tsx`, no `mock*.ts`, no `fixtures*.ts` in apps/web. The mock-data risk is low.

---

## 5. KNOWN REGRESSIONS

### Legacy void-app features not present in monorepo
Legacy `~/void/void-app.html` magic-* HTMLs cover: admin, astrology, body, cycle, dump, finance, garden, goals, grocery, habits, journal, medication, pets, sleep, work. New monorepo `apps/web/src/modules/` has the same list **minus journal** (folded into dump module). Astrology exists but is hidden behind `?astrology=1` query param (`pages/ModuleScreen.tsx:194-204`). Garden is gated by consent. Effectively no module deletion — journal-as-standalone is the only "missing" surface, and its logic is intact (`@ollie/logic/journal` is imported by `DumpModule.tsx:17`).

### Skipped tests
Zero. `grep -rn "it.skip\|describe.skip\|xit(\|xdescribe("` returns nothing.

### Brand-voice scanner
- Lives at `tools/scan-banned-phrases.cjs` + `tools/banned-phrases.cjs` (banlist) + `tools/banned-phrases.test.cjs` (scanner self-tests).
- Bans 24 GLOBAL patterns (`tools/banned-phrases.cjs:33-77`): great-job, awesome, woohoo, good-work, got-this, crushing-it, rockstar, killer-it, streak, streak-broken, don't-break, in-a-row, keep-streak, missed-yday, come-back, miss-you, check-in-ollie, havent-x, days-since-x, where-have-you, your-friend, burhan-sad, burhan-needs, limited-time, today-only, last-chance, you-matter, please-reach.
- Plus SCOPED bans (push/notification context only).
- Wired as `pretest` hook in root `package.json:8` AND as a GH Actions job (`.github/workflows/ci.yml:9-15`).
- **Not wired as a git hook locally** — `.husky/` directory does not exist, only `.git/hooks/*.sample`. Commits on Serra's machine do NOT run the scanner unless she explicitly invokes `pnpm test` or pushes to GH.
- Manual run: `node tools/scan-banned-phrases.cjs` → "banned-phrase scanner: clean across 229 files." No leaks today.

---

## 6. CONSTITUTIONAL INVARIANTS

### "Burhan never decays" — **PASS**
`packages/logic/src/burhan/index.ts:1-23` — file header explicitly forbids decay/remove/expire. Only `addEvent` exists, returns new state, dedupes by id. `apps/web/src/components/BurhanTree.tsx:26-29` — comment confirms `droop` and `waterLevel` props were removed (audit #2 NH9 fix landed in commit a88d411). Verified: `grep -c "droop\|waterLevel" BurhanTree.tsx` returns 1, only in the comment naming the removal. **Constitutional rule holds in code today.**

### "12 country crisis hotlines wired" — **PASS**
11 country-specific keys in `apps/web/src/i18n/strings.en.json` (`hotline_TR/US/GB/CA/AU/DE/FR/NL/IT/ES/SE`) + 1 international (`hotline_INTL`) = 12. Mapping table in `apps/web/src/hooks/useApplyBrainDump.ts:33-44`. Renders via `toast.show()` on crisis match (`hooks/useApplyBrainDump.ts:66`). ES locale strings exist (`strings.es.json`). 23 tests in `packages/logic/tests/crisis.test.ts` cover detection.

### "Notifications respect daily budget" — **PASS**
`packages/notifications/src/index.ts:279-302` — `dispatch()` reads budget from store, calls `countDeliveredToday()` against `daily_cap` (default 4, `budget.ts:19`), returns `{ delivered: false, reason: 'budget' }` if exceeded. Logged. 12 tests in `notifications.test.ts` cover the budget + mute + dedupe paths. **Caveat (PARTIAL surface):** there is no UI to view or change the budget (see §4).

### "Zero-knowledge (passphrase never sent to Supabase)" — **FAIL**
`packages/auth/src/index.ts:253` — `signIn` calls `deps.api.supabase.auth.signInWithPassword(input.email, input.passphrase)`. Plaintext passphrase IS sent to Supabase Auth as the auth password. The file header (`packages/auth/src/index.ts:14-28`) is honest about it ("Pattern B is NOT zero-knowledge"). SignUp uses a random server password but never persists it, so signIn cannot recover it — the Pattern A migration is documented at `:29-37` but not implemented. The encryption key derivation salt is separate, but capture-the-passphrase → derive-the-key is one step. **Marketing must not claim zero-knowledge until Pattern A ships.** Audit #1 C1 stands as-is.

### "Banned-phrase scanner runs on every commit" — **PARTIAL**
- Runs on every `pnpm test` invocation via `pretest` hook (root `package.json:8`).
- Runs on every push to `main` and every PR via `.github/workflows/ci.yml:9-15`.
- **Does NOT run as a git pre-commit hook locally.** No `.husky/` dir. `.git/hooks/` contains only the `.sample` defaults. A bad phrase can hit `main` only if Serra force-pushes past CI, but a bad phrase can hit her *working tree* until the next `pnpm test` or push.

### "No streaks, badges, XP anywhere in user-facing code" — **PASS** (with one false positive)
- `grep -rn "streak\|badge\|xp\|points\|level up"` in `apps/web/src/` and `packages/{logic,orchestrator}/src/` — every hit is either: (a) marketing copy explicitly saying "no streaks" (`strings.en.json:202,269`), (b) a comment forbidding streaks (`SleepModule.tsx:6`, `MedicationModule.tsx:4`, `HabitsModule.tsx:480`, `medication/index.ts:10`), or (c) `points={sparkPoints.xs}` — an SVG attribute on a sparkline (`BodyModule.tsx:738`), not gamification.
- One label: `DashboardScreen.tsx:541` `{/* Pending badge */}` — investigated, it renders a count of pending items per cluster (`pendingLabel` at `:466` is `"${n} items"` or `"—"`). Not a gamified badge despite the comment naming. **Verdict: rule holds.**

### "No engagement-bait notifications" — **PASS**
- The notification category type union (`packages/notifications/src/types.ts:13-15`) is `REMINDER | PATTERN_ALERT | CONTENT_DELIVERY`. There is no `ENGAGEMENT` arm — the dispatcher in `index.ts` explicitly drops unknown categories ("[notify] illegal category ENGAGEMENT — dropping" in tests).
- The only call site of `notify()` in apps/web is `lib/savings-digest.ts:99-105` with `category: 'PATTERN_ALERT'`. No engagement push exists anywhere in source today.
- Banned-phrase scanner forbids the verbal patterns ("come back", "miss you", "haven't logged…", etc.). Clean.

### "Astrology hidden by default" — **PASS**
`apps/web/src/pages/ModuleScreen.tsx:193-200` — astrology module silently redirects to dashboard unless `?astrology=1` is in the URL. The cluster grid in `DashboardScreen.tsx` does not link to astrology. Lazy chunk is built but unreachable in production navigation.

### "Garden gated by consent.spending_research" — **PASS**
`apps/web/src/App.tsx:108-121` — when navigating to `/garden`, reads `consent.spending_research`; if false, renders `<GardenConsentScreen/>`. Mini Burhan tile in dashboard corner stays visible to all (intentional, per Decision #15). Consent setter in `GardenConsentScreen.tsx:26` and `OnboardingScreen.tsx:167` both use the dotted key `consent.spending_research`. Aligned.

---

## 7. INFRASTRUCTURE STATE

### Supabase
- 3 migrations applied (`supabase/migrations/`):
  1. `20260512_000001_encrypted_state.sql` — `encrypted_state(user_id, module, ciphertext, iv, updated_at, device_id, blob_version)`. RLS enforced + forced + anon revoked. Unique on `(user_id, module)`.
  2. `20260512_000002_profiles.sql` — `profiles(id, salt, email, created_at, updated_at)`. RLS. Holds PBKDF2 salt for roaming.
  3. `20260513_000001_scheduled_jobs.sql` — `scheduled_jobs(user_id, fire_at, job_type, payload, status, attempts, dedupe_key)`. RLS. Partial unique index on `(user_id, dedupe_key)` while pending.
- **All three are well-shaped, RLS-correct, anon-revoked, and have rollback `.down.sql` siblings.**
- Whether they have been applied to the live `ykxzfzkfsolwgmheiwpx` project is unverifiable from the repo. Sprint 4 summary item 1 says "still needs your hands-on step: apply migration `20260513_000001_scheduled_jobs.sql`." Treat as unapplied unless Serra confirms.

### Cloudflare Workers (APNs sender + cron)
- `apps/api/wrangler.toml` defines:
  - Worker name `ollie-notifications`, cron `* * * * *`.
  - Required secrets listed: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_AUTH_KEY` (the `.p8`), `REGISTER_SHARED_SECRET`.
  - KV namespace ID is the literal string `REPLACE_AFTER_wrangler_kv_create_DEVICE_TOKENS` (`wrangler.toml:32`).
  - `SCHEDULED_JOBS_ENABLED = "0"` (`wrangler.toml:24`).
- Worker code at `apps/api/src/worker.ts` looks complete: JWT ES256 signing, retry with exponential backoff (audit #1 C4 fix), `/register-token` + `/send` + `/cron/tick` endpoints. No tests (`vitest --passWithNoTests`).
- **Status: NOT DEPLOYED.** KV not created. Secrets not set. Cron disabled.

### Apple Developer .p8 key
- No `.p8` files in repo (`find . -name "*.p8"` returns nothing).
- All references are documentation (worker source, sprint summaries, audits). **Not generated.**

### Stripe
- Zero references in `apps/web/src/` or `packages/`. The string "stripe" appears only in `apps/web/src/pages/GardenScreen.tsx:299` as a CSS `shimmer stripe` comment — false positive. **No Stripe integration. Not even a stub.** Paid tier is roadmap-only.

### iOS shell
- `apps/ios/capacitor.config.json` exists. `apps/ios/ios/` Xcode project directory does NOT exist (only `apps/ios/ios/` as a path appears in cap output, the actual project hasn't been generated). The build target fails because Xcode is not installed on this Mac.

### Desktop (Electron) shell
- `apps/desktop/main.js` registers `Cmd+Shift+Space` global shortcut (per latest commit `b545a16`). Functional on macOS. No release build configured.

---

## 8. CURRENT SPRINT WORK IN FLIGHT

### Recent commits (last 11)
```
b545a16 feat: hey ollie · ios siri intents + mac globalShortcut fixed
7aa32e1 fix: "bought tampons" restocks pantry alongside cycle productUse
127fe04 fix: voice continuous mode — don't cut off mid-sentence
1cff0e0 ux: force en-US voice recognition + cmd+shift+space web hotkey
e3425a1 ux: show "heard · {transcript}" toast on voice capture before routing
af36770 ui: replace MicButton emoji with editorial SVG glyphs
a88d411 fix: close 3 gaps from audit 3 · droop deleted, focus_log aligned, toast/reminder bridged
8403ecd fix: address credibility audits 1 + 2 · wire dead packages + emit chain sources
55ad263 feat: sprint 4 / group e · medication + voice + cron + chains + garden gate
326ede3 fix: burhan 3d · react 18 r3f · same tree everywhere
1aeb7b8 feat: sprints 2 + 2.5 + 3 · scanner port · burhan 3d
```
Theme of the last 7 commits: voice capture polish + audit-fix close-out. The work is moving from "ship new modules" to "make existing flows reliable."

### Working tree
- `git status` clean. `git diff --stat` empty. No uncommitted work in flight.

### Roadmap docs
- `SPRINT_4_SUMMARY.md` (current sprint, last touched). Closing note: "Coming next · Sprint 5 / Group F · Mobile native polish + App Store + Stripe paid tier."
- Open hand-on-steps from Sprint 4 (still pending):
  1. Apply scheduled_jobs migration to live Supabase.
  2. Set wrangler secrets + flip `SCHEDULED_JOBS_ENABLED='1'` + `wrangler deploy`.
  3. `pnpm cap add ios` to materialize Xcode project.
  4. Install `@capacitor-community/speech-recognition` plugin.
- No `SPRINT_5_*.md`, no `ROADMAP.md`.

### Next 1-week deliverable (inferred)
Per Sprint 4 summary tail + audit #3 still-hanging list, the realistic next week is:
1. Sign-in / sign-up UI (un-blocks sync + research-stream + future Stripe). Single biggest leverage point — see §10.
2. Apply scheduled_jobs migration + deploy worker.
3. Settings screen MVP (notification budget toggle, locale/country, sign-out).

These are not yet in any committed roadmap file.

---

## 9. HONEST GAPS — BE BRUTAL

### What prior audits flagged · status today
- **Audit #1 (`AUDIT_2026-05-11.md`)** identified C1–C5 + H1–H8.
  - C1 zero-knowledge auth lie — **NOT FIXED.** Doc honesty was added (`auth/src/index.ts:14-28`), code still ships Pattern B. Marketing tripwire still active.
  - C2 dead packages — **WIRED but UNUSED.** `bootAccount()` instantiates them; no sign-in UI consumes them.
  - C3 red sync tests — **FIXED.** All 6 sync tests green.
  - C4 cron retry — **FIXED.** Exponential backoff present in `worker.ts:148, 259-278`.
  - C5 migration pre-snapshot — **FIXED in mechanism, BROKEN at surface.** Backup + rollback works; `__ollie_migration_failed` flag is never read by any UI.
  - H1 web notification permission — **NOT FIXED.** Lazy permission request blocked by Chrome.
  - H2 web push — **NOT IMPLEMENTED.** PWA users get nothing.
  - H3 garden decay — **FIXED.** Hard-coded growth/water removed; bottom card shows real `elementCount`.
  - H4 dual reminder schedulers — **FIXED.** Single canonical scheduler in `store.ts:122`, imported by both writers.
  - H5 UI re-runs detectors — **NOT FIXED.** Doctrine call deferred.
  - H6 unemitted event `body:doctor_visit_completed` — **NOT VERIFIED THIS PASS.** Likely still in registry; audit #2 confirmed.
  - H7 `void:toast` unregistered — **PARTIAL.** Toast listener now exists (`App.tsx:57`), still no production reader confirmation needed for the registry side.
- **Audit #2 (`AUDIT_2026-05-11_CREDIBILITY.md`)** + **Audit #3 (`AUDIT_2026-05-11_VERIFY.md`)** continue these threads. Audit #3's "3 fixes" (commit a88d411) all landed (droop removed, focus_log aligned, toast/reminder bridged — verified).

### New gaps discovered THIS pass

1. **No sign-in / sign-up UI in apps/web at all.** This is THE single load-bearing gap. Without it, four packages (auth, sync, backup, research-stream) exist for nobody. Three audits flagged this in passing; nothing has shipped.
2. **`consent.cycle` is written, never read.** `OnboardingScreen.tsx:168` writes it; no `grep` hit in any reader. Onboarding asks a question whose answer goes nowhere.
3. **No Settings screen anywhere.** Means budget toggle, locale, country, sign-out, opt-out toggles all have no UI surface.
4. **No `eslint` configured anywhere.** No `lint` script. No style consistency enforcement. The codebase has grown to 78K LOC with no AST-level lint — only the banned-phrase scanner.
5. **Banned-phrase scanner is not a local git hook.** Only fires on `pnpm test` or push to GH. Serra can commit a banned phrase and only notice when CI fails.
6. **Hard-coded "ISTANBUL · 14° · CLEAR" still on Home.** Still there at `pages/HomeScreen.tsx:219`. Three audits flagged. Cosmetic, but it's the first text users see after onboarding.
7. **`apps/ios` is a stub.** `pnpm cap add ios` has not been run. iOS App Intents documented in markdown; no Swift code generated.
8. **APNs key + KV namespace + worker not deployed.** Push notifications cannot fire on any platform today.
9. **Locale + country are stuck at default.** `useApplyBrainDump.ts:51` reads `shared.settings.locale|country`. Onboarding does not set them. So a user in the US gets `country='TR'` default → wrong crisis hotline.
10. **Service-worker only caches static assets.** No PWA install prompt, no offline data sync, no background sync. iOS Safari PWA users get nothing (no push event handler, no manifest).
11. **No analytics, no telemetry, no D1 retention tracking.** Per Serra's memory note "D1 telemetry half-done" — confirmed: nothing in `apps/web/src/` ships telemetry events. Research-stream is the closest, but it's consent-gated and points at a missing endpoint.

### Predictable confessions a week from now
- "The sign-in screen we built last week has no password-reset flow because there isn't one by design — users will email Serra when they lose passphrases."
- "We deployed APNs but iOS Safari users still don't get push because Apple PWA push requires a separate path."
- "The Settings screen shipped without the notification budget slider because the data shape needed migration."
- "We applied scheduled_jobs migration but the worker is silently failing because `SUPABASE_SERVICE_ROLE_KEY` isn't in `wrangler secret`."

---

## 10. ALPHA-READINESS

### What 5 alpha users see today
- **Screen 1 (first launch):** OnboardingScreen — "what should we call you?" → name input. Editorial, on brand. Works.
- **Screens 2–8:** pet onboarding, pantry, subscriptions, spending-research opt-in, work-time, cycle, burhan intro. Works.
- **Screen 9 (post-onboarding):** HomeScreen with the literal text **"ISTANBUL · 14° · CLEAR"** in the top-left, regardless of where the user actually is. Brain-dump input + 3D burhan tree. Functional but cosmetically embarrassing for a US/EU user.
- **Tap to navigate:** Dashboard 4-cluster grid is on-brand and works. Tapping a cluster expands sub-modules.
- **Brain-dump test:** "buy eggs" → chip flies to grocery tile, item lands in `grocery.items`. Works.
- **Crisis test:** "i want to die" → crisis toast with hotline. Works. (Country defaults to TR — alpha users in US see "182 mental health line" instead of "988." This is a 5-character fix to onboarding.)
- **Voice test:** push-to-talk mic button on every screen. Works on Chrome/Safari. iOS Safari is iffy.
- **Garden test:** if user opted into research → garden renders. If not → consent screen → graceful.

### What WILL break / confuse
- **Lost data on browser clear / new device.** No account = no sync. User reinstalls browser → all state gone.
- **Wrong crisis hotline.** Default country = TR. Non-Turkish users get a Turkish number for the most life-or-death feature.
- **Reminders only fire while app is open.** No native push. User says "remind me to take my pill at 9am tomorrow," closes the tab, gets nothing at 9am the next day.
- **Astrology cluster missing.** Some alpha users will hear "Ollie has astrology" from Serra and not find it (it's `?astrology=1`-gated).
- **No way to change anything.** No settings → no way to change name, locale, country, notification cadence, theme, anything.
- **Sign-in flow is missing.** User who tries to "make an account" finds no entry point.
- **Onboarding cannot be re-run.** Once `shared.onboarded=true`, no UI to redo the 8 screens or change earlier answers.

### Single biggest pre-alpha blocker
**No sign-in / sign-up UI.** File: would live at `apps/web/src/pages/SignInScreen.tsx` and `SignUpScreen.tsx` — neither exists. Plumbing for it is ready in `apps/web/src/lib/account-boot.ts:25,69` — just needs a screen with two inputs + the unrecoverable-passphrase warning, calling `auth.signUp()` / `auth.signIn()`.

Until this lands:
- Sync is dead (5 users on 5 devices have 5 separate datasets).
- Research-stream is dead (no auth header).
- Stripe paid tier is unimplementable.
- The "12 packages exist" claim and the "multi-device" promise are both unfulfilled.

Second-biggest blocker: **fix default country in onboarding** (or detect by browser locale). 30-line patch in `OnboardingScreen.tsx:155-201`. Without it, the crisis path — the most constitutionally-loaded feature in the app — is wrong for everyone outside Turkey.

Third: **a Settings page MVP** with locale, country, notification budget, sign-out, and onboarding reset. ~1 day.

If those three ship in the next week, the app is alpha-honest. Until then, the alpha is essentially "a beautifully-built single-device local-only journal with a 3D olive tree and a Turkish crisis number."
