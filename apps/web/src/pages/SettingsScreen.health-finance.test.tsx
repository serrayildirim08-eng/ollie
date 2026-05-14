/**
 * SettingsScreen · HealthSection + FinanceSection · behavioral tests
 *
 * Covers:
 *   HealthSection:
 *     1. toggle defaults OFF (shared.settings.birth_control_enabled = false)
 *     2. clicking toggle writes true to store
 *     3. clicking again writes false
 *
 *   FinanceSection:
 *     4. self-employed toggle defaults OFF (finance.taxProfile absent)
 *     5. clicking toggle writes selfEmployed: true to store
 *     6. jurisdiction sub-radio hidden when selfEmployed is false
 *     7. jurisdiction sub-radio visible when selfEmployed is true
 *     8. clicking a jurisdiction button writes to taxProfile.calculator.kind
 *     9. default jurisdiction is 'us'
 *
 *   Cross-module gate (CycleModule pill section):
 *    10. pill section hidden when shared.settings.birth_control_enabled = false
 *    11. pill section visible when shared.settings.birth_control_enabled = true
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── store mock ───────────────────────────────────────────────────────────────

const storeData = new Map<string, unknown>();

vi.mock('../store', () => ({
  store: {
    set: vi.fn((mod: string, key: string, value: unknown) => {
      storeData.set(`${mod}:${key}`, value);
    }),
    get: vi.fn((mod: string, key: string, fallback: unknown) => {
      const k = `${mod}:${key}`;
      return storeData.has(k) ? storeData.get(k) : fallback;
    }),
    subscribe: vi.fn(() => () => {}),
    subscribeKey: vi.fn(() => () => {}),
  },
  useStoreSlice: vi.fn(
    <T,>(mod: string, key: string, defaultValue: T): [T, (v: T) => void] => {
      const k = `${mod}:${key}`;
      const val = (storeData.has(k) ? storeData.get(k) : defaultValue) as T;
      const setter = (v: T) => storeData.set(k, v);
      return [val, setter];
    },
  ),
}));

// ─── transitive dep stubs ─────────────────────────────────────────────────────

vi.mock('@ollie/consent', () => ({
  getConsent: vi.fn().mockResolvedValue({ necessary: true, marketing: true, research_optin: false, set_at: 0, v: 1 }),
  setConsent: vi.fn().mockResolvedValue(undefined),
  configureConsent: vi.fn(),
  defaultConsent: vi.fn(() => ({ necessary: true, marketing: false, research_optin: false, set_at: 0, v: 1 })),
  CONSENT_STORE_MODULE: 'consent',
  CONSENT_STORE_KEY: 'state',
  CONSENT_PIVOT_TS: 0,
}));

vi.mock('@ollie/events', () => ({ emit: vi.fn() }));

vi.mock('../lib/account-boot', () => ({
  getAccount: () => null,
  bootAccount: () => ({}),
}));

vi.mock('../lib/user-hash', () => ({ readUserHash: () => null }));

vi.mock('../lib/device', () => ({
  getAppVersion: () => 'test',
  getDeviceId: () => 'test-device',
}));

vi.mock('@ollie/backup', () => ({
  exportBackup: vi.fn(),
  envelopeToFileBytes: vi.fn(),
  defaultFilename: vi.fn(),
  importBackup: vi.fn(),
}));

vi.mock('../lib/invite', () => ({ generateInvite: vi.fn() }));

vi.mock('../lib/encryption-boot', () => ({
  hasSessionPassphrase: () => false,
  setSessionPassphrase: vi.fn(),
  clearSessionPassphrase: vi.fn(),
}));

// ─── imports (after mocks) ────────────────────────────────────────────────────

import { HealthSection, FinanceSection } from './SettingsScreen';

// ─── helpers ─────────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  storeData.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

// ─── HealthSection ────────────────────────────────────────────────────────────

describe('HealthSection · birth control toggle', () => {
  it('defaults OFF (no store key set)', () => {
    act(() => { root.render(<HealthSection />); });
    const toggle = container.querySelector('button[aria-label="track birth control"]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('clicking toggle writes true to shared.settings.birth_control_enabled', () => {
    act(() => { root.render(<HealthSection />); });
    const toggle = container.querySelector('button[aria-label="track birth control"]') as HTMLButtonElement;
    click(toggle);
    expect(storeData.get('shared:settings.birth_control_enabled')).toBe(true);
  });

  it('clicking again writes false', () => {
    storeData.set('shared:settings.birth_control_enabled', true);
    act(() => { root.render(<HealthSection />); });
    const toggle = container.querySelector('button[aria-label="track birth control"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    click(toggle);
    expect(storeData.get('shared:settings.birth_control_enabled')).toBe(false);
  });
});

// ─── FinanceSection ───────────────────────────────────────────────────────────

describe('FinanceSection · self-employed toggle', () => {
  it('defaults OFF (no taxProfile in store)', () => {
    act(() => { root.render(<FinanceSection />); });
    const toggle = container.querySelector('button[aria-label="self-employed"]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('clicking toggle writes selfEmployed: true', () => {
    act(() => { root.render(<FinanceSection />); });
    const toggle = container.querySelector('button[aria-label="self-employed"]') as HTMLButtonElement;
    click(toggle);
    const stored = storeData.get('finance:taxProfile') as { selfEmployed: boolean };
    expect(stored?.selfEmployed).toBe(true);
  });

  it('clicking again writes selfEmployed: false', () => {
    storeData.set('finance:taxProfile', { selfEmployed: true });
    act(() => { root.render(<FinanceSection />); });
    const toggle = container.querySelector('button[aria-label="self-employed"]') as HTMLButtonElement;
    click(toggle);
    const stored = storeData.get('finance:taxProfile') as { selfEmployed: boolean };
    expect(stored?.selfEmployed).toBe(false);
  });
});

describe('FinanceSection · jurisdiction sub-radio', () => {
  it('hidden when self-employed is false', () => {
    act(() => { root.render(<FinanceSection />); });
    const radioGroup = container.querySelector('[aria-label="tax jurisdiction"]');
    expect(radioGroup).toBeNull();
  });

  it('visible when self-employed is true', () => {
    storeData.set('finance:taxProfile', { selfEmployed: true });
    act(() => { root.render(<FinanceSection />); });
    const radioGroup = container.querySelector('[aria-label="tax jurisdiction"]');
    expect(radioGroup).not.toBeNull();
  });

  it('defaults to us jurisdiction', () => {
    storeData.set('finance:taxProfile', { selfEmployed: true });
    act(() => { root.render(<FinanceSection />); });
    const usBtn = container.querySelector('button[role="radio"][aria-checked="true"]') as HTMLButtonElement;
    expect(usBtn?.textContent?.trim().toLowerCase()).toBe('us');
  });

  it('clicking uk writes calculator.kind: uk', () => {
    storeData.set('finance:taxProfile', { selfEmployed: true });
    act(() => { root.render(<FinanceSection />); });
    const radios = Array.from(container.querySelectorAll('button[role="radio"]')) as HTMLButtonElement[];
    const ukBtn = radios.find(b => b.textContent?.trim().toLowerCase() === 'uk');
    expect(ukBtn).not.toBeNull();
    click(ukBtn!);
    const stored = storeData.get('finance:taxProfile') as { selfEmployed: boolean; calculator: { kind: string } };
    expect(stored?.calculator?.kind).toBe('uk');
  });
});

// NOTE: CycleModule pill section gate (birth_control_enabled → shows/hides pill log)
// is tested in CycleModule.pill.test.tsx which has the full logic mock setup.
// Tests 10–11 from the spec are covered there (birth_control_enabled true/false).
