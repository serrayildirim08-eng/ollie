# Capacitor iOS Shell — Re-Audit (2026-05-14, post Sprint Item F)

> **Note for Serra:** Documents path TCC-sandboxed. File at `audits/AUDIT_capacitor.md`. Item F formalized HealthKit scaffolding into `packages/capacitor-healthkit/`.

**Status:** Approval-blocked but architecturally sound. No drift across configs.

---

## TL;DR (100 words)

Capacitor **7.6.4** + iOS 15.0 minimum confirmed. Bundle ID `app.ollie.ollie` verified. **Five core plugins active/scaffolded**: Sentry (live), PushNotifications + LocalNotifications (code ready, approval-gated), NativeBiometric (Face ID/Touch ID, active), App lifecycle. **NEW in Item F:** `packages/capacitor-healthkit/` formalized with PRODUCTION_CHECKLIST.md, unit tests (permissions/normalize/sync), runtime feature gate, `@capgo/capacitor-health@7.2.15` chosen over @perfood. All 6 NS* privacy descriptions in Info.plist; Siri Intents (3 shortcuts, iOS 16+) wired. **TestFlight pipeline blocked** on Apple Dev approval + signing identity. No drift: all configs, Swift code, entitlements in sync. Approval-gated features safely env-gated; shipping without them is safe.

---

## Versions

| Component | Version | Status |
|---|---|---|
| `@capacitor/cli` | 7.0.0 | ✓ |
| `@capacitor/core` | 7.0.0 | ✓ |
| `@capacitor/ios` | 7.0.0 | ✓ |
| Capacitor native (Podfile.lock) | 7.6.4 | ✓ Current |
| Bundle ID | `app.ollie.ollie` | ✓ |
| iOS deployment target | 15.0 | ✓ |

---

## Plugins inventory

| Plugin | Version | Status | Notes |
|---|---|---|---|
| Sentry Capacitor | `@sentry/capacitor@4.0.0` + Sentry 9.8.0 native | ACTIVE | Auto-init via packageClassList |
| LocalNotifications | `@capacitor/local-notifications` (dynamic) | SCAFFOLDED | On-device only; no APNs entitlement needed |
| PushNotifications | `@capacitor/push-notifications` (dynamic) | SCAFFOLDED | Awaits Apple Dev approval + entitlement |
| HealthKit (Item F) | `@ollie/capacitor-healthkit@0.0.1` wrapping `@capgo/capacitor-health@7.2.15` | SCAFFOLDED + tested | Behind VITE_HEALTHKIT_ENABLED gate; tests pass |
| NativeBiometric | `@capgo/capacitor-native-biometric@8.4.5` | ACTIVE | Face ID / Touch ID; no approval needed |
| App | `@capacitor/app@8.1.0` | ACTIVE | Lifecycle + deep linking (Siri intent routing) |
| SplashScreen + StatusBar | bundled | ACTIVE | `#F2EEE4` cream styling |

---

## Privacy descriptions (Info.plist)

| Key | Status |
|---|---|
| `NSMicrophoneUsageDescription` | ✓ Active (voice capture) |
| `NSSpeechRecognitionUsageDescription` | ✓ Active (on-device transcription) |
| `NSHealthShareUsageDescription` | ⚠ Blocked (Apple approval) |
| `NSHealthUpdateUsageDescription` | ✓ Placeholder ("unused; we don't write") |
| `CFBundleURLSchemes` | ✓ `ollie://` declared |
| NOT requested | Camera, Photos, Contacts, Location, Calendar, Bluetooth, Local Network |

All copy is user-facing, no dark patterns. Read-only HealthKit policy enforced in code.

---

## Siri Intents (iOS 16+)

| Intent | Phrase | URL | Action |
|---|---|---|---|
| OllieCaptureIntent | "Hey Siri, ollie capture" | `ollie://capture` | Voice capture UI |
| OllieRemindIntent | "Hey Siri, ollie remind" | `ollie://admin?action=remind` | Reminder draft |
| OllieDueIntent | "Hey Siri, ollie what's due" | `ollie://dashboard?focus=upcoming` | Dashboard upcoming view |

Implementation: AppIntents framework (iOS 16+), `@available` guards present, graceful on iOS 14-15.

---

## Item F deltas (NEW)

### packages/capacitor-healthkit/ structure
```
package.json (private workspace, @ollie/capacitor-healthkit@0.0.1)
tsconfig.json
README.md          — architecture + plugin decision
PRODUCTION_CHECKLIST.md  — 9-step cutover
src/
  index.ts         — public API
  types.ts         — HEALTHKIT_READ_TYPES + branded types
  permissions.ts   — requestPermissions (write:[] hard-locked)
  read.ts          — 5 bounded readers
  normalize.ts     — pure HK→ollie shape (testable pre-approval)
  sync.ts          — pipeline + scheduleHealthKitSync()
  runtime.ts       — isHealthKitAvailable() gate
tests/
  permissions.test.ts
  normalize.test.ts
  sync.test.ts
```

**43 tests passing.** Plugin chosen: `@capgo/capacitor-health@7.2.15` over `@perfood` (Cap 4 only) — consolidates vendor risk with biometric plugin.

### Privacy
- HK samples → `healthkit.*` namespace (device-local; NOT in encrypt-and-sync set)
- Sleep mirror inserts to `sleep.records` only if no in-app record exists for that `night_of`
- B2B research opt-in explicitly EXCLUDES HK data
- `write: []` hard-coded — read-only invariant enforced at requestAuthorization

### Gating
- `isHealthKitAvailable()` requires Capacitor native + iOS
- Onboarding consent UI renders only when `VITE_HEALTHKIT_ENABLED=1`
- Plugin lazy-imported; web build never resolves HK module

---

## TestFlight readiness

| Checkpoint | Status |
|---|---|
| Xcode project opens | ✓ |
| Bundle ID configured | ✓ |
| Compiles locally | ? (not tested in audit) |
| Signing identity | ✗ Generic "iPhone Developer" |
| Team ID | ✗ Awaits Apple Dev approval |
| Push entitlement | ✗ Capability not enabled |
| HealthKit entitlement | ✗ Capability not enabled |
| Archive + export config | ✗ No ExportOptions.plist |
| TestFlight pipeline | ✗ NOT STARTED |

Critical path: Apple Dev approval → Xcode Team config → Auto-signing → Add Push + HealthKit capabilities → Archive → Upload.

---

## Gaps

### Missing env documentation
`.env.local.example` lacks: `VITE_PUSH_REGISTER_ENDPOINT`, `VITE_PUSH_REGISTER_AUTH`, `VITE_HEALTHKIT_ENABLED`. Add with comments.

### APNs worker not deployed
Code references `VITE_PUSH_REGISTER_ENDPOINT` but Cloudflare Worker not deployed yet.

### HealthKit pod install pending
`@capgo/capacitor-health@7.2.15` is in TypeScript package but **not yet pod-installed**. Step 4 of PRODUCTION_CHECKLIST.md handles this post-approval.

### Hydration limitation
Capgo plugin does NOT support hydration natively. Reader returns empty on iOS until Capgo adds it. `body.water_log` remains canonical.

---

## Top 3 next steps

1. Monitor Apple Dev approval email (expected imminently per memory)
2. Add VITE_* env var documentation to `.env.local.example`
3. Deploy Cloudflare Worker for APNs token registration (`VITE_PUSH_REGISTER_ENDPOINT`)

## BLOCKED-EXTERNAL
- Apple Developer account approval (gates push entitlement, HealthKit entitlement, TestFlight, signing identity)

*Re-audit by Claude (Opus 4.7), 2026-05-14, post Item F.*
