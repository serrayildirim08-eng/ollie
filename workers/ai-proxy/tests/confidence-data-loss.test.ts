/**
 * AI data-loss fixes (audit #5).
 *
 * #5a — non-numeric confidence must NOT coerce to 0 (which demotes a
 *       possibly-correct route to dump_only). It becomes UNCERTAIN_CONFIDENCE
 *       (0.60 → needs-confirm), so the fragment is surfaced, not discarded.
 * #5b — when a low-confidence fragment IS demoted to dump_only, a `remindIn`
 *       hint must survive at the payload top level so injectScheduledAt still
 *       schedules the reminder.
 */

import { describe, it, expect } from 'vitest';
import { normalizeConfidence, UNCERTAIN_CONFIDENCE } from '../src/router/dump-classify';
import { applyConfidencePolicy } from '../src/router/dump-schema';
import { injectScheduledAt } from '../src/router/remindIn';

describe('#5a · normalizeConfidence', () => {
  it('passes through and clamps real numbers', () => {
    expect(normalizeConfidence(0.91)).toBe(0.91);
    expect(normalizeConfidence(1.5)).toBe(1);
    expect(normalizeConfidence(-0.2)).toBe(0);
  });

  it('maps non-numeric / NaN / missing to the uncertain floor — never 0', () => {
    expect(normalizeConfidence('high')).toBe(UNCERTAIN_CONFIDENCE);
    expect(normalizeConfidence(NaN)).toBe(UNCERTAIN_CONFIDENCE);
    expect(normalizeConfidence(undefined)).toBe(UNCERTAIN_CONFIDENCE);
    expect(normalizeConfidence(null)).toBe(UNCERTAIN_CONFIDENCE);
    expect(UNCERTAIN_CONFIDENCE).toBe(0.6);
  });

  it('uncertain confidence lands in the needs-confirm tier, not dump_only', () => {
    const tiered = applyConfidencePolicy('grocery', { item: 'milk' }, normalizeConfidence('garbage'));
    expect(tiered.module).toBe('grocery'); // NOT demoted
    expect(tiered.needsConfirm).toBe(true);
  });
});

describe('#5b · remindIn survives demotion', () => {
  it('a demoted (<0.60) fragment carrying remindIn keeps it at the top level', () => {
    const tiered = applyConfidencePolicy(
      'admin',
      { text: 'take meds', remindIn: { amount: 5, unit: 'min' } },
      0.4,
    );
    expect(tiered.module).toBe('dump_only');
    expect(tiered.payload.remindIn).toEqual({ amount: 5, unit: 'min' });
    // the original guess is still preserved for later inspection
    expect((tiered.payload.originalGuess as { module: string }).module).toBe('admin');
  });

  it('injectScheduledAt still schedules the reminder on the demoted payload', () => {
    const tiered = applyConfidencePolicy(
      'admin',
      { text: 'call mama', remindIn: { amount: 1, unit: 'min' } },
      0.3,
    );
    const status = injectScheduledAt(tiered.payload, Date.UTC(2026, 5, 9, 12, 0, 0));
    expect(status.status).toBe('injected');
    expect(typeof (tiered.payload.remindIn as { scheduledAtMs?: number }).scheduledAtMs).toBe('number');
  });

  it('demotion without remindIn does not invent one', () => {
    const tiered = applyConfidencePolicy('finance', { amount: 5 }, 0.2);
    expect(tiered.module).toBe('dump_only');
    expect('remindIn' in tiered.payload).toBe(false);
  });
});
