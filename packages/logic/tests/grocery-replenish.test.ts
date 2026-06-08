import { describe, it, expect } from 'vitest';
import { detectReplenishNeeded, detectPatterns } from '../src/grocery';
import type { GroceryHistory } from '../src/grocery';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function hist(partial: Partial<GroceryHistory>): GroceryHistory {
  return { now: NOW, pantry: [], items: [], ...partial };
}

describe('detectReplenishNeeded (the milk noticing)', () => {
  it('fires when a pantry item is past its predicted run-out and unarchived', () => {
    const sig = detectReplenishNeeded(
      hist({
        pantry: [
          { name: 'milk', normalizedName: 'milk', predictedOutAtMs: NOW - 2 * DAY, archived: false },
        ],
      }),
    );
    expect(sig).not.toBeNull();
    expect(sig!.pattern).toBe('grocery-replenish-needed');
    expect(sig!.items[0]?.name).toBe('milk');
    expect(sig!.copy).toMatch(/milk/i);
    expect(sig!.copy).toMatch(/want it back on the list\?/);
    // one calm sentence only
    expect(sig!.copy.split('.').filter(Boolean).length).toBeLessThanOrEqual(1);
  });

  it('does NOT fire when the prediction is still in the future', () => {
    const sig = detectReplenishNeeded(
      hist({
        pantry: [{ name: 'milk', predictedOutAtMs: NOW + 3 * DAY }],
      }),
    );
    expect(sig).toBeNull();
  });

  it('does NOT fire when the item is archived (already used up)', () => {
    const sig = detectReplenishNeeded(
      hist({
        pantry: [{ name: 'milk', predictedOutAtMs: NOW - 5 * DAY, archived: true }],
      }),
    );
    expect(sig).toBeNull();
  });

  it('does NOT fire when the item is already on the shopping list', () => {
    const sig = detectReplenishNeeded(
      hist({
        pantry: [{ name: 'milk', normalizedName: 'milk', predictedOutAtMs: NOW - 5 * DAY }],
        items: [{ name: 'milk', normalizedName: 'milk', checked: false }],
      }),
    );
    expect(sig).toBeNull();
  });

  it('does NOT fire when there is no prediction yet', () => {
    const sig = detectReplenishNeeded(
      hist({ pantry: [{ name: 'salt', predictedOutAtMs: null }] }),
    );
    expect(sig).toBeNull();
  });

  it('still fires when a BOUGHT (checked) version exists in items', () => {
    // checked items are past purchases, not still-to-buy — must not suppress.
    const sig = detectReplenishNeeded(
      hist({
        pantry: [{ name: 'milk', normalizedName: 'milk', predictedOutAtMs: NOW - DAY }],
        items: [{ name: 'milk', normalizedName: 'milk', checked: true }],
      }),
    );
    expect(sig).not.toBeNull();
  });

  it('aggregates multiple run-out items into one gentle sentence, most-overdue first', () => {
    const sig = detectReplenishNeeded(
      hist({
        pantry: [
          { name: 'milk', normalizedName: 'milk', predictedOutAtMs: NOW - 1 * DAY },
          { name: 'eggs', normalizedName: 'eggs', predictedOutAtMs: NOW - 6 * DAY },
        ],
      }),
    );
    expect(sig).not.toBeNull();
    expect(sig!.sample_n).toBe(2);
    expect(sig!.confidence).toBe('high');
    // eggs is more overdue → headlines
    expect(sig!.items[0]?.name).toBe('eggs');
    expect(sig!.copy).toMatch(/want them back on the list\?/);
  });

  it('is included in the detectPatterns batch and is distinct from expiration-drift', () => {
    const patterns = detectPatterns(
      hist({
        pantry: [{ name: 'milk', normalizedName: 'milk', predictedOutAtMs: NOW - 2 * DAY }],
      }),
    );
    const ids = patterns.map((p) => p.pattern);
    expect(ids).toContain('grocery-replenish-needed');
    expect(ids).not.toContain('grocery-expiration-drift');
  });
});
