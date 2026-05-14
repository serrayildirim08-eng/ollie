# @ollie/capacitor-healthkit

Read-only Apple HealthKit integration for ollie's body + sleep modules.

**Status: BLOCKED-EXTERNAL.** Apple Developer account approval pending.
The package scaffolds end-to-end (types, permissions, readers, sync
pipeline, normalize tests). Real reads light up when:

1. Apple Developer account is approved + a signing identity is
   provisioned in Xcode.
2. The HealthKit capability is enabled on the iOS target (Signing &
   Capabilities → + Capability → HealthKit).
3. The `@capgo/capacitor-health` Pod is installed (`pnpm -F @ollie/ios sync`).
4. `VITE_HEALTHKIT_ENABLED=1` is set in the web build environment.

Until then, every public reader returns `null` (safe no-op) and the
onboarding screen hides the consent UI behind the env flag.

## Surface

- `requestPermissions(input)` — prompts for READ access on the locked
  type set (stepCount + heartRate + sleepAnalysis + restingHeartRate +
  hydration). NEVER prompts for WRITE.
- `getPermissionStatus(types?)` — best-effort. Apple's privacy model
  hides per-type READ state; `HK_AUTH_UNKNOWN` is a normal return.
- `readSteps(days?)`, `readHeartRate(trailingHours?)`,
  `readSleepLastNight()`, `readRestingHeartRate()`,
  `readHydrationToday()` — bounded-window readers.
  All return `null` when the runtime can't reach HealthKit.
- `normalizeSamples(kind, rows, ts)` — pure HKQuantitySample/
  HKCategorySample → ollie internal shape.
- `syncHealthKit(store, opts?)` — one pull cycle. Idempotent.
- `scheduleHealthKitSync(store, opts?)` — setInterval wrapper. Returns
  a `SchedulerHandle` with `stop()` + `runNow()`.

## Read-only invariant

Permissions request hard-codes `write: []`. Adding write access
requires:

1. senior-engineer + Serra sign-off
2. updated `NSHealthUpdateUsageDescription` in
   `apps/ios/ios/App/App/Info.plist` (currently the deliberately
   empty `(unused; we don't write to HealthKit)`)
3. updated PRODUCTION_CHECKLIST.md

## Where HealthKit samples live

```
HKHealthStore (device, OS-managed)
        ↓ querySamples / queryAggregated via @capgo/capacitor-health
JS bridge (request-scoped — no caching)
        ↓ normalizeSamples (pure)
ollie internal HealthKitSample shape
        ↓ syncHealthKit
@ollie/store · healthkit.* keys (device-local, NOT in encrypt-and-sync set)
        ↓ optional mirror (only if no in-app sleep record exists)
@ollie/store · sleep.records  (still device-local until user opts into B2B research)
```

The plaintext sample never leaves the user's device. There is no
edge function, no Supabase row, no analytics packet that carries a
HealthKit sample. The B2B-research opt-in (Sprint 2026-05-14) does
NOT extend to HealthKit data by default — see ConsentScreen.

## Tests

```
pnpm -F @ollie/capacitor-healthkit test
```

Normalization is the only fully-testable layer pre-approval.
Permissions + readers have unit tests via the `pluginOverride`
injection hook that bypasses the runtime gate.

## Plugin decision

We pin `@capgo/capacitor-health@7.2.15` (Capacitor 7 compatible, last
published 2026-05-11). Alternatives considered:

- `@perfood/capacitor-healthkit@1.3.2` — pinned to Capacitor 4. Ollie
  is on Capacitor 7. Rejected.
- `capacitor-health@7.1.0` — single-vendor (Mley). Less actively
  maintained than the Capgo fork. Rejected for the "minimum drift
  risk" reason — Capgo already supplies our `capacitor-native-biometric`.

If the plugin proves problematic during real-device testing,
swapping is contained: only `runtime.ts` (`loadHealthPlugin`) and
`permissions.ts` (`pluginNameFor` data-type strings) reference it.

## Pre-approval scaffold mode

Until the Apple Developer account is provisioned, `isHealthKitAvailable()`
returns false. The package is import-safe — there is no top-level
`@capgo/capacitor-health` import; the plugin loads lazily via
`await import('@capgo/capacitor-health')` only after the runtime
guard passes. This lets the web bundle build cleanly without the
plugin's native dependencies.
