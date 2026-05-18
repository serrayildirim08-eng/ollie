/**
 * ExportPanel · unit tests
 *
 * Covers:
 *   - passphrase modal renders + blocks short input
 *   - clicking annual report → modal opens → enter passphrase →
 *     render PDF → encrypt → download (no throws, anchor created)
 *   - cancel from modal closes it without firing the download
 *   - records prop override propagates into the report
 *
 * Crypto is the real @ollie/crypto path (jsdom has WebCrypto). The
 * jsPDF factory is injected as a fake so this file does not require
 * jspdf to be installed.
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Mock the app store — ExportPanel imports `../../store` for the
// records slice, but we always pass `records` as a prop in tests.
// The store module pulls in @ollie/store/react which isn't aliased in
// vitest config, so we stub it out entirely.
vi.mock('../../store', () => ({
  useStoreSlice: <T,>(_mod: string, _key: string, defaultValue: T) =>
    [defaultValue, () => {}] as [T, (v: T) => void],
}));

import { ExportPanel } from './ExportPanel';
import type { FinanceRecord } from '@ollie/logic/finance';
import type { JsPDFFactory, JsPDFLike } from './renderADHDTaxReportPDF';

// ─── fake jsPDF factory (mirrors the renderer test) ───────────────────────

function makeFakeFactory(): JsPDFFactory {
  return () => {
    const doc = {
      addPage() {},
      setFont() {},
      setFontSize() {},
      setTextColor() {},
      setDrawColor() {},
      setFillColor() {},
      setLineWidth() {},
      text() {},
      line() {},
      rect() {},
      output(type: 'blob' | 'arraybuffer') {
        const PDF_HEADER = '%PDF-1.4\n';
        const bytes = new Uint8Array(PDF_HEADER.length);
        for (let i = 0; i < PDF_HEADER.length; i++) bytes[i] = PDF_HEADER.charCodeAt(i);
        if (type === 'blob') return new Blob([bytes], { type: 'application/pdf' });
        return bytes.buffer;
      },
      internal: {
        pageSize: { getWidth: () => 612, getHeight: () => 792 },
      },
    } as unknown as JsPDFLike;
    return doc;
  };
}

// ─── DOM scaffolding ─────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;
let urlObjects: string[];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  urlObjects = [];

  // Stub createObjectURL + revokeObjectURL — jsdom does not implement them.
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      const url = `blob:fake-${urlObjects.length}-${blob.size}`;
      urlObjects.push(url);
      return url;
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: () => {},
  });
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

// ─── fixtures ────────────────────────────────────────────────────────────

const PASSPHRASE_OK = 'correct-horse-battery-staple-2025';

function recs(): FinanceRecord[] {
  return [
    {
      event_date: '2025-01-12',
      amount: 80,
      currency: 'USD',
      merchant: 'late fee',
      merchant_normalized: 'late fee',
      direction: 'out',
      category: 'bills',
      is_adhd_tax: true,
      adhd_tax_type: 'late_fee',
    },
    {
      event_date: '2025-07-04',
      amount: 4500,
      currency: 'USD',
      merchant: 'client a',
      merchant_normalized: 'client a',
      direction: 'in',
    },
  ];
}

function mount(props: Partial<React.ComponentProps<typeof ExportPanel>> = {}) {
  const merged: React.ComponentProps<typeof ExportPanel> = {
    records: recs(),
    jsPDFFactory: makeFakeFactory(),
    yearOverride: 2025,
    ...props,
  };
  act(() => {
    root.render(<ExportPanel {...merged} />);
  });
}

function queryByAriaLabel(name: string): HTMLElement | null {
  return container.querySelector(`[aria-label="${name}"]`);
}

function queryAllByAriaLabel(name: string): HTMLElement[] {
  return Array.from(container.querySelectorAll(`[aria-label="${name}"]`));
}

// React 18 patches the native value setter to ignore plain assignments
// that come from outside its synthetic event system. To trigger an
// onChange in tests, set the value via the original prototype setter
// then dispatch the input event.
function typeInto(input: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('ExportPanel · render', () => {
  it('renders both export buttons with record count', () => {
    mount();
    const csv = queryByAriaLabel('export csv');
    const annual = queryByAriaLabel('export annual adhd-tax report');
    expect(csv).not.toBeNull();
    expect(annual).not.toBeNull();
    expect(csv!.textContent ?? '').toContain('2 records');
  });
});

describe('ExportPanel · passphrase modal', () => {
  it('opens the modal when annual report is clicked', () => {
    mount();
    expect(queryAllByAriaLabel('passphrase to encrypt this export')).toHaveLength(0);
    const btn = queryByAriaLabel('export annual adhd-tax report')!;
    act(() => { btn.click(); });
    expect(queryAllByAriaLabel('passphrase to encrypt this export')).toHaveLength(1);
  });

  it('keeps the encrypt button disabled until passphrase meets 16-char minimum', () => {
    mount();
    act(() => { queryByAriaLabel('export annual adhd-tax report')!.click(); });

    const submit = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => /encrypt/i.test(b.textContent ?? ''));
    expect(submit).toBeDefined();
    expect(submit!.disabled).toBe(true);

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="passphrase"]',
    )!;
    typeInto(input, 'short');
    expect(submit!.disabled).toBe(true);

    typeInto(input, PASSPHRASE_OK);
    expect(submit!.disabled).toBe(false);
  });

  it('closes without firing the download when cancel is clicked', () => {
    mount();
    act(() => { queryByAriaLabel('export annual adhd-tax report')!.click(); });

    const cancel = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => (b.textContent ?? '').trim() === 'cancel');
    expect(cancel).toBeDefined();
    act(() => { cancel!.click(); });
    expect(queryAllByAriaLabel('passphrase to encrypt this export')).toHaveLength(0);
    expect(urlObjects).toHaveLength(0);
  });
});

describe('ExportPanel · pdf export flow', () => {
  it('renders PDF + encrypts + triggers a download blob', async () => {
    mount();
    act(() => { queryByAriaLabel('export annual adhd-tax report')!.click(); });

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="passphrase"]',
    )!;
    typeInto(input, PASSPHRASE_OK);

    const submit = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button'),
    ).find((b) => /encrypt/i.test(b.textContent ?? ''))!;

    await act(async () => {
      submit.click();
    });
    // PBKDF2 (100k iterations) + AES-GCM encrypt completes on a real
    // crypto.subtle path; flush macrotasks until React commits the
    // success message or we hit the budget.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      if (container.querySelector('[role="status"]')) break;
    }

    // Status message should reflect a successful encryption.
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent ?? '').toMatch(/exported 2025 report/i);
    // At least one blob was created for the download anchor.
    expect(urlObjects.length).toBeGreaterThanOrEqual(1);
  });
});
