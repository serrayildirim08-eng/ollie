/**
 * SettingsScreen.ResearchSection · flow tests (Sprint B'' Item 1 · 2026-05-14)
 *
 * Covers the acceptance contract:
 *   - hydrates from getConsent() on mount
 *   - toggle ON  → setConsent({ research_optin: true })
 *   - toggle OFF → setConsent({ research_optin: false })
 *   - inline confirmation copy renders after each flip (not a modal)
 *
 * Mirrors apps/web/src/screens/onboarding/ConsentStep.test.tsx — same
 * react-dom-into-jsdom pattern, same vi.mock layout, same flush helper.
 *
 * We import ResearchSection directly (named export) instead of the full
 * SettingsScreen so the test doesn't transitively pull in '../store' →
 * '@ollie/store/react' which vitest can't resolve in this workspace shape.
 */

import { act } from 'react';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getConsentSpy: vi.fn(),
  setConsentSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@ollie/consent', () => ({
  getConsent: mocks.getConsentSpy,
  setConsent: mocks.setConsentSpy,
  configureConsent: vi.fn(),
  defaultConsent: vi.fn(() => ({
    necessary: true,
    marketing: false,
    research_optin: false,
    set_at: 0,
    v: 1,
  })),
  CONSENT_STORE_MODULE: 'consent',
  CONSENT_STORE_KEY: 'state',
  CONSENT_PIVOT_TS: Date.UTC(2026, 4, 14),
}));

// Stub the store + lib transitive imports so SettingsScreen.tsx loads
// without dragging in @ollie/store/react (which vitest can't resolve).
vi.mock('../store', () => ({
  store: { get: () => null, set: () => {}, subscribeKey: () => () => {} },
  useStoreSlice: <T,>(_mod: string, _key: string, def: T) => [def, () => {}],
}));

vi.mock('../lib/account-boot', () => ({
  getAccount: () => null,
  bootAccount: () => ({}),
}));

vi.mock('../lib/user-hash', () => ({
  readUserHash: () => null,
}));

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

vi.mock('../lib/invite', () => ({
  generateInvite: vi.fn(),
}));

const { getConsentSpy, setConsentSpy } = mocks;

// Now safe to import — all transitive deps mocked.
import { ResearchSection } from './SettingsScreen';

let container: HTMLDivElement;
let root: Root;

function mount(userId = 'user-test') {
  act(() => {
    root.render(<ResearchSection userId={userId} />);
  });
}

function getResearchToggle(): HTMLButtonElement {
  const el = container.querySelector('button[aria-label="research opt-in"]');
  if (!el) throw new Error('research toggle not found');
  return el as HTMLButtonElement;
}

function getConfirmLine(): HTMLElement | null {
  return container.querySelector('[data-testid="research-confirm"]');
}

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function flushFull(): Promise<void> {
  // Multiple ticks: one for getConsent() promise, one for the setState in
  // the .then() callback, one for the follow-up read after setConsent().
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  getConsentSpy.mockReset();
  setConsentSpy.mockReset();
  setConsentSpy.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('ResearchSection · hydration', () => {
  it('reads current state via getConsent on mount (opt-in OFF)', async () => {
    getConsentSpy.mockResolvedValue({
      necessary: true, marketing: false, research_optin: false, set_at: 1, v: 1,
    });
    mount();
    await flushFull();
    expect(getConsentSpy).toHaveBeenCalledWith('user-test');
    expect(getResearchToggle().getAttribute('aria-checked')).toBe('false');
  });

  it('reflects opt-in TRUE state from getConsent', async () => {
    getConsentSpy.mockResolvedValue({
      necessary: true, marketing: false, research_optin: true, set_at: 1, v: 1,
    });
    mount();
    await flushFull();
    expect(getResearchToggle().getAttribute('aria-checked')).toBe('true');
  });

  it('treats null (never-prompted sentinel) as OFF', async () => {
    getConsentSpy.mockResolvedValue({
      necessary: true, marketing: false, research_optin: null, set_at: 0, v: 1,
    });
    mount();
    await flushFull();
    expect(getResearchToggle().getAttribute('aria-checked')).toBe('false');
  });
});

describe('ResearchSection · toggle round-trip', () => {
  it('OFF → ON calls setConsent({ research_optin: true })', async () => {
    getConsentSpy
      .mockResolvedValueOnce({
        necessary: true, marketing: false, research_optin: false, set_at: 1, v: 1,
      })
      .mockResolvedValue({
        // post-write canonical read
        necessary: true, marketing: false, research_optin: true, set_at: 2, v: 1,
      });
    mount();
    await flushFull();

    click(getResearchToggle());
    await flushFull();

    expect(setConsentSpy).toHaveBeenCalledTimes(1);
    expect(setConsentSpy.mock.calls[0][0]).toBe('user-test');
    expect(setConsentSpy.mock.calls[0][1]).toMatchObject({
      research_optin: true,
    });
  });

  it('ON → OFF calls setConsent({ research_optin: false })', async () => {
    getConsentSpy
      .mockResolvedValueOnce({
        necessary: true, marketing: false, research_optin: true, set_at: 1, v: 1,
      })
      .mockResolvedValue({
        necessary: true, marketing: false, research_optin: false, set_at: 2, v: 1,
      });
    mount();
    await flushFull();

    click(getResearchToggle());
    await flushFull();

    expect(setConsentSpy.mock.calls[0][1]).toMatchObject({
      research_optin: false,
    });
  });
});

describe('ResearchSection · inline confirmation', () => {
  it('shows on-ack after OFF → ON flip', async () => {
    getConsentSpy
      .mockResolvedValueOnce({
        necessary: true, marketing: false, research_optin: false, set_at: 1, v: 1,
      })
      .mockResolvedValue({
        necessary: true, marketing: false, research_optin: true, set_at: 2, v: 1,
      });
    mount();
    await flushFull();
    click(getResearchToggle());
    await flushFull();

    const confirm = getConfirmLine();
    expect(confirm).not.toBeNull();
    expect(confirm!.textContent ?? '').toMatch(/on\. anonymized text/i);
  });

  it('shows off-ack after ON → OFF flip', async () => {
    getConsentSpy
      .mockResolvedValueOnce({
        necessary: true, marketing: false, research_optin: true, set_at: 1, v: 1,
      })
      .mockResolvedValue({
        necessary: true, marketing: false, research_optin: false, set_at: 2, v: 1,
      });
    mount();
    await flushFull();
    click(getResearchToggle());
    await flushFull();

    const confirm = getConfirmLine();
    expect(confirm).not.toBeNull();
    expect(confirm!.textContent ?? '').toMatch(/off\. no new text/i);
    // Verify NOT a modal — no role=dialog inside the rendered tree.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('no confirmation line is visible before any flip', async () => {
    getConsentSpy.mockResolvedValue({
      necessary: true, marketing: false, research_optin: false, set_at: 1, v: 1,
    });
    mount();
    await flushFull();
    expect(getConfirmLine()).toBeNull();
  });
});

describe('ResearchSection · pre-hydration safety', () => {
  it('the toggle does not call setConsent before getConsent resolves', () => {
    // Leave the spy unresolved so optin stays null.
    getConsentSpy.mockReturnValue(new Promise(() => {}));
    mount();
    // Don't flush — keep the component in its un-hydrated state.
    click(getResearchToggle());
    expect(setConsentSpy).not.toHaveBeenCalled();
  });
});
