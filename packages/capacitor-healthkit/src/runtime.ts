/**
 * @ollie/capacitor-healthkit · runtime detection + plugin loader
 *
 * HealthKit lives only on iOS native (Capacitor). Web bundles, SSR,
 * Node tests, and Capacitor on Android (without Health Connect parity)
 * must all NO-OP safely without throwing at import time.
 *
 * Pattern lifted from apps/web/src/lib/biometric.ts (Serra-approved):
 *   - dynamic import behind isNativePlatform()
 *   - swallow the import error if the plugin isn't installed
 *   - return null so callers can branch
 *
 * Why a separate module: tests can mock this surface to simulate
 * "native available", "plugin missing", and "permission flow" without
 * spinning up Capacitor.
 */

interface CapacitorGlobal {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  };
}

export function isCapacitorNative(): boolean {
  const g = globalThis as unknown as CapacitorGlobal;
  return g.Capacitor?.isNativePlatform?.() === true;
}

export function getPlatform(): string {
  const g = globalThis as unknown as CapacitorGlobal;
  try {
    return g.Capacitor?.getPlatform?.() ?? 'web';
  } catch {
    return 'web';
  }
}

/**
 * HealthKit is iOS-only. Even when a Capacitor runtime is present we
 * gate on platform === 'ios'. Android Health Connect ships in the same
 * plugin and could be enabled later — that requires its own approval
 * + checklist + entitlements review.
 */
export function isHealthKitAvailable(): boolean {
  return isCapacitorNative() && getPlatform() === 'ios';
}

/**
 * Lazy-load the @capgo/capacitor-health plugin. Returns null when:
 *   - we're on web/SSR
 *   - we're on Capacitor but not iOS
 *   - the plugin isn't installed at runtime (workspace install lag,
 *     or the explicit STUB path during pre-Apple-approval scaffolding)
 *
 * The unknown return type is deliberate: callers narrow to the API
 * shape they use via a typed wrapper in read.ts / permissions.ts.
 */
export async function loadHealthPlugin(): Promise<unknown | null> {
  if (!isHealthKitAvailable()) return null;
  try {
    // The plugin path is intentionally a string literal so static
    // analyzers + the web bundler can tree-shake it out — Capacitor
    // injects the native bridge at runtime, no bundled JS exists.
    const mod = await import('@capgo/capacitor-health');
    // The plugin exports a `Health` named export.
    const Health = (mod as { Health?: unknown }).Health ?? null;
    return Health;
  } catch (err) {
    // Pre-Apple-approval the plugin may not be installed in the iOS
    // shell — we degrade to unsupported and log once. Production
    // cutover (PRODUCTION_CHECKLIST step 5) installs it.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(
        '[healthkit] @capgo/capacitor-health not installed at runtime; reads will no-op',
        err instanceof Error ? err.message : String(err),
      );
    }
    return null;
  }
}

// ─── plugin surface (narrowed) ────────────────────────────────────────

/**
 * The subset of @capgo/capacitor-health's API surface we touch. Kept
 * as a structural interface so tests can pass a hand-rolled mock that
 * implements only these methods.
 */
export interface HealthPluginShape {
  requestAuthorization(opts: {
    read: ReadonlyArray<string>;
    write: ReadonlyArray<string>;
  }): Promise<{ authorized?: boolean; status?: string }>;

  /** Optional — not all versions of the plugin expose status independently. */
  getAuthorizationStatus?(opts: {
    dataTypes: ReadonlyArray<string>;
  }): Promise<{ status?: string; perType?: Record<string, string> }>;

  queryAggregated(opts: {
    dataType: string;
    startDate: string;
    endDate: string;
    bucket?: 'hour' | 'day' | 'week' | 'month';
    aggregation?: 'sum' | 'average' | 'min' | 'max';
  }): Promise<{ samples: Array<{ startDate: string; endDate: string; value: number }> }>;

  querySamples?(opts: {
    dataType: string;
    startDate: string;
    endDate: string;
    limit?: number;
  }): Promise<{ samples: Array<{ startDate: string; endDate: string; value: number | string; unit?: string; id?: string; source?: string }> }>;
}

/**
 * Cast helper. Centralized so the `as` happens in one place. Throws if
 * the plugin handle is null — callers must guard with
 * isHealthKitAvailable() first.
 */
export function asHealthPlugin(handle: unknown): HealthPluginShape {
  if (handle == null) {
    throw new Error('@ollie/capacitor-healthkit: plugin not loaded');
  }
  return handle as HealthPluginShape;
}
