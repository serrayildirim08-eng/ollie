# ollie · post-Sprint 5 audit · 2026-05-12

Scope: branch `retention-telemetry` at HEAD `1ba8198` (5 commits ahead of `origin/retention-telemetry`, 7 ahead of `origin/main`). Working tree NOT clean — 2 modified files (`apps/ios/www/index.html`, `apps/web/src/pages/GardenScreen.tsx`) + untracked dirs (`apps/web/src/garden/`, `apps/web/public/models/garden/`, `apps/web/src/hooks/useReducedMotion.ts`, `assets/`). The Sprint 5 commits themselves (82a364c→13f2c68 + 1ba8198 docs) are clean; the dirty tree is unrelated 3D-garden + asset work in flight.

Sprint 5 claimed 6 fixes done. Each verified by reading committed source, running tests, and tracing data flow. Verdicts are PASS / PARTIAL / FAIL with file:line evidence.

---

## 1. SPRINT 5 VERIFICATION

### F1 · Zero-knowledge (Pattern A) — **PASS**

Read `packages/auth/src/index.ts` end-to-end (432 lines).

- `signUp` (lines 219-291): derives key locally with `deriveKey(input.passphrase, salt)` at `:244`. Generates random 32-byte hex `serverPassword` at `:245`. **Only that random hex is passed** to `supabase.auth.signUp(input.email, serverPassword)` at `:251`. The encrypted serverPassword + salt are uploaded to the `profiles` row at `:283` after auth — passphrase is NOT included.
- `signIn` (lines 293-387): looks up local salt + encrypted_server_pw at `:307-316`. Derives key locally `:337`. Tries to decrypt at `:341` — on failure short-circuits to `wrong-passphrase` at `:344` WITHOUT calling Supabase. On success calls `signInWithPassword(email, serverPassword)` at `:349` — again, decrypted random hex, not the passphrase.
- `packages/auth/tests/zero-knowledge.test.ts:1-172` — 3 tests. Test 3 (`:149-170`) specifically asserts that wrong passphrase produces ZERO `auth.*` supabase calls. Tests 1 + 2 deep-scan every captured supabase call argument tree and fail if the passphrase string appears. Ran: **all 3 pass** (`packages/auth tests/zero-knowledge.test.ts (3 tests) 95ms`).

The passphrase string `serra-loves-burhan-and-eggs-2026` literally cannot reach Supabase under any code path tested. The constitutional invariant is enforced at the test level, not just by comment.

Caveats — these are real but documented:
- New-device bootstrap requires importing a backup (no roaming via supabase alone). Documented at `packages/auth/src/index.ts:28-37` + at the Forgot screen UI.
- The profile upload at `:283`/`:381` is wrapped in `try/catch` → swallows errors silently. If supabase returns 5xx the user gets a successful local-auth state with NO server salt mirror. Next-device login WILL fail with `missing-salt` — UX paper-cut, not a security regression.

### F2 · AuthFlow / sign-up + sign-in UI — **PARTIAL (gated off in dogfood + has 1 bug)**

- File exists: `apps/web/src/components/AuthFlow.tsx:1-626`. Component renders 4 sub-screens (fork / signup / signin / forgot). Hooked at app root in `App.tsx:141-152`.
- Strength meter: `apps/web/src/components/AuthFlow.tsx:255-313` uses `passphraseStrength()` from `@ollie/crypto`. The submit gate at `:360-362` requires `pass.length >= 16` AND `passMatches` AND `ack` checkbox. Cannot bypass — the button is disabled until all three are true.
- Unrecoverable-ack checkbox at `:454-464` — `ack` must be `true` to enable submit. Aligned with `signUp` which itself enforces `acknowledged_unrecoverable` at `auth/src/index.ts:220-222`.

**FAILURE #1 — the auth gate is SKIPPED entirely in dev/dogfood**:
- `App.tsx:50-54` reads `VITE_SUPABASE_URL` from `import.meta.env`. If unset, `SUPABASE_CONFIGURED = false`.
- `App.tsx:60-62` initializes `authed` to `true` whenever Supabase isn't configured.
- There is no `.env*` file committed anywhere in the repo. Running `pnpm dev` locally → `VITE_SUPABASE_URL` is undefined → **AuthFlow never renders** for any user not exporting that env var. This is by design (per the F2 commit message — "skips the gate when VITE_SUPABASE_URL is missing") but it means the alpha-readiness claim "Sign-in / sign-up UI exists at AuthFlow.tsx, wired at root" is true only for production builds against a real Supabase. A Serra-handed-out PWA build pointed at her dev server will never see AuthFlow.

**FAILURE #2 — email pre-fill localStorage key is WRONG**:
- `AuthFlow.tsx:33` reads `localStorage.getItem('ollie:shared:' + EMAIL_LS_KEY)` → `ollie:shared:shared.auth.email_for_login`.
- The store does NOT use that key shape. `packages/store/src/store.ts:21-22` → `void.state.shared.v5` is the actual localStorage key, holding a JSON-stringified object whose `auth.email_for_login` field contains the email.
- Consequence: `readPrefilledEmail()` at `AuthFlow.tsx:30-37` ALWAYS returns `''`. The mode-defaulting logic at `:601-604` (returning users default to `signin`, fresh installs see `fork`) is therefore broken — every visit shows fork. Returning users have to click "log in" every time, and the email field is never pre-filled.
- Not a security issue, but it breaks the "welcome back" UX and contradicts both AuthFlow comment at `:8` ("pre-filled from localStorage") and Sprint 5 commit msg.

### F3 · Country default → US gets 988 — **PASS** (with one rough edge)

- `apps/web/src/lib/country.ts:1-46`. `detectCountryFromLocale()` parses `navigator.languages[]` and `navigator.language`, splits on `-/_`, takes region. Falls through to `'INTL'` if nothing matches. Walked `country.test.ts:1-65` — 7 tests, `en-US → US`, `tr-TR → TR`, `fr-CA → CA`, `zh-CN → INTL`, `en (no region) → INTL`, fallback through `languages` list. All 7 pass.
- `apps/web/src/hooks/useApplyBrainDump.ts:51-56` no longer hardcodes `'TR'`. `country` is `null` if `shared.settings.country` is unset. `:64-67` resolves to `crisis.hotline_INTL` if null/unknown.
- `OnboardingScreen.tsx:21` imports the helpers. `:150` seeds INITIAL state with `detectCountryFromLocale()`. `:175` writes `shared.settings.country` in `commitAll`. Welcome screen at `:439-480` renders a country `<select>` so the user can override the auto-detect.
- `useApplyBrainDump.country.test.ts:1-68` — 6 tests verify the resolution table directly. All green. Note: the test reproduces the table in a local function rather than calling the actual hook, so it tests the logic, not the wiring. Wiring is verifiable by inspection of `useApplyBrainDump.ts:33-71`.

Rough edge: **`OnboardingScreen.test.ts` is stale** (`apps/web/src/pages/OnboardingScreen.test.ts:36-42`). The test re-implements `commitAll()` with the OLD flat-key paths (`has_pets`, `consent_spending_research`, `consent_cycle`) — NOT the current dotted-namespace paths (`settings.has_pets`, `consent.spending_research`, `consent.cycle`). It also doesn't write `settings.country`. Tests pass against the duplicated stale logic; they do NOT validate the real `OnboardingScreen.tsx:163-211` code path. The previous audit (§9 NC4) flagged this and it was supposedly addressed in commit 8403ecd, but the test was never updated — only the production code. Real assertion of F3's commitAll behaviour does not exist in any test today.

### F4 · Settings screen — **PARTIAL (consent toggles are stubs at the runtime level)**

`apps/web/src/pages/SettingsScreen.tsx:1-672` — 4 sections present, reachable via the kicker pill at `HomeScreen.tsx:248-273`.

- **Account** (`:308-388`): sign-out at `:320-324` calls `auth.signOut()` then `onSignedOut()` → flips authed back to false. Delete-account at `:326-345` wipes every `ollie:*` and `void.state.*` localStorage key prefix (note: the actual data is at `void.state.*` per store.ts:21, so the `startsWith('ollie:')` check at `:336` WILL MISS THE REAL DATA. `void.state.shared.v5` does not start with `ollie:`. Delete-account is effectively a no-op against the real store keys.)

  **NEW BUG**: this is a regression introduced by Sprint 5. SettingsScreen.tsx:336 `if (k && k.startsWith('ollie:'))` should be `if (k && k.startsWith('void.state.'))`. The window.reload() at `:344` runs, the user thinks data is gone, but on next load every module is intact.

- **Notifications** (`:392-449`): budget slider (1-10) writes to `shared.settings.notification_budget`. Per-category mute toggles update `muted_categories` array. Verified that `packages/notifications/src/budget.ts:26-40` (`readBudget()`) reads from the same key, and `index.ts:295` (`countDeliveredToday(state.store, now)`) is called from `dispatch()` to enforce the cap. **The slider value is genuinely consumed by the dispatch path.**

- **Privacy** (`:453-610`):
  - `consent.spending_research` toggle at `:524` IS read by Garden gate (`App.tsx:71` + `App.tsx:200`). **Wired.**
  - `consent.cycle` toggle at `:532` writes `shared.consent.cycle`. `grep` for readers across `apps/web/src/` and `packages/`: **ZERO non-writer hits**. Audit 2026-05-12 §9 NEW #2 flagged this; Sprint 5 added a writer in Settings but no reader. **Still dead.**
  - `consent.astrology` toggle at `:540` writes `shared.consent.astrology`. **Zero readers anywhere**. The Sprint 5 doc concedes: "no consumer reads it yet". Wired UI to writeable state, but with no effect on anything in the app today.
  - Country picker at `:548-565` writes `shared.settings.country` — IS read by `useApplyBrainDump.ts:51-56`. **Wired.**
  - Export/import (`:462-513`): calls `@ollie/backup` `exportBackup()` + `importBackup()`. Backup package previously had ZERO callers (§3 prior audit). Sprint 5 makes it the first reader. Both code paths look correct. Not tested with a real Blob roundtrip but the underlying package has 11 green unit tests.

- **About** (`:614-649`): version `0.0.1`, links to `https://ollie.computer/privacy` and `/terms`. Neither URL is verified to exist — likely doesn't yet.

### F5 · 4 dangling cross-module chain surfaces — **PARTIAL**

- **BodyProtectiveCards** (`apps/web/src/modules/body/BodyModule.tsx:43-113`) — reads `body.protective_cards`. Router writes this key from `sleep:short_sleep_run_detected` rule at `packages/router/src/cross-module.ts:157-174` AND from `work:hyperfocus_detected` at `:196-209`. Rendering at `BodyModule.tsx:1653`. Dismissable. **WIRED.** PASS.

- **reduce_motion_today global CSS var** (`App.tsx:99-124`) — reads `shared.reduce_motion_today`. Router writes it from `sleep:pacing_breach_detected` rule at `cross-module.ts:179-193`. App.tsx applies `data-reduce-motion="today"` + zeros 4 CSS duration vars. Subscribes to changes via `store.subscribeKey`. **WIRED.** PASS.

- **AdminReflected** (`AdminModule.tsx:215-298`) — reads `admin.reflected`. Router writes it from `finance:reminder_set` rule at `cross-module.ts:64-91`. Sort by `due_at`, dismissable, source-module chip rendered. **WIRED.** PASS.

- **HabitsWaterPrompt** (`HabitsModule.tsx:62-138`) — reads `habits.surface_water_habit`. **NO ROUTER RULE WRITES THIS STORE KEY.** The cross-module rule at `cross-module.ts:136-145` (`body:hydration_drop_detected → habits:surface_water_habit`) emits the target event but has NO `reflect` block. Compare against the other 3 chains, which all have `reflect: (p) => ({ module, key, entry })`. No orchestrator subscribes to `habits:surface_water_habit` to perform the write either (`grep` returns zero hits outside the router rule + the consumer).

  **The HabitsWaterPrompt UI will never render in production.** It reads a key nobody writes. Sprint 5 F5 ships 3-of-4 surfaces wired end-to-end. Test at `packages/router/tests/cross-module.test.ts:78-84` asserts the EVENT fires (passes), not that the store key gets written.

  This is the most material Sprint-5-introduced gap: a new "looks done but isn't" surface that the F5 summary marks DONE. **FAIL on this chain.** Sprint summary says 4-of-4; reality is 3-of-4.

### F6 · Live weather pill — **PASS**

- `apps/web/src/lib/weather.ts:1-207`. Free APIs (BigDataCloud reverse-geocode + Open-Meteo current), no keys. `getLocalWeather()` returns `null` on any failure — geolocation denied, fetch error, malformed response. Cache key `ollie:weather:current`, TTL 1h.
- `HomeScreen.tsx:143-154` calls it once on mount. `:216-243` renders the pill ONLY if `weatherFetched && weather` — null hides the row entirely. The legacy "ISTANBUL · 14° · CLEAR" hardcode is gone. Comment at `:139-142` documents the change.
- `weather.test.ts:1-167` — 7 tests: Brooklyn coords → `BROOKLYN · 60° · CLOUDY`, permission-denied returns null, weather-API-500 returns null, cache hit within TTL, cache expiry past TTL, `formatWeatherPill('en-US')` is imperial, `formatWeatherPill('fr-FR')` is metric. All green.
- Geolocation permission: `weather.ts:77-89`. Permission is requested lazily via `navigator.geolocation.getCurrentPosition` inside the mount-time `getLocalWeather()` call. Chrome treats Geolocation as a user-gesture-OPTIONAL permission (unlike Notifications), so the prompt CAN appear from useEffect. But on iOS Safari PWA the prompt is gated on a user gesture — first load will likely just return null on iOS. Acceptable failure mode (row hides).

---

## 2. TESTS + BUILD

### Tests — all green
- `pnpm -r test` → 1142 tests pass across 14 workspaces (apps/api has no tests, `--passWithNoTests`). Baseline was 1091; Sprint 5 added 51 (66 apps/web - 46 was apps/web; +13 country/weather, +1 auth, +3 zero-knowledge, +7 country, +7 weather).
- New file counts verified:
  - `packages/auth/tests/zero-knowledge.test.ts` — 3 tests
  - `packages/auth/tests/auth.test.ts` — 10 tests (was 9; +1)
  - `apps/web/src/lib/country.test.ts` — 7 tests
  - `apps/web/src/hooks/useApplyBrainDump.country.test.ts` — 6 tests
  - `apps/web/src/lib/weather.test.ts` — 7 tests
- Pretest banned-phrase scanner: clean across 252 files (was 229).
- Zero skipped tests (verified by grep for `it.skip|describe.skip|xit|xdescribe` — none).

### Typecheck — all green
- `pnpm -r typecheck` → all 14 workspaces green. No errors.

### Build — apps/web clean, iOS still red (env-only)
- `pnpm -r build` → apps/web builds (vite, 2.40s). Bundle sizes (gzipped):
  - vendor-three 264 KB · vendor-ollie 122 KB · vendor-react 45 KB · index 41 KB · vendor-astronomy 22 KB · AstrologyModule 16 KB · FinanceModule 10 KB · vendor-howler 10 KB · **SettingsScreen 4.5 KB** (new) · HomeScreen 3.6 KB · DashboardScreen 3.2 KB · others 1-9 KB.
  - Index is 41 KB gzip vs 38 KB pre-sprint — +3 KB for AuthFlow + reduce-motion effect + retention markers.
- apps/ios still fails on `pod install` because Xcode not installed. Environment issue, not a code issue. Same as prior audit.
- apps/api has no `build` script.

### Bundle size note
`vendor-three` is now 974 KB raw / 264 KB gzipped, up materially. The garden 3D work staged in the dirty tree (`apps/web/src/garden/`, model files) is pre-loading this chunk. Once committed, the always-loaded payload risks growing. Not Sprint 5's doing — flagging for the next sprint.

---

## 3. CONSTITUTIONAL INVARIANTS — re-verified

- **Burhan never decays** — **PASS**. `packages/logic/src/burhan/index.ts:1-23` still forbids decay. `BurhanTree.tsx` confirms no `droop` / `waterLevel`. No regression in Sprint 5.

- **12 country crisis hotlines wired** — **PASS, materially improved**. 11 country keys + 1 INTL in `i18n/strings.en.json`. Sprint 5 F3 fixed the long-standing default-TR bug. US user → 988. Tests assert this. The previous audit's "fix default country" blocker is closed.

- **Notifications respect daily budget** — **PASS, now with UI**. Slider at `SettingsScreen.tsx:419-427` writes `shared.settings.notification_budget`. Dispatch reads via `budget.ts:26-40`. Verified end-to-end. Per-category mute also wired (`SettingsScreen.tsx:431-446` → `budget.ts:42-44` `isMuted()` → `index.ts` enforcement).

- **Zero-knowledge (passphrase never sent to Supabase)** — **PASS (Sprint 5 F1)**. Pattern A implemented. Test asserts no leak. The biggest material constitutional improvement in this sprint.

- **Banned-phrase scanner on every commit** — **PARTIAL (unchanged from prior audit)**. Runs on `pnpm test` + GH Actions. Still no `.husky/` directory. Sprint 5 didn't touch this. Local commits still bypass.

- **No streaks/badges/XP in user code** — **PASS**. Banned-phrase scanner clean across 252 files. Spot-checked AuthFlow + SettingsScreen copy. No streak / badge / XP language anywhere.

- **No engagement-bait notifications** — **PASS**. Only `notify()` call site still `lib/savings-digest.ts:99` with `PATTERN_ALERT` category. No regressions.

- **Astrology hidden by default** — **PASS**. Dashboard cluster grid does not link to astrology. `?astrology=1` URL gate still in place. Note: `consent.astrology` toggle now exists in Settings but it doesn't gate the cluster — astrology is still URL-gated, not consent-gated. Not a regression; the toggle is wishful (no readers).

- **Garden gated by consent.spending_research** — **PASS**. `App.tsx:71,200` still reads `consent.spending_research`. Settings toggle at `SettingsScreen.tsx:524` writes the same key. **NEW WIN**: the user can now revoke garden consent post-onboarding via Settings, where before it was a one-shot from `GardenConsentScreen.tsx`.

---

## 4. STILL BROKEN / STILL UNWIRED

### Sprint 5 claims that are actually partial
- **F2 AuthFlow** — skipped entirely when `VITE_SUPABASE_URL` is missing. The dogfood path (which is what Serra runs locally and likely what beta users get via Electron / PWA without prod env) never sees the screen. Sprint 5 doc says "Yes, all three pre-alpha blockers closed." Reality: blocker is closed in PROD-configured builds only.
- **F2 AuthFlow** — `readPrefilledEmail()` localStorage key shape is wrong. Returning users always see fork screen, never auto-routed to login.
- **F4 Settings** — `handleDeleteAccount()` checks `k.startsWith('ollie:')` but real store keys are `void.state.*`. **Delete account doesn't actually delete anything.** Reload happens, user thinks data is gone, on next mount all data is intact.
- **F4 Settings** — `consent.cycle` toggle is a stub: no reader. Same for `consent.astrology`.
- **F5 HabitsWaterPrompt** — never renders because the router rule has no `reflect`. UI is dead code until that's added.

### Pre-Sprint-5 gaps untouched
- iOS Capacitor shell — `pnpm cap add ios` still not run. Build fails on `pod install`. Environmental.
- APNs worker not deployed. `wrangler.toml:32` still has `REPLACE_AFTER_wrangler_kv_create_DEVICE_TOKENS`. `SCHEDULED_JOBS_ENABLED="0"`. Push doesn't work.
- `20260513_000001_scheduled_jobs.sql` migration not confirmed-applied to live Supabase.
- No Stripe.
- No web-push handler in service worker.
- D1 telemetry endpoint missing — `lib/retention.ts` writes locally only.
- No eslint anywhere.
- Notification permission still requested lazily from `savings-digest.ts` (no user-gesture path).
- Backup wired into Settings export/import (new in F4!) but rest of `@ollie/backup` consumers still zero (no auto-backup, no scheduled remote backup).

### Mock data
- `SAMPLE_STARTS` in `App.tsx:41-44` still standing, only used by unreachable demo screen.

---

## 5. NEW GAPS DISCOVERED THIS PASS

1. **Delete-account is silently a no-op** (`SettingsScreen.tsx:336`). Worst-case Sprint-5-introduced bug — gives user the visual feedback of "data deleted" without deleting anything. Trust-breaking if discovered.

2. **AuthFlow email pre-fill regression** (`AuthFlow.tsx:33`). Wrong localStorage key shape. Reduces sign-in UX quality but is fixable in 2 lines (call `store.get('shared', 'auth.email_for_login', '')` instead of poking localStorage).

3. **Auth gate skip path is silent** (`App.tsx:50-62`). If a dev forgets to set `VITE_SUPABASE_URL`, the entire auth flow silently disappears. No console warning, no banner. Per Sprint 5's design comment this is intentional for dogfood, but should be loud — `console.warn('[ollie] VITE_SUPABASE_URL missing — auth disabled, sync inactive')` or similar.

4. **F5 HabitsWaterPrompt chain incomplete** (router missing `reflect` rule for `body:hydration_drop_detected → habits.surface_water_habit`). Real fix is ~6 lines in `packages/router/src/cross-module.ts:136-145`.

5. **OnboardingScreen.test.ts is stale** (`OnboardingScreen.test.ts:36-42`). Tests duplicate-implements `commitAll` with old flat keys. Test passes against a fiction. The actual `commitAll` in `OnboardingScreen.tsx:163-211` writes dotted keys including the new F3 `settings.country` write — none of which is asserted. Sprint 5's F3 commit didn't update the test.

6. **AuthFlow + Settings copy** — quick brand-voice spot check: clean. lowercase labels, sage active, DM Mono caps headers. No corporate / SaaS drift. Settings ConfirmModal copy ("there is no undo") is on-brand. Forgot screen copy ("there isn't one. your passphrase is unrecoverable by design") is unusually good — direct, no euphemism, on-voice. **Brand voice PASS.**

7. **`Daily notification budget` consumed correctly** but no UX hint about what category counts toward the budget. Slider says "cap on push + in-app pings per day" — accurate per the dispatch code reading `_notification_log`.

8. **Settings privacy URLs are unverified** (`SettingsScreen.tsx:22-23`). `https://ollie.computer/privacy` and `/terms` are referenced; the domain itself is plausibly registered but the pages likely don't exist. Alpha users clicking either link see 404. Low-stakes, fixable in 5 minutes once the docs are written.

9. **Untracked 3D garden work in working tree** (`apps/web/src/garden/`, `apps/web/public/models/garden/`, `apps/web/src/hooks/useReducedMotion.ts`). Substantial new code (gardens, models) sitting un-committed alongside Sprint 5. Out of scope for this audit but a reminder: the next commit will land a sizeable new code surface alongside the unfinished F5 chain.

---

## 6. ALPHA-READINESS NOW

### Walk-through for 5 alpha users TODAY

Assuming Serra hands out a PWA pointed at a properly-configured Supabase (`VITE_SUPABASE_URL` set):

- **Screen 1 (cold launch)**: AuthFlow fork screen — "create account / log in". On brand, two buttons, single sub-line about encryption. **Works.**
- **Screen 2 (sign-up)**: passphrase entry, strength meter, ack checkbox. 16-char gate, mismatch warning. **Works** end-to-end (Pattern A makes this real, not theater). Note: returning users always land on fork because of the email pre-fill bug — they have to click "log in" each time.
- **Screen 3 (onboarding)**: 8 screens. Country picker on screen 0 is new + works. Pet, pantry, subs, spending research, work time, cycle, burhan intro — unchanged from prior audit, works.
- **Screen 4 (home)**: weather pill (live, or hidden), sky orb, settings kicker top-right, burhan, brain-dump input, dashboard ⊞. Cosmetic embarrassment of static ISTANBUL pill is GONE. **Works.**
- **Screen 5 (settings — new)**: account / notifications / privacy / about sections. Sign-out works. Slider works. Toggles flip state. **Delete account silently fails to delete** — first material UX trap.

### What WILL break end-to-end
- **Delete account is a lie** (see §5#1). High-trust feature, broken in trust-shape.
- **Returning sign-in flow is uglier** (see §5#2). Annoying not fatal.
- **Cross-device sign-in** still requires backup import (Pattern A tradeoff, documented).
- **Reminders still don't fire when the tab is closed** (APNs worker undeployed).
- **HabitsWaterPrompt** never appears. User who hears about it gets a no-show.
- **`consent.cycle` + `consent.astrology` toggles do nothing visible** (no readers wired). Toggling them changes state but no UI changes anywhere.
- **Notification permission** still not prompted via user gesture — Chrome / Safari likely block the savings-digest scheduler's lazy request.

### Did Sprint 5 move the needle?
**Yes, substantially.** Three structural wins:
1. **Zero-knowledge is real** for the first time (F1). The marketing language is now defensible. The test enforces it. This is a constitutional upgrade.
2. **Crisis hotline finally country-correct** (F3). The most life-or-death feature works for non-Turkish users. This was the highest-stakes per-user bug pre-sprint.
3. **Settings exists** (F4). Users have somewhere to change locale, sign out, toggle consent, export data. The previous audit's "no way to change anything" gap is closed.

The needle moved meaningfully. But Sprint 5's own scope did not deliver perfectly:
- F5 ships 3-of-4 chains (one read-only-dead).
- F2 ships AuthFlow but is silently disabled in dogfood + has a stale-key pre-fill bug.
- F4 ships Settings but delete-account is broken AND two toggles are visible-but-dead.

### Single biggest remaining blocker
**APNs worker deployment + push notifications.** Reminders set during a session don't fire after the tab closes. For an ADHD app whose core promise is "i'll remember for you" this is the load-bearing capability. iOS shell is also unbuilt, blocking the native path entirely.

Pre-alpha workaround: ship as a web-only "keep this tab open" experience, document explicitly that reminders fire only in-session. Alpha users will likely accept this; it's not honest to call it production.

### Second-biggest
**Delete-account bug** (`SettingsScreen.tsx:336`). It's a 1-line fix but it's currently lying to users. Fix before invites go out.

### Third
**F5 HabitsWaterPrompt** — add the missing `reflect` rule in `cross-module.ts`. ~6 lines. Surface goes from never-renders to actually-renders.

---

## 7. HONEST CONFESSIONS

Five things I'd confess to Serra right now:

1. **Sprint 5 says "alpha-onboarding-ready: Yes" but it's only-yes-in-production-builds.** The dogfood Electron / dev server path silently disables AuthFlow because `VITE_SUPABASE_URL` is missing. Anyone running ollie locally (Serra included, on her own machine, today) does not see AuthFlow at all. The encrypted-by-default story is true on paper, off in practice for any non-prod build.

2. **Delete-account doesn't delete anything** (`SettingsScreen.tsx:336`). The localStorage key prefix is wrong. This is the highest-stakes Sprint-5-introduced bug because it pretends to succeed. If an alpha user uses it, their data persists invisibly. This is also a privacy regression: "delete my data" produces a false-success — bad for any future legal claim of "user-controlled deletion."

3. **F5 4-of-4 is really 3-of-4.** The HabitsWaterPrompt UI was shipped with no router rule to write the key it reads. The test asserts the event fires, not that the store is updated. Anyone reading the F5 summary would assume all four chains terminate in UI.

4. **The OnboardingScreen test is fiction**: it duplicates `commitAll` using OLD flat keys and validates that fiction. The real `commitAll` writes dotted keys plus the new F3 `settings.country` and none of it is asserted. The Sprint 5 doc says tests are at 1118 (real count is 1142); the count is fine, but the OnboardingScreen one is rotting in place.

5. **AuthFlow's "returning users default to log-in" is broken** (`AuthFlow.tsx:33`). Reads localStorage with a key shape that doesn't exist in this store. Returning users land on fork every time. Small but visible and easy to confuse with a "did my account get lost?" panic.

### Did Sprint 5 introduce any new "looks done but isn't" code?
**Yes, three:** (a) delete-account no-op, (b) HabitsWaterPrompt never-renders, (c) consent.cycle + consent.astrology toggles with no readers (the latter Sprint 5 doc acknowledges; the former it does not). The trifecta of partials sits behind the Sprint 5 "DONE" label.

The underlying work is good. F1 is excellent. F3 is exact. F6 is correctly defensive. F4 + F5 ship visible surfaces but with bugs that would have caught in QA if there were any. **Sprint 5's biggest weakness is that nothing was clicked through manually end-to-end on a real device after the code was written.**
