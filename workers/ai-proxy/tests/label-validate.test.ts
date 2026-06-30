/**
 * Audit M3 — adhd_pattern_tag was only type-checked (`typeof === 'string'`),
 * not validated against its enum, so a hallucinated tag would be written to
 * the research corpus. validateLabel now checks membership like the other
 * label fields.
 */

import { describe, it, expect } from 'vitest';
import { validateLabel } from '../src/label';

const base = {
  mood_signal: 'neutral',
  content_type: 'reflection',
  urgency_tier: 'none',
  adhd_pattern_tag: 'none',
  sector_relevance: 'other',
  confidence: 0.5,
};

describe('audit M3 · validateLabel adhd_pattern_tag', () => {
  it('accepts a valid enum tag', () => {
    const r = validateLabel({ ...base, adhd_pattern_tag: 'rsd-spiral' });
    expect(r.ok).toBe(true);
  });

  it('rejects a hallucinated tag with the adhd_pattern_tag reason', () => {
    const r = validateLabel({ ...base, adhd_pattern_tag: 'made-up-tag' });
    expect(r).toEqual({ ok: false, reason: 'adhd_pattern_tag' });
  });

  it('rejects a non-string tag', () => {
    const r = validateLabel({ ...base, adhd_pattern_tag: 42 });
    expect(r).toMatchObject({ ok: false, reason: 'adhd_pattern_tag' });
  });

  it('still accepts a fully valid label', () => {
    const r = validateLabel(base);
    expect(r.ok).toBe(true);
  });
});
