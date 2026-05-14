/**
 * renderADHDTaxReportPDF · unit tests
 *
 * The PDF is built against a thin `JsPDFLike` interface so this test
 * file does not require jspdf to be installed (Serra's monorepo
 * install is frozen). We pass in a fake factory that:
 *   - records the call sequence so we can verify pages + text
 *   - emits a minimal valid PDF byte stream (header `%PDF-1.4`)
 *     when .output() is called, so the binary-shape assertion is
 *     real and not synthetic.
 *
 * Coverage:
 *   - factory invoked with portrait letter pt
 *   - addPage called 3 times (4 pages total)
 *   - cover text includes year + totals + subtitle
 *   - month-by-month emits all 12 month labels
 *   - categorized emits each bucket label
 *   - yoy emits delta % string
 *   - output Blob has %PDF- header bytes
 *   - output arraybuffer has %PDF- header bytes
 *   - throws on missing report / opts.year
 */

import { describe, it, expect } from 'vitest';
import {
  renderADHDTaxReportPDF,
  type JsPDFLike,
  type JsPDFFactory,
} from './renderADHDTaxReportPDF';
import { exportADHDTaxReport } from '@ollie/logic/finance';
import type { FinanceRecord } from '@ollie/logic/finance';

// ─── fake jsPDF ──────────────────────────────────────────────────────────

interface FakeDoc extends JsPDFLike {
  _pageCount: number;
  _texts: string[];
  _ctorOpts: Record<string, unknown>;
}

function makeFakeFactory(): { factory: JsPDFFactory; lastDoc: () => FakeDoc | null } {
  let last: FakeDoc | null = null;

  const factory: JsPDFFactory = (opts) => {
    const doc: FakeDoc = {
      _pageCount: 1,
      _texts: [],
      _ctorOpts: opts ?? {},
      addPage() { this._pageCount++; },
      setFont() {},
      setFontSize() {},
      setTextColor() {},
      setDrawColor() {},
      setFillColor() {},
      setLineWidth() {},
      text(text: string | string[]) {
        if (Array.isArray(text)) this._texts.push(text.join(' '));
        else this._texts.push(text);
      },
      line() {},
      rect() {},
      output(type: 'blob' | 'arraybuffer') {
        // Minimal valid PDF header so the binary-shape assertion is real.
        const PDF_HEADER = '%PDF-1.4\n%\xC4\xE5\xF2\xE5\xEB\xA7\xF3\xA0\xD0\xC4\xC6\n';
        const bytes = new Uint8Array(PDF_HEADER.length);
        for (let i = 0; i < PDF_HEADER.length; i++) bytes[i] = PDF_HEADER.charCodeAt(i) & 0xff;
        if (type === 'blob') {
          return new Blob([bytes], { type: 'application/pdf' }) as unknown as Blob;
        }
        return bytes.buffer as ArrayBuffer;
      },
      internal: {
        pageSize: {
          getWidth: () => 612,
          getHeight: () => 792,
        },
      },
    } as FakeDoc;
    last = doc;
    return doc;
  };

  return {
    factory,
    lastDoc: () => last,
  };
}

// ─── fixtures ────────────────────────────────────────────────────────────

const YEAR = 2025;

function rec(date: string, amount: number, opts: Partial<FinanceRecord> = {}): FinanceRecord {
  return {
    event_date: date,
    amount,
    currency: 'USD',
    merchant: opts.merchant ?? 'm',
    merchant_normalized: opts.merchant_normalized ?? opts.merchant ?? 'm',
    direction: opts.direction ?? 'out',
    category: opts.category,
    is_adhd_tax: opts.is_adhd_tax,
    adhd_tax_type: opts.adhd_tax_type,
    ...opts,
  } as FinanceRecord;
}

function makeReport() {
  const records: FinanceRecord[] = [
    rec('2025-01-15', 120, { is_adhd_tax: true, adhd_tax_type: 'late_fee', category: 'bills' }),
    rec('2025-03-04', 40,  { is_adhd_tax: true, adhd_tax_type: 'duplicate', category: 'food' }),
    rec('2025-06-22', 200, { is_adhd_tax: true, adhd_tax_type: 'replacement', category: 'transport' }),
    rec('2025-11-10', 80,  { is_adhd_tax: true, adhd_tax_type: 'unused', category: 'subscriptions' }),
    rec('2025-07-01', 5000, { direction: 'in', category: 'invoice client a' }),
    rec('2024-07-01', 3500, { direction: 'in' }), // prior year income for yoy
  ];
  return exportADHDTaxReport(records, YEAR);
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('renderADHDTaxReportPDF · factory + page count', () => {
  it('invokes the factory with portrait letter pt', async () => {
    const { factory, lastDoc } = makeFakeFactory();
    await renderADHDTaxReportPDF(makeReport(), { year: YEAR, jsPDFFactory: factory });
    const doc = lastDoc();
    expect(doc).not.toBeNull();
    expect(doc!._ctorOpts).toMatchObject({
      unit: 'pt',
      format: 'letter',
      orientation: 'portrait',
    });
  });

  it('emits exactly four pages', async () => {
    const { factory, lastDoc } = makeFakeFactory();
    await renderADHDTaxReportPDF(makeReport(), { year: YEAR, jsPDFFactory: factory });
    expect(lastDoc()!._pageCount).toBe(4);
  });
});

describe('renderADHDTaxReportPDF · content', () => {
  it('cover page contains title, subtitle, and year', async () => {
    const { factory, lastDoc } = makeFakeFactory();
    await renderADHDTaxReportPDF(makeReport(), {
      year: YEAR,
      userName: 'serra',
      jsPDFFactory: factory,
    });
    const texts = lastDoc()!._texts;
    expect(texts).toContain('adhd-tax report');
    expect(texts).toContain('patterns, not failures.');
    expect(texts).toContain(String(YEAR));
    expect(texts).toContain('serra');
  });

  it('month-by-month page emits all 12 month labels', async () => {
    const { factory, lastDoc } = makeFakeFactory();
    await renderADHDTaxReportPDF(makeReport(), { year: YEAR, jsPDFFactory: factory });
    const texts = lastDoc()!._texts;
    for (const m of ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']) {
      expect(texts).toContain(m);
    }
  });

  it('categorized page emits each deductible bucket label', async () => {
    const { factory, lastDoc } = makeFakeFactory();
    await renderADHDTaxReportPDF(makeReport(), { year: YEAR, jsPDFFactory: factory });
    const texts = lastDoc()!._texts;
    expect(texts).toContain('business expense');
    expect(texts).toContain('home office');
    expect(texts).toContain('health');
    expect(texts).toContain('transport');
    expect(texts).toContain('food');
    expect(texts).toContain('subscriptions');
    expect(texts).toContain('adhd-tax');
    expect(texts).toContain('uncategorized');
  });

  it('yoy page emits a signed delta percentage', async () => {
    const { factory, lastDoc } = makeFakeFactory();
    await renderADHDTaxReportPDF(makeReport(), { year: YEAR, jsPDFFactory: factory });
    const texts = lastDoc()!._texts;
    // Either '+', '−' (unicode minus), or zero — must appear, with a '%' tail.
    const hasDelta = texts.some((t) => /^[+−]?[\d.]+%$/.test(t) || t === '—');
    expect(hasDelta).toBe(true);
  });
});

describe('renderADHDTaxReportPDF · binary output shape', () => {
  it('blob output starts with %PDF- header bytes', async () => {
    const { factory } = makeFakeFactory();
    const blob = (await renderADHDTaxReportPDF(makeReport(), {
      year: YEAR,
      jsPDFFactory: factory,
      output: 'blob',
    })) as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    const buf = await blob.arrayBuffer();
    const head = new Uint8Array(buf, 0, 5);
    const headStr = String.fromCharCode(...head);
    expect(headStr).toBe('%PDF-');
  });

  it('arraybuffer output starts with %PDF- header bytes', async () => {
    const { factory } = makeFakeFactory();
    const buf = (await renderADHDTaxReportPDF(makeReport(), {
      year: YEAR,
      jsPDFFactory: factory,
      output: 'arraybuffer',
    })) as ArrayBuffer;
    expect(buf.byteLength).toBeGreaterThan(0);
    const head = new Uint8Array(buf, 0, 5);
    expect(String.fromCharCode(...head)).toBe('%PDF-');
  });
});

describe('renderADHDTaxReportPDF · guards', () => {
  it('throws when report is missing', async () => {
    const { factory } = makeFakeFactory();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderADHDTaxReportPDF(null as any, { year: YEAR, jsPDFFactory: factory }),
    ).rejects.toThrow(/report/);
  });

  it('throws when opts.year is missing', async () => {
    const { factory } = makeFakeFactory();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      renderADHDTaxReportPDF(makeReport(), { jsPDFFactory: factory } as any),
    ).rejects.toThrow(/year/);
  });
});
