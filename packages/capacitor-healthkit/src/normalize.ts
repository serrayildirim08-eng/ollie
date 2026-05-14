/**
 * @ollie/capacitor-healthkit · normalization
 *
 * HKQuantitySample / HKCategorySample → ollie internal sample shape.
 * Pure functions. No plugin imports. Importable in tests + workers.
 *
 * Why isolate this:
 *   - HealthKit's raw shape varies by plugin version + iOS version.
 *     `value` may be a number ("steps":4321) or a string
 *     ("stage":"asleep" / "rem"). Sleep samples use category values,
 *     quantity samples use scalar values. Centralising the mapping
 *     keeps the rest of the code clean and testable.
 *   - We tolerate missing fields by clamping or defaulting; we never
 *     throw inside the normalizer. A malformed sample becomes `null`
 *     and the orchestrator drops it on the floor with a debug log.
 */

import type {
  HealthKitDataType,
  HealthKitHeartRateSample,
  HealthKitHydrationSample,
  HealthKitRestingHRSample,
  HealthKitSample,
  HealthKitSampleId,
  HealthKitSleepSample,
  HealthKitSleepStage,
  HealthKitStepSample,
  RawHealthSample,
} from './types';

// ─── id minting ───────────────────────────────────────────────────────

/**
 * Stable id derivation. When the plugin reports a HKHealthStore UUID
 * we use it; otherwise we mint a deterministic hash from
 * `${kind}|${startISO}|${endISO}|${value}` so repeat runs of the
 * normalizer over the same source data produce the same id (the
 * orchestrator dedupes on id, so this powers idempotent upsert).
 */
function deriveSampleId(
  kind: HealthKitDataType,
  raw: RawHealthSample,
): HealthKitSampleId {
  if (raw.id && raw.id.length > 0) {
    return raw.id as HealthKitSampleId;
  }
  // Deterministic fallback — readable for debugging and resistant to
  // double-ingestion of the same wall-clock sample. Not a crypto hash;
  // this is dedup glue, not a security primitive.
  const k = `${kind}|${raw.startDate}|${raw.endDate}|${String(raw.value)}`;
  return `hk-syn-${djb2(k).toString(36)}` as HealthKitSampleId;
}

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// ─── small helpers (pure) ─────────────────────────────────────────────

function parseTs(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function asNumber(v: number | string | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

// ─── per-kind normalizers ─────────────────────────────────────────────

export function normalizeStepSample(raw: RawHealthSample, ingestedAt: number): HealthKitStepSample | null {
  const startTs = parseTs(raw.startDate);
  const endTs = parseTs(raw.endDate);
  const value = asNumber(raw.value);
  if (startTs == null || endTs == null || value == null) return null;
  if (endTs < startTs) return null;
  // Plausible upper bound — even a marathon day is under 100k steps.
  // We clamp to keep one malformed sample from poisoning derived stats.
  const steps = clampInt(value, 0, 100_000);
  return {
    id: deriveSampleId('stepCount', raw),
    kind: 'stepCount',
    start_ts: startTs,
    end_ts: endTs,
    steps,
    source: 'healthkit',
    ingested_at: ingestedAt,
  };
}

export function normalizeHeartRateSample(raw: RawHealthSample, ingestedAt: number): HealthKitHeartRateSample | null {
  const startTs = parseTs(raw.startDate);
  const endTs = parseTs(raw.endDate);
  const value = asNumber(raw.value);
  if (startTs == null || endTs == null || value == null) return null;
  // Plausible BPM range; below ~25 or above ~250 is almost certainly
  // an artefact of the sensor (or a watch on a desk) — drop.
  if (value < 25 || value > 250) return null;
  return {
    id: deriveSampleId('heartRate', raw),
    kind: 'heartRate',
    start_ts: startTs,
    end_ts: endTs,
    bpm: Math.round(value),
    source: 'healthkit',
    ingested_at: ingestedAt,
  };
}

export function normalizeRestingHRSample(raw: RawHealthSample, ingestedAt: number): HealthKitRestingHRSample | null {
  // Same plausibility band as instantaneous HR — but resting HR samples
  // are typically once per day so we keep the same clamp.
  const startTs = parseTs(raw.startDate);
  const endTs = parseTs(raw.endDate);
  const value = asNumber(raw.value);
  if (startTs == null || endTs == null || value == null) return null;
  if (value < 25 || value > 200) return null;
  return {
    id: deriveSampleId('restingHeartRate', raw),
    kind: 'restingHeartRate',
    start_ts: startTs,
    end_ts: endTs,
    bpm: Math.round(value),
    source: 'healthkit',
    ingested_at: ingestedAt,
  };
}

export function normalizeHydrationSample(raw: RawHealthSample, ingestedAt: number): HealthKitHydrationSample | null {
  const startTs = parseTs(raw.startDate);
  const endTs = parseTs(raw.endDate);
  const value = asNumber(raw.value);
  if (startTs == null || endTs == null || value == null) return null;
  if (value < 0) return null;
  // Coerce to ml. HealthKit's dietary water type ships in mL by spec;
  // some plugins surface litres — if the unit string is 'L' we
  // multiply. The Capgo plugin reports mL but we defend against drift.
  const volMl = (raw.unit ?? '').toLowerCase() === 'l' ? value * 1000 : value;
  // Cap at 10L/day to prevent a stuck sensor from skewing daily totals.
  if (volMl > 10_000) return null;
  return {
    id: deriveSampleId('hydration', raw),
    kind: 'hydration',
    start_ts: startTs,
    end_ts: endTs,
    volume_ml: Math.round(volMl),
    source: 'healthkit',
    ingested_at: ingestedAt,
  };
}

/**
 * Sleep is a category sample — `value` is a string like 'asleep' /
 * 'remSleep' / 'awake'. iOS 16+ provides stage-detail (rem/deep/light);
 * older devices only emit 'asleep'/'awake'/'inBed'. We map both.
 */
export function normalizeSleepSample(raw: RawHealthSample, ingestedAt: number): HealthKitSleepSample | null {
  const startTs = parseTs(raw.startDate);
  const endTs = parseTs(raw.endDate);
  if (startTs == null || endTs == null) return null;
  if (endTs < startTs) return null;
  const stage = mapSleepStage(raw.value);
  if (!stage) return null;
  const durationMin = Math.max(0, Math.round((endTs - startTs) / 60_000));
  // Cap at 24h — sleep segments longer than a day are guaranteed bad data.
  if (durationMin > 24 * 60) return null;
  return {
    id: deriveSampleId('sleepAnalysis', raw),
    kind: 'sleepAnalysis',
    start_ts: startTs,
    end_ts: endTs,
    stage,
    duration_min: durationMin,
    source: 'healthkit',
    ingested_at: ingestedAt,
  };
}

function mapSleepStage(v: number | string | undefined): HealthKitSleepStage | null {
  if (typeof v !== 'string') {
    // Some plugin versions report numeric HKCategoryValueSleepAnalysis.
    // 0 = inBed, 1 = asleep (legacy), 2 = awake, 3 = core, 4 = deep, 5 = rem
    if (typeof v === 'number') {
      switch (v) {
        case 0: return 'inBed';
        case 1: return 'asleep';
        case 2: return 'awake';
        case 3: return 'lightSleep'; // "core" maps to light
        case 4: return 'deepSleep';
        case 5: return 'remSleep';
        default: return null;
      }
    }
    return null;
  }
  const s = v.toLowerCase();
  if (s === 'inbed') return 'inBed';
  if (s === 'awake') return 'awake';
  if (s === 'rem' || s === 'remsleep' || s === 'rem_sleep') return 'remSleep';
  if (s === 'deep' || s === 'deepsleep' || s === 'deep_sleep') return 'deepSleep';
  if (s === 'light' || s === 'lightsleep' || s === 'light_sleep' || s === 'core' || s === 'coresleep') return 'lightSleep';
  if (s === 'asleep' || s === 'asleepunspecified') return 'asleep';
  return null;
}

// ─── dispatcher ───────────────────────────────────────────────────────

/**
 * Normalize an array of raw samples for a single data type. Drops nulls.
 * Idempotent: re-running with the same input produces the same output
 * (same ids → orchestrator upsert is a no-op).
 */
export function normalizeSamples(
  kind: HealthKitDataType,
  rows: ReadonlyArray<RawHealthSample>,
  ingestedAt: number,
): HealthKitSample[] {
  const fn = pickNormalizer(kind);
  const out: HealthKitSample[] = [];
  for (const r of rows) {
    const n = fn(r, ingestedAt);
    if (n) out.push(n);
  }
  return out;
}

function pickNormalizer(
  kind: HealthKitDataType,
): (r: RawHealthSample, t: number) => HealthKitSample | null {
  switch (kind) {
    case 'stepCount':        return normalizeStepSample;
    case 'heartRate':        return normalizeHeartRateSample;
    case 'restingHeartRate': return normalizeRestingHRSample;
    case 'hydration':        return normalizeHydrationSample;
    case 'sleepAnalysis':    return normalizeSleepSample;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`@ollie/capacitor-healthkit: no normalizer for ${String(_exhaustive)}`);
    }
  }
}
