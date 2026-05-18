/**
 * @ollie/capacitor-healthkit · narrow types
 *
 * Why this file exists:
 *   The underlying Capacitor plugin (@capgo/capacitor-health) ships a
 *   wide API for HealthKit + Android Health Connect. We narrow to the
 *   exact metrics ollie consumes today (steps, heart rate, sleep,
 *   resting HR, hydration) and brand the auth handles so callers can't
 *   confuse "authorized" with "denied" via a stringly-typed boolean.
 *
 *   Locked constraints (read in concert with PRODUCTION_CHECKLIST.md):
 *     - READ-ONLY: we never write to HKHealthStore. The `write` set
 *       passed to requestAuthorization() is always EMPTY.
 *     - device-local: HealthKit samples never leave the user's device;
 *       no Supabase row, no edge function, no analytics packet ever
 *       carries a HealthKit sample (see sync.ts: writes ONLY into the
 *       local @ollie/store namespaces body / sleep).
 *     - native-only: web/SSR runtimes must safely no-op. Callers should
 *       gate on `isHealthKitAvailable()` before invoking any reader.
 */

// ─── branded auth status ──────────────────────────────────────────────

/**
 * Opaque branded authorization status. Returned from getPermissionStatus
 * and requestPermissions. Callers should treat as opaque and only
 * compare via the exported predicates (`isAuthorized`, etc.).
 *
 * Why branded: prevents call-site bugs where `status === 'granted'` is
 * compared against the wrong string literal. The brand forces callers
 * through the typed helpers.
 */
export type HealthKitAuthStatus =
  & string
  & { readonly __brand: 'HealthKitAuthStatus' };

export const HK_AUTH_GRANTED   = 'granted'   as HealthKitAuthStatus;
export const HK_AUTH_DENIED    = 'denied'    as HealthKitAuthStatus;
export const HK_AUTH_PARTIAL   = 'partial'   as HealthKitAuthStatus;
export const HK_AUTH_UNKNOWN   = 'unknown'   as HealthKitAuthStatus;
/** Web / SSR / unsupported native runtime — plugin not callable. */
export const HK_AUTH_UNSUPPORTED = 'unsupported' as HealthKitAuthStatus;

export function isAuthorized(s: HealthKitAuthStatus): boolean {
  return s === HK_AUTH_GRANTED || s === HK_AUTH_PARTIAL;
}

// ─── the metrics we read ──────────────────────────────────────────────

/**
 * Locked set of metrics ollie reads. Adding to this list requires:
 *   1. senior-engineer + Serra sign-off
 *   2. updated NSHealthShareUsageDescription copy in apps/ios Info.plist
 *   3. updated Privacy Policy + App Store Connect data declarations
 *   4. updated PRODUCTION_CHECKLIST.md
 *
 * The underlying plugin (@capgo/capacitor-health) accepts these strings;
 * we re-export as a typed literal union so callers can't pass typos.
 */
export const HEALTHKIT_READ_TYPES = [
  'stepCount',
  'heartRate',
  'sleepAnalysis',
  'restingHeartRate',
  'hydration',
] as const;

export type HealthKitDataType = (typeof HEALTHKIT_READ_TYPES)[number];

/**
 * Branded sample id. HealthKit's HKQuantitySample UUID
 * is the source of truth; we brand it so cross-record joins can't
 * accidentally pair a step sample with a sleep id.
 */
export type HealthKitSampleId = string & { readonly __brand: 'HealthKitSampleId' };

// ─── normalized samples (ollie internal shape) ────────────────────────

/**
 * Common envelope. `source` is always 'healthkit' so downstream modules
 * can distinguish HealthKit-sourced rows from manual entries or other
 * providers (e.g. future Google Fit).
 */
export interface HealthKitSampleBase {
  id: HealthKitSampleId;
  start_ts: number;        // unix ms — sample start
  end_ts: number;          // unix ms — sample end (== start for point samples)
  source: 'healthkit';
  /** ms when this sample was normalized into ollie's shape. */
  ingested_at: number;
}

export interface HealthKitStepSample extends HealthKitSampleBase {
  kind: 'stepCount';
  /** integer count over the bucket [start_ts, end_ts]. */
  steps: number;
}

export interface HealthKitHeartRateSample extends HealthKitSampleBase {
  kind: 'heartRate';
  /** beats per minute. */
  bpm: number;
}

export interface HealthKitRestingHRSample extends HealthKitSampleBase {
  kind: 'restingHeartRate';
  /** beats per minute. */
  bpm: number;
}

export interface HealthKitHydrationSample extends HealthKitSampleBase {
  kind: 'hydration';
  /** milliliters of water intake. */
  volume_ml: number;
}

export type HealthKitSleepStage =
  | 'inBed'
  | 'asleep'        // generic "asleep" when stage detail unavailable
  | 'awake'
  | 'remSleep'
  | 'deepSleep'     // == coreSleep on older iOS — we collapse to deepSleep
  | 'lightSleep';

export interface HealthKitSleepSample extends HealthKitSampleBase {
  kind: 'sleepAnalysis';
  stage: HealthKitSleepStage;
  /** Convenience: end_ts - start_ts in minutes. */
  duration_min: number;
}

export type HealthKitSample =
  | HealthKitStepSample
  | HealthKitHeartRateSample
  | HealthKitRestingHRSample
  | HealthKitHydrationSample
  | HealthKitSleepSample;

// ─── raw plugin shapes (we narrow @capgo/capacitor-health's wider type) ─

/**
 * The shape a single sample from @capgo/capacitor-health takes. The
 * upstream type is `any`-ish — we declare what we read and ignore the
 * rest. Keeping this declared in our own package means tests can build
 * fixtures without importing the (native-only) plugin.
 */
export interface RawHealthSample {
  startDate: string;       // ISO 8601
  endDate: string;         // ISO 8601
  value: number | string;  // numeric for quantity samples; string ('asleep' / 'remSleep' / ...) for sleep
  unit?: string;           // 'count', 'count/min', 'ml', etc.
  /** UUID-ish stable id from HKHealthStore when present. */
  id?: string;
  source?: string;         // HKSource name (e.g. "iPhone Health")
}

export interface RawAggregatedBucket {
  /** ISO 8601 inclusive start of the bucket. */
  startDate: string;
  /** ISO 8601 exclusive end of the bucket. */
  endDate: string;
  value: number;
}

// ─── permission shape ─────────────────────────────────────────────────

export interface PermissionRequestResult {
  status: HealthKitAuthStatus;
  /** Per-type grant detail — useful for UX surfaces. */
  granted: ReadonlyArray<HealthKitDataType>;
  denied: ReadonlyArray<HealthKitDataType>;
  /** When false, the plugin failed to load or the runtime is non-native. */
  available: boolean;
}
