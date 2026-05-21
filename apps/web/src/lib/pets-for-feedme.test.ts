/**
 * pets-for-feedme · helper-only test.
 *
 * Covers:
 *   - empty / undefined store falls back to the hardcoded household
 *   - archived pets are filtered
 *   - "for me" is always the first option
 *   - id is stable across calls
 */

import { describe, it, expect } from 'vitest';
import {
  buildFeedTargetOptions,
  _HARDCODED_PETS_FOR_TEST,
} from './pets-for-feedme';

describe('buildFeedTargetOptions', () => {
  it('always prepends the "for me" option', () => {
    const opts = buildFeedTargetOptions([]);
    expect(opts[0].id).toBe('feed:user');
    expect(opts[0].label).toBe('for me');
    expect(opts[0].mode).toBe('user');
  });

  it('falls back to the hardcoded household when no pets registered', () => {
    const opts = buildFeedTargetOptions([]);
    const petLabels = opts.filter((o) => o.mode === 'pet').map((o) => o.label);
    for (const name of _HARDCODED_PETS_FOR_TEST) {
      expect(petLabels).toContain(`for ${name}`);
    }
  });

  it('uses the live pets when present', () => {
    const opts = buildFeedTargetOptions([
      { name: 'Tontin', archived: false },
      { name: 'Pinpon', archived: false },
    ]);
    expect(opts.find((o) => o.label === 'for tontin')).toBeTruthy();
    expect(opts.find((o) => o.label === 'for pinpon')).toBeTruthy();
    // the hardcoded "the pigs" should NOT leak when the store has live pets
    expect(opts.find((o) => o.label === 'for the pigs')).toBeUndefined();
  });

  it('skips archived pets', () => {
    const opts = buildFeedTargetOptions([
      { name: 'Tontin', archived: false },
      { name: 'Ghost', archived: true },
    ]);
    expect(opts.find((o) => o.label === 'for tontin')).toBeTruthy();
    expect(opts.find((o) => o.label === 'for ghost')).toBeUndefined();
  });

  it('uses nickname when present', () => {
    const opts = buildFeedTargetOptions([
      { name: 'Antoinette', nickname: 'tontin' },
    ]);
    expect(opts.find((o) => o.label === 'for tontin')).toBeTruthy();
    expect(opts.find((o) => o.label === 'for antoinette')).toBeUndefined();
  });

  it('produces stable ids', () => {
    const a = buildFeedTargetOptions([{ name: 'Tontin' }]);
    const b = buildFeedTargetOptions([{ name: 'Tontin' }]);
    expect(a.map((o) => o.id)).toEqual(b.map((o) => o.id));
  });
});
