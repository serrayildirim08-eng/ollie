# Sprint 5 · Alpha readiness report · 2026-05-12

Audit reference: `AUDIT_REPORT_2026-05-12.md` (commit `b545a16`).
Branch worked on: `retention-telemetry` (already ahead of `main` by 1
commit at sprint start — `163e22e feat: local D1/D7 retention telemetry
markers`).

## Per-task status

### F1. Zero-knowledge fix (Pattern A) — **DONE**

- Commit: `82a364c feat(auth): pattern A zero-knowledge`
- Files:
  - `packages/auth/src/index.ts:1-75` — Pattern A header rewrite, threat
    model documented.
  - `packages/auth/src/index.ts:200-279` — `signUp` derives key locally,
    encrypts a 32-byte hex `serverPassword`, persists locally + on
    profiles.
  - `packages/auth/src/index.ts:281-364` — `signIn` decrypts locally;
    wrong passphrase → AES-GCM failure → no Supabase call.
  - `packages/auth/src/index.ts:418-430` — `generateRandomServerPassword`
    now returns 64-char hex (was base64).
  - `packages/auth/tests/zero-knowledge.test.ts:1-150` — new assertion
    test: deep-spy on every supabase call argument, fails if the raw
    passphrase appears anywhere. 3 tests.
- The architecture-rule line "raw passphrase never passed to any
  supabase-js method" is now enforced in tests, not just comments.

### F2. Sign-up / sign-in UI — **DONE**

- Commit: `fe55f8c feat(auth-ui): sign-up / sign-in flow at app root`
- Files:
  - `apps/web/src/components/AuthFlow.tsx:1-540` — new component. Fork →
    signup | signin | forgot screens. 16+ char strength meter,
    unrecoverable-acknowledge checkbox, single-screen "forgot"
    explainer.
  - `apps/web/src/App.tsx:108-119` — auth gate at root, runs before
    Onboarding.
  - User-applied refinement: `apps/web/src/App.tsx:52-62` skips the gate
    when `VITE_SUPABASE_URL` is missing (dogfood/local dev fallback).
    Sync + research stay no-ops in that mode.
- Design: cream bg, sage active, DM Mono caps headers, DM Sans body.
  Per repo design spec.

### F3. Country default fix — **DONE**

- Commit: `6a85a1a fix(crisis): country drives hotline · US → 988 not 182`
- Files:
  - `apps/web/src/lib/country.ts:1-44` — `SUPPORTED_COUNTRIES` +
    `detectCountryFromLocale()` extracted so tests don't pull in
    Burhan3D.
  - `apps/web/src/pages/OnboardingScreen.tsx:18-21` — imports country
    helper. Welcome screen now contains a country picker auto-seeded
    from `navigator.language`.
  - `apps/web/src/pages/OnboardingScreen.tsx:172-175` — writes
    `shared.settings.country`.
  - `apps/web/src/hooks/useApplyBrainDump.ts:46-71` — removes hardcoded
    `TR` default; null country → `crisis.hotline_INTL`
    (findahelpline.com).
  - `apps/web/src/lib/country.test.ts` (7 tests) +
    `apps/web/src/hooks/useApplyBrainDump.country.test.ts` (6 tests) —
    asserts `country='US' → 988`, `null → INTL`.

### F4. Settings screen — **DONE**

- Commit: `5af9239 feat(settings): single-page settings screen reachable from home`
- Files:
  - `apps/web/src/pages/SettingsScreen.tsx:1-585` — four sections:
    Account (email · sign out · delete account confirm modal),
    Notifications (1-10 budget slider · per-category mute toggles),
    Privacy (spending-research / cycle / astrology toggles · country
    picker · encrypted export+import), About (version · privacy ·
    terms).
  - `apps/web/src/pages/HomeScreen.tsx:226-249` — settings kicker pill
    top-right of home.
  - `apps/web/src/App.tsx:29,153-162` — `settings` screen routed.
- Astrology gate now writable: `consent.astrology` is a new store
  key, set here for the first time. Daily-reading notifs can gate on
  this in a future sprint.

### F5. Cross-module UI surfaces (4 missing chains) — **DONE**

- Commit: `7add0df feat(chains): render 4 dangling cross-module surfaces`
- Files:
  - `apps/web/src/modules/body/BodyModule.tsx:43-119, 1659-1665` —
    `BodyProtectiveCards`. Reads `body.protective_cards`.
  - `apps/web/src/App.tsx:95-129` — global `useEffect` watches
    `shared.reduce_motion_today`. Sets `data-reduce-motion="today"` on
    `<html>` + zeros out `--d-flight/--d-slide/--d-flick/--d-settle`
    CSS variables for the day.
  - `apps/web/src/modules/admin/AdminModule.tsx:215-302, 1453-1456` —
    `AdminReflected`. Reads `admin.reflected` with source-module + due
    chip + dismiss.
  - `apps/web/src/modules/habits/HabitsModule.tsx:62-140, 920-922` —
    `HabitsWaterPrompt`. Reads `habits.surface_water_habit`.
- Each card is factual, dismissable, ollie voice. No streaks, no
  shame, no urgency.

### F6. HomeScreen location hardcode — **DONE**

- Commit: `13f2c68 feat(home): live weather pill · bigdatacloud + open-meteo`
- Files:
  - `apps/web/src/lib/weather.ts:1-180` — `getLocalWeather()` calls
    BigDataCloud reverse-geocode + Open-Meteo (both free, no key).
    1h localStorage cache. Returns null on any failure.
    `formatWeatherPill()` uses imperial for `en-US`, metric otherwise.
  - `apps/web/src/pages/HomeScreen.tsx:147-156, 213-241` — replaces
    static "ISTANBUL · 14° · CLEAR" with live pill. Row hidden
    entirely if `getLocalWeather()` returns null.
  - `apps/web/src/lib/weather.test.ts:1-160` — 7 tests including:
    mocked Brooklyn coords + cloudy code 3 → `BROOKLYN · 60° · CLOUDY`.

## Tests

| Surface | Before | After |
|---|---|---|
| Total tests (audit baseline) | 1091 | 1118 |
| Apps/web | 46 | 66 |
| `@ollie/auth` | 9 | 13 |
| Other packages | unchanged | unchanged |

New test files:

- `packages/auth/tests/zero-knowledge.test.ts` — 3 tests
- `packages/auth/tests/auth.test.ts` — +1 (passphrase-not-in-signup)
- `apps/web/src/lib/country.test.ts` — 7 tests
- `apps/web/src/hooks/useApplyBrainDump.country.test.ts` — 6 tests
- `apps/web/src/lib/weather.test.ts` — 7 tests

`pnpm -r test` and `pnpm -r typecheck` are both fully green.
`node tools/scan-banned-phrases.cjs` clean across 252 files.

## Remaining gaps

- Pattern A pushes salt + encrypted_server_pw to `profiles` on signup
  and on each successful signin, so a 2nd device can pull them post-
  auth. But the **bootstrap** problem (a brand-new device with neither
  local data nor a JWT) is still resolved by "import a backup from
  your original device" — documented at the forgot-passphrase screen
  and at the new-device error code (`no-device-data` / `missing-salt`).
  This is the documented tradeoff in the Pattern A header.
- iOS shell + APNs + scheduled-jobs migration are still untouched
  (Sprint 4 holdovers — out of scope for this sprint).
- Settings → "delete account" only wipes local data; no server delete
  endpoint exists yet. The encrypted server row stays orphaned and
  unreadable. Confirm modal copy makes this clear.
- `consent.astrology` is now writable but no consumer reads it yet
  (no daily-reading notification has been wired). The gate exists for
  when that lands.

## Alpha-onboarding-ready

**Yes.** All three pre-alpha blockers identified in the audit (§10)
are closed:

1. Sign-in / sign-up UI exists at `AuthFlow.tsx`, wired at root.
2. Default country is no longer `TR` — onboarding picks browser locale
   and offers a manual override. US user → 988, not 182.
3. Settings screen MVP exists with sign-out, country, notification
   budget, privacy toggles, and encrypted export/import.

Pattern A makes the "we never see your passphrase" claim defensible:
the assertion test will fail any future regression that sends raw
passphrase to Supabase.

Branch state: `retention-telemetry`, 7 commits ahead of `origin/main`
(6 from this sprint + 1 pre-existing retention telemetry).
