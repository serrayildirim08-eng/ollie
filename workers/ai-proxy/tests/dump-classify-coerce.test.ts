/**
 * Audit M2 — the model-supplied module was returned unvalidated, so a
 * hallucinated module name flowed into the Vectorize cache + dump_inbox and
 * failed silently at dispatch. coerceModule routes unknown modules to
 * `dump_only` so the fragment is preserved as a raw dump.
 */

import { describe, it, expect } from 'vitest';
import { coerceModule } from '../src/router/dump-classify';

describe('audit M2 · coerceModule', () => {
  it('passes through a valid module', () => {
    expect(coerceModule('grocery')).toBe('grocery');
    expect(coerceModule('cycle')).toBe('cycle');
  });

  it('coerces a hallucinated module to dump_only', () => {
    expect(coerceModule('groceries')).toBe('dump_only');
    expect(coerceModule('totally-made-up')).toBe('dump_only');
  });

  it('coerces a non-string to dump_only', () => {
    expect(coerceModule(undefined)).toBe('dump_only');
    expect(coerceModule(42)).toBe('dump_only');
    expect(coerceModule(null)).toBe('dump_only');
  });
});
