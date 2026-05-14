# @ollie/capacitor-healthkit · production cutover checklist

Status: **BLOCKED-EXTERNAL**. Apple Developer account approval pending.
Estimated approval window: ~48–72h after submission. The package
scaffolds end-to-end; production cutover is a sequence of mechanical
steps, NOT a code change.

This checklist must be completed in order. Steps that touch signing
identity or App Store Connect are one-way — verify twice before
clicking.

---

## 1. Apple Developer prep

- [ ] Apple Developer account active (membership paid + approved). The
      developer agreement covers HealthKit as a "regulated" capability.
- [ ] Create / confirm Team in Xcode → Preferences → Accounts.
- [ ] In the Apple Developer portal:
  - Identifier `app.ollie.ollie` exists
  - HealthKit capability ENABLED on that identifier
  - Provisioning profile regenerated with HealthKit entitlement
      _(blocker · Serra: re-download the profile to the Mac after
      regenerating; Xcode caches the stale one)_

## 2. Xcode project capability + entitlement

- [ ] Open `apps/ios/ios/App/App.xcworkspace` in Xcode.
- [ ] App target → Signing & Capabilities → `+ Capability` → **HealthKit**.
- [ ] Confirm `App/App.entitlements` now contains:
  ```xml
  <key>com.apple.developer.healthkit</key>
  <true/>
  <key>com.apple.developer.healthkit.access</key>
  <array/>
  ```
- [ ] (Optional) For background delivery (push when HK has new data):
      add `<string>health-records</string>` to UIBackgroundModes. Not
      required for the v1 sync — we use setInterval-driven pulls.

## 3. Info.plist usage strings

- [x] `NSHealthShareUsageDescription` — "Ollie reads your steps, heart
      rate, and sleep data to surface patterns. Stays on your device."
- [x] `NSHealthUpdateUsageDescription` — "(unused; we don't write to
      HealthKit)" — must be present per Apple guidelines even when
      empty-by-policy.

      _(Both keys already committed to
      `apps/ios/ios/App/App/Info.plist`.)_

## 4. Plugin install

- [ ] Add the plugin dependency to the iOS shell:
  ```
  pnpm -F @ollie/ios add @capgo/capacitor-health@7.2.15
  pnpm -F @ollie/ios sync
  ```
  This runs `pod install` and registers the plugin with Capacitor's
  bridge.
- [ ] Verify `apps/ios/ios/App/Podfile.lock` lists `CapgoCapacitorHealth`
      (or the plugin's Pod name).
- [ ] Verify no Swift compile errors after the sync — open the
      workspace + `cmd-B`.

## 5. Web env flag

- [ ] In `apps/web/.env.production` (or the CI build secret store):
  ```
  VITE_HEALTHKIT_ENABLED=1
  ```
- [ ] Confirm the onboarding screen now renders the "Connect Apple
      Health" step in a TestFlight build. Web/desktop builds remain
      hidden because `isCapacitorNative()` is false.

## 6. Privacy nutrition labels (App Store Connect)

App Store Connect → My Apps → ollie → App Privacy:

- [ ] Health & Fitness → YES
  - Data Types collected: **Heart Rate**, **Steps**, **Sleep**,
    **Other Health Data (resting HR, hydration)**.
  - Linked to user identity: **No** (data is device-local; we do not
    upload HealthKit samples).
  - Used for tracking: **No**.
  - Purpose: **App Functionality**.
- [ ] Update Privacy Policy URL — must include the
      `## HealthKit data` section before submission (template in
      `docs/privacy/HEALTHKIT.md` — to be drafted by Serra).
- [ ] Update Terms of Service if it enumerates third-party services.

## 7. Real-device QA

Apple's review will reject if the prompt copy doesn't match the
declared usage strings, so we test on a real device before submission.

- [ ] Run `pnpm -F @ollie/ios run` on a signed iPhone.
- [ ] Walk through onboarding → tap "Connect Apple Health".
- [ ] Confirm the native HealthKit auth sheet appears with the exact
      copy from `NSHealthShareUsageDescription`.
- [ ] Toggle "Allow All" → finish onboarding.
- [ ] After ~30 seconds, open the body module and confirm a non-zero
      step count appears (or check `localStorage` for the
      `healthkit.samples_steps_byDay` key).
- [ ] Repeat with "Don't Allow" — confirm the app does NOT crash and
      that subsequent reads return empty arrays gracefully.

## 8. App Store submission

- [ ] Submit build to TestFlight first.
- [ ] In App Store Connect → App Review notes, include:
  > "Ollie reads HealthKit data (steps, heart rate, sleep, resting
  > heart rate, hydration) to surface body and sleep patterns. All
  > HealthKit data stays on-device — we never upload it. The user
  > can revoke access at any time in Settings → Privacy → Health."
- [ ] Apple review typically 24–72h. HealthKit apps occasionally get
      a one-cycle bounce asking for a demo video; we record one if
      asked.

## 9. Monitor for 48 hours post-launch

- [ ] Watch Sentry for `[healthkit]` warnings.
- [ ] Watch in-app `body.water_log` vs `healthkit.samples_hydration_today`
      — confirm they don't drift wildly (would indicate a bug in the
      no-merge rule).
- [ ] Confirm `healthkit.last_sync_at` advances on a 6h cadence in
      live builds (check via the debug panel in Settings).

---

## Permanent constraints (do not relax)

- **READ-ONLY product list** is locked in `src/types.ts` as
  `HEALTHKIT_READ_TYPES`. Adding `bloodGlucose`, `bloodPressure`, etc.
  requires:
  1. senior-engineer + Serra sign-off
  2. updated Info.plist copy + privacy nutrition labels
  3. an updated Privacy Policy + Terms of Service
  4. a fresh App Store submission cycle

- **`write: []` is mandatory** at every `requestAuthorization` call.
  See `permissions.ts` — adding a write target requires changing
  `NSHealthUpdateUsageDescription` and updating this checklist.

- **No HealthKit data leaves the device.** The local store namespace
  `healthkit.*` is NOT in the encrypt-and-sync set used by
  `@ollie/sync`. Even the B2B research opt-in (Sprint 2026-05-14)
  EXCLUDES HealthKit data by default. Re-opening the door requires
  Serra + a fresh consent prompt with explicit HealthKit disclosure.

- **Onboarding rendering is env-gated.** The "Connect Apple Health"
  screen renders ONLY when `VITE_HEALTHKIT_ENABLED === '1'`. This
  prevents accidental web-build exposure of a feature that can't
  function there.

- **The Apple per-type READ status is unobservable.** Apple's privacy
  model means we cannot tell which of the 5 metrics the user actually
  granted. `getPermissionStatus()` returns `HK_AUTH_UNKNOWN` as a
  normal outcome — callers must NOT treat that as "denied". The right
  move is "try a read, surface empty state honestly".

---

## Rollback

If a post-launch issue surfaces, the kill switch is two steps:

1. Set `VITE_HEALTHKIT_ENABLED=0` in the production env and rebuild.
   The onboarding screen disappears + readers no-op.
2. (More aggressive) ship a build that removes the HealthKit
   capability from the entitlements file. Apple users keep existing
   permissions but the app stops calling HKHealthStore.

The native plugin Pod cannot be cleanly hot-removed without an App
Store update, so the env flag is the operational lever.
