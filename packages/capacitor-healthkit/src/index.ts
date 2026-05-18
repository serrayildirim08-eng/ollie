/**
 * @ollie/capacitor-healthkit · public surface
 *
 * Read-only HealthKit integration for ollie's body + sleep modules.
 * Pattern:
 *   - branded types lock the auth surface at the type level
 *   - runtime detection so web/SSR no-op safely
 *   - normalization is pure + testable
 *   - sync pipeline is idempotent + device-local
 *
 * Constitutional rules (locked):
 *   - READ-ONLY: we never write to HKHealthStore. `write: []` is
 *     enforced in permissions.ts at the call site.
 *   - DEVICE-LOCAL: HealthKit samples are persisted only into the
 *     local `@ollie/store` `healthkit.*` namespace + a guarded mirror
 *     into `sleep.records` when the user has no in-app sleep record.
 *     NO Supabase row, NO edge function, NO analytics packet ever
 *     carries a HealthKit sample. See PRODUCTION_CHECKLIST.md.
 *   - NATIVE-ONLY: Web bundles dynamic-import the plugin behind
 *     `Capacitor.isNativePlatform()`; everything else no-ops.
 *
 * Pre-Apple-Developer-approval state (BLOCKED-EXTERNAL):
 *   `isHealthKitAvailable()` will return false because the iOS app
 *   isn't signed yet + the plugin Pod hasn't been installed. The
 *   package is import-safe (no top-level plugin import) and the
 *   onboarding screen renders behind `VITE_HEALTHKIT_ENABLED`. Once
 *   the entitlements land, flipping the env var lights it up — no
 *   code change required.
 */

export {
  HEALTHKIT_READ_TYPES,
  HK_AUTH_DENIED,
  HK_AUTH_GRANTED,
  HK_AUTH_PARTIAL,
  HK_AUTH_UNKNOWN,
  HK_AUTH_UNSUPPORTED,
  isAuthorized,
  type HealthKitAuthStatus,
  type HealthKitDataType,
  type HealthKitHeartRateSample,
  type HealthKitHydrationSample,
  type HealthKitRestingHRSample,
  type HealthKitSample,
  type HealthKitSampleBase,
  type HealthKitSampleId,
  type HealthKitSleepSample,
  type HealthKitSleepStage,
  type HealthKitStepSample,
  type PermissionRequestResult,
  type RawAggregatedBucket,
  type RawHealthSample,
} from './types';

export {
  getPermissionStatus,
  requestPermissions,
  type RequestPermissionsInput,
} from './permissions';

export {
  readHeartRate,
  readHydrationToday,
  readRestingHeartRate,
  readSleepLastNight,
  readSteps,
  type ReaderContext,
} from './read';

export {
  normalizeHeartRateSample,
  normalizeHydrationSample,
  normalizeRestingHRSample,
  normalizeSamples,
  normalizeSleepSample,
  normalizeStepSample,
} from './normalize';

export {
  HEALTHKIT_SYNC_INTERVAL_MS,
  bucketStepsByDay,
  mirrorSleepRecords,
  pickLatest,
  scheduleHealthKitSync,
  sleepSegmentsToRecord,
  syncHealthKit,
  upsertById,
  type SchedulerHandle,
  type SyncOptions,
  type SyncResult,
} from './sync';

export {
  getPlatform,
  isCapacitorNative,
  isHealthKitAvailable,
  loadHealthPlugin,
  type HealthPluginShape,
} from './runtime';
