/**
 * @ollie/events · SHAPES
 *
 * Runtime payload validation for the highest-impact events. Validator runs
 * on every emit; on mismatch (or null/undefined payload for an event with
 * a declared shape) it console.warns and DROPS the emit — subscribers
 * never see a malformed event.
 *
 * Non-strict by design: never throws. Production app can't crash mid-route
 * on a malformed event.
 *
 * Type tokens:  'string' | 'number' | 'boolean' | 'array' | 'object'
 * Suffix '?' marks an optional key (skipped when missing or null).
 */

type TypeToken = 'string' | 'number' | 'boolean' | 'array' | 'object';
type SimpleShape = Record<string, TypeToken>;
type OneOfShape = { oneOf: SimpleShape[] };
type ShapeSpec = SimpleShape | OneOfShape;

export const SHAPES: Record<string, ShapeSpec> = {
  'void:braindump:submitted': {
    oneOf: [
      { v: 'number', items: 'array', raw: 'string', ts: 'number', idempotency_key: 'string', route_path: 'string' },
      { id: 'string', text: 'string', ts: 'number' },
    ],
  },
  'void:dump:receipt':         { idempotency_key: 'string', modules: 'array', ts: 'number', raw: 'string', 'route_path?': 'string' },
  'braindump:routed':          { route_path: 'string', item_count: 'number', modules: 'array', idempotency_key: 'string', ts: 'number' },
  'braindump:routing_failed':  { raw: 'string', reason: 'string', ts: 'number' },
  'void:inventory:refill':     { productType: 'string', quantity: 'number', source: 'string' },
  'void:cycle:started':        { ts: 'number', source: 'string' },
  'void:flag:raised':          { key: 'string', severity: 'string', title: 'string', evidence: 'array' },
  'void:prediction:updated':   { confidence: 'number', explanation: 'string' },
  'pets:care_logged':          { pet_id: 'string', task: 'string', source: 'string', occurred_at: 'number' },
  'void:reminder:scheduled':   { id: 'string', fireAt: 'number', message: 'string', module: 'string', source: 'string' },
  'void:crisis:detected':      { text: 'string', matchedLine: 'string', ts: 'number' },

  // Sprint 3 / D1 burhan
  'burhan:element_added':      { id: 'string', type: 'string', source_module: 'string', source_event_id: 'string', ts: 'number' },

  // Sprint 3 / D3 finance pattern alerts
  'finance:subscription_detected':           { pattern_id: 'string', merchant: 'string', amount: 'number', cadence: 'string', occurrence_count: 'number', ts: 'number' },
  'finance:adhd_tax_updated':                { total_30d: 'number', count_30d: 'number', ts: 'number' },
  'finance:cycle_spending_pattern_detected': { luteal_ratio: 'number', cycle_count: 'number', ts: 'number' },
  'finance:bill_due_predicted':              { pattern_id: 'string', merchant: 'string', amount: 'number', due_at: 'number', days_until: 'number', ts: 'number' },

  // Sprint 3 / D2 cross-module wires
  'cycle:period_logged':       { ts: 'number', source: 'string' },

  // push notification events (money module gap closure)
  'finance:subscription_stale':    { pattern_id: 'string', merchant: 'string', amount: 'number', days_since: 'number', ts: 'number' },
  'finance:savings_milestone':     { goal_id: 'string', goal_name: 'string', current: 'number', target: 'number', milestone_pct: 'number', ts: 'number' },
  'finance:impulse_pause_summary': { count: 'number', total: 'number', month_start: 'number', ts: 'number' },
  'finance:anomaly_detected':      { anomaly_id: 'string', 'merchant?': 'string', amount: 'number', 'median?': 'number', ts: 'number' },

  // Sprint 6 · impulse pause flow (FinanceModule)
  'finance:impulse_pause_started':  { id: 'string', amount: 'number', merchant: 'string', category: 'string', ts: 'number', expires_at: 'number' },
  'finance:impulse_pause_resolved': { id: 'string', amount: 'number', merchant: 'string', outcome: 'string', ts: 'number' },

  // habits completion → garden
  'habits:completed': { habitId: 'string', category: 'string', habitName: 'string', ts: 'number' },

  // body weekly review
  'body:weekly_review': { ts: 'number', weekStartTs: 'number', weekEndTs: 'number', copy: 'string', summary: 'object' },

  // sleep · wind-down checklist (feature 12)
  'sleep:wind_down_started':   { ts: 'number' },
  'sleep:wind_down_completed': { ts: 'number', durationMs: 'number', itemsCompleted: 'number' },
  'sleep:wind_down_skipped':   { ts: 'number', itemsCompleted: 'number' },

  // body notifications · 11 push events (Sprint body-v2 wiring)
  'cycle:period_approaching':    { predictedTs: 'number', daysUntil: 'number', ts: 'number' },
  'cycle:period_imminent':       { predictedTs: 'number', ts: 'number' },
  'cycle:period_late':           { predictedTs: 'number', daysLate: 'number', ts: 'number' },
  'cycle:luteal_starting':       { lutealStartTs: 'number', daysUntil: 'number', ts: 'number' },
  'cycle:ovulation_imminent':    { ovulationTs: 'number', ts: 'number' },
  'cycle:pill_missed':           { missedDate: 'string', ts: 'number' },
  'sleep:wind_down_window':      { bedtimeTs: 'number', ts: 'number' },
  'sleep:debt_accumulated':      { debtHours: 'number', targetHours: 'number', idealBedtimeHHMM: 'string', ts: 'number' },
  'body:supplement_due':         { supplementId: 'string', supplementName: 'string', reminderHHMM: 'string', ts: 'number' },
  'body:posture_nudge':          { hourBucket: 'number', ts: 'number' },
  'habits:morning_check':        { 'firstHabitName?': 'string', totalCount: 'number', ts: 'number' },

  // body · caffeine→sleep correlator (Drake 2013, 6h half-life). threshold
  // may be null when correlation magnitude < 0.3; declared optional here
  // so the validator accepts null without dropping the emit.
  'pattern:caffeine_sleep_detected': {
    correlation: 'number',
    'threshold?': 'object',
    sampleSize: 'number',
    copy: 'string',
    ts: 'number',
  },

  // body-correlation registry — emitted from the daily registry pass for
  // any correlator whose copy is non-empty. correlation_name is a stable
  // enum from @ollie/logic/body/correlations.
  'pattern:detected': {
    correlation_name: 'string',
    correlation: 'number',
    sample_size: 'number',
    copy: 'string',
    ts: 'number',
  },
};

export type ValidationResult = { ok: true } | { ok: false; reason: string };

function typeOk(val: unknown, type: string): boolean {
  if (type === 'array') return Array.isArray(val);
  if (type === 'object') return val != null && typeof val === 'object' && !Array.isArray(val);
  return typeof val === type;
}

function checkShape(payload: unknown, shape: SimpleShape): string | null {
  if (payload == null || typeof payload !== 'object') return 'payload not an object';
  const p = payload as Record<string, unknown>;
  for (const rawKey in shape) {
    const optional = rawKey.endsWith('?');
    const key = optional ? rawKey.slice(0, -1) : rawKey;
    const expected = shape[rawKey];
    if (!(key in p) || p[key] === undefined || p[key] === null) {
      if (optional) continue;
      return `missing "${key}" (expected ${expected})`;
    }
    if (!typeOk(p[key], expected)) {
      const actual = Array.isArray(p[key]) ? 'array' : typeof p[key];
      return `"${key}" has type ${actual}, expected ${expected}`;
    }
  }
  return null;
}

function isOneOfShape(spec: ShapeSpec): spec is OneOfShape {
  return Array.isArray((spec as OneOfShape).oneOf);
}

export function validatePayload(name: string, payload: unknown): ValidationResult {
  const spec = SHAPES[name];
  if (!spec) return { ok: true };
  if (isOneOfShape(spec)) {
    const errors: string[] = [];
    for (const shape of spec.oneOf) {
      const err = checkShape(payload, shape);
      if (!err) return { ok: true };
      errors.push(err);
    }
    return { ok: false, reason: 'no oneOf shape matched: [' + errors.join(' | ') + ']' };
  }
  const err = checkShape(payload, spec);
  return err ? { ok: false, reason: err } : { ok: true };
}
