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
