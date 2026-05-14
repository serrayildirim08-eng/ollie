/**
 * @ollie/capacitor-healthkit · permissions
 *
 * Single entry point for the iOS HealthKit auth dance. Surfaces a
 * narrow `requestPermissions(types)` + `getPermissionStatus()` so the
 * onboarding screen (apps/web · OnboardingScreen `HealthKitScreen`)
 * doesn't have to know about the plugin shape.
 *
 * HealthKit auth model — important context:
 *   - iOS NEVER tells the app whether READ access was granted. The
 *     `requestAuthorization` returns success regardless of the user's
 *     toggle decisions, by design (Apple's privacy stance: the app
 *     can't probe for whether you said yes or no).
 *   - The only signal we get is "the prompt completed". On a denied
 *     read, subsequent `query*` calls return an empty array — which
 *     looks identical to "you really had no data".
 *   - So `getPermissionStatus()` is a best-effort: we cache the last
 *     prompt outcome in the store + verify by running a 1-day probe
 *     query. We expose this caveat in the UI copy.
 *
 * Locked: this file never requests WRITE access. The `write: []` array
 * is enforced at every call site. Adding write access requires:
 *   1. senior-engineer + Serra sign-off
 *   2. updated NSHealthUpdateUsageDescription (currently "(unused)")
 *   3. updated PRODUCTION_CHECKLIST.md
 */

import {
  asHealthPlugin,
  isHealthKitAvailable,
  loadHealthPlugin,
} from './runtime';
import {
  HEALTHKIT_READ_TYPES,
  HK_AUTH_DENIED,
  HK_AUTH_GRANTED,
  HK_AUTH_PARTIAL,
  HK_AUTH_UNKNOWN,
  HK_AUTH_UNSUPPORTED,
  type HealthKitAuthStatus,
  type HealthKitDataType,
  type PermissionRequestResult,
} from './types';

/**
 * Map ollie's internal type names to the plugin's wire-level strings.
 * The Capgo plugin uses camelCase identifiers that happen to match
 * ours, but we keep the indirection so we can swap to a different
 * plugin later without leaking that decision to the orchestrator.
 */
function pluginNameFor(t: HealthKitDataType): string {
  switch (t) {
    case 'stepCount':        return 'steps';
    case 'heartRate':        return 'heartRate';
    case 'sleepAnalysis':    return 'sleep';
    case 'restingHeartRate': return 'restingHeartRate';
    case 'hydration':        return 'hydration';
    default: {
      const _exhaustive: never = t;
      throw new Error(`@ollie/capacitor-healthkit: unknown data type ${String(_exhaustive)}`);
    }
  }
}

export interface RequestPermissionsInput {
  /** Subset of HEALTHKIT_READ_TYPES to prompt for. Defaults to all 5. */
  types?: ReadonlyArray<HealthKitDataType>;
}

/**
 * Prompt the user for HealthKit READ access on the requested types.
 *
 * SAFE OFF NATIVE: returns `{ status: HK_AUTH_UNSUPPORTED, available: false }`
 * on web / Android / unsupported builds — callers should treat this as
 * "feature unavailable, skip silently" rather than an error.
 *
 * On a successful prompt iOS does NOT report per-type grant state to
 * us (Apple privacy stance). We optimistically mark the requested set
 * as `granted` and the empty set as `denied`; the orchestrator
 * verifies real access by running a 1-day probe query later.
 */
export async function requestPermissions(
  input: RequestPermissionsInput = {},
): Promise<PermissionRequestResult> {
  const requested = input.types ?? HEALTHKIT_READ_TYPES;

  if (!isHealthKitAvailable()) {
    return {
      status: HK_AUTH_UNSUPPORTED,
      granted: [],
      denied: [],
      available: false,
    };
  }

  const handle = await loadHealthPlugin();
  if (!handle) {
    return {
      status: HK_AUTH_UNSUPPORTED,
      granted: [],
      denied: [],
      available: false,
    };
  }

  const plugin = asHealthPlugin(handle);
  const wireTypes = requested.map(pluginNameFor);

  try {
    const r = await plugin.requestAuthorization({
      read: wireTypes,
      write: [], // LOCKED: read-only — see file header.
    });
    // Apple privacy stance: we can't really observe per-type state. The
    // plugin may return { authorized: true } generically; we treat
    // that as "prompt completed, optimistically grant".
    const optimistic: HealthKitAuthStatus =
      r.authorized === false ? HK_AUTH_DENIED : HK_AUTH_GRANTED;

    return {
      status: optimistic,
      granted: optimistic === HK_AUTH_GRANTED ? requested : [],
      denied: optimistic === HK_AUTH_GRANTED ? [] : requested,
      available: true,
    };
  } catch (err) {
    // Cancel / failure path — surface as UNKNOWN so the UI can re-prompt
    // next session if the user wants to try again.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[healthkit] requestAuthorization threw', err instanceof Error ? err.message : String(err));
    }
    return {
      status: HK_AUTH_UNKNOWN,
      granted: [],
      denied: [],
      available: true,
    };
  }
}

/**
 * Best-effort current permission status. NOTE the Apple caveat in this
 * file's header: a "denied READ" looks identical to "no data exists"
 * for the user, so this method may return HK_AUTH_UNKNOWN even after
 * a clean prompt. Callers should treat UNKNOWN as "try a read; if
 * empty, assume no data OR no permission".
 */
export async function getPermissionStatus(
  types: ReadonlyArray<HealthKitDataType> = HEALTHKIT_READ_TYPES,
): Promise<HealthKitAuthStatus> {
  if (!isHealthKitAvailable()) return HK_AUTH_UNSUPPORTED;

  const handle = await loadHealthPlugin();
  if (!handle) return HK_AUTH_UNSUPPORTED;

  const plugin = asHealthPlugin(handle);
  if (!plugin.getAuthorizationStatus) {
    // Plugin version doesn't expose status — defer to UNKNOWN.
    return HK_AUTH_UNKNOWN;
  }

  try {
    const r = await plugin.getAuthorizationStatus({
      dataTypes: types.map(pluginNameFor),
    });
    return normalizePluginStatus(r.status);
  } catch {
    return HK_AUTH_UNKNOWN;
  }
}

/** Map the plugin's status strings to our branded values. */
function normalizePluginStatus(s: string | undefined): HealthKitAuthStatus {
  if (!s) return HK_AUTH_UNKNOWN;
  const low = s.toLowerCase();
  if (low === 'authorized' || low === 'granted' || low === 'sharing_authorized') {
    return HK_AUTH_GRANTED;
  }
  if (low === 'denied' || low === 'sharing_denied') {
    return HK_AUTH_DENIED;
  }
  if (low === 'partial') {
    return HK_AUTH_PARTIAL;
  }
  return HK_AUTH_UNKNOWN;
}

// Re-export commonly used constants so the onboarding component can
// import everything from a single path.
export {
  HEALTHKIT_READ_TYPES,
  HK_AUTH_DENIED,
  HK_AUTH_GRANTED,
  HK_AUTH_PARTIAL,
  HK_AUTH_UNKNOWN,
  HK_AUTH_UNSUPPORTED,
} from './types';
