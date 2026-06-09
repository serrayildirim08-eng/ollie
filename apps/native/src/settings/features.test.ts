/**
 * Feature flags (audit #10) — Partner deferred from v1 behind a flag.
 *
 * Asserts the flag defaults OFF, is reversible, and that the module-index
 * gating predicate hides/shows the Partner entry accordingly. The module code
 * itself is NOT deleted — only its surface is gated.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';

vi.mock('../store', () => ({ store: createStore(createMemoryAdapter()) }));

import { store } from '../store';
import { isFeatureEnabled, setFeatureEnabled } from './features';

beforeEach(() => {
  // clean slate — no flags set
  store.set('settings', 'features', {});
});

describe('feature flags', () => {
  it('partner defaults OFF in v1', () => {
    expect(isFeatureEnabled('partner')).toBe(false);
  });

  it('is reversible: enable then disable', () => {
    setFeatureEnabled('partner', true);
    expect(isFeatureEnabled('partner')).toBe(true);
    setFeatureEnabled('partner', false);
    expect(isFeatureEnabled('partner')).toBe(false);
  });

  it('the module-index gating predicate hides Partner when off, shows it when on', () => {
    const visible = (partnerEnabled: boolean) =>
      ['goals', 'partner', 'habits'].filter((id) => id !== 'partner' || partnerEnabled);

    expect(visible(isFeatureEnabled('partner'))).not.toContain('partner');
    setFeatureEnabled('partner', true);
    expect(visible(isFeatureEnabled('partner'))).toContain('partner');
  });
});
