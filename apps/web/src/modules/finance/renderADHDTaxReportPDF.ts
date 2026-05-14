/**
 * renderADHDTaxReportPDF
 *
 * Visual layout for the annual ADHD-tax report. Consumes the pure
 * `ExportADHDTaxReportResult` from @ollie/logic/finance/export and
 * emits a 4-page PDF in editorial-luxury restraint (cream / sage /
 * sky), no charts, no SaaS bling.
 *
 * Layout:
 *   page 1 — cover (title, year, totals)
 *   page 2 — month-by-month table (12 rows)
 *   page 3 — categorized totals + horizontal bars
 *   page 4 — yoy comparison (this year vs prior)
 *
 * Architecture note — jspdf is loaded via an injectable factory so
 * this module stays unit-testable without the dependency being
 * installed yet (pnpm install is frozen in Serra's monorepo). In
 * production, `defaultJsPDFFactory` dynamic-imports jspdf. Tests pass
 * a tiny fake that emits a valid `%PDF-` byte stream.
 *
 * Copy rules (banned-phrase guard):
 *   lowercase, factual, no improvement-areas talk, no emoji, no
 *   exclamation marks. "patterns, not failures." is the only mild
 *   editorial line.
 *
 * TODO(i18n): EN only at v1. ES pass alongside ExportPanel.
 */

import type { ExportADHDTaxReportResult } from '@ollie/logic/finance';

// ─── jsPDF surface we depend on ──────────────────────────────────────────
//
// We type only the methods we actually call. This lets test fakes
// satisfy the contract without importing jspdf, and keeps the
// production import a single dynamic-import call. If jspdf's API
// shifts, the breakage shows up here, not 200 lines into the renderer.

export interface JsPDFLike {
  addPage(): void;
  setFont(font: string, style?: string): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void;
  setFillColor(r: number, g: number, b: number): void;
  setLineWidth(w: number): void;
  text(
    text: string | string[],
    x: number,
    y: number,
    opts?: { align?: 'left' | 'center' | 'right'; maxWidth?: number },
  ): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  rect(x: number, y: number, w: number, h: number, style?: 'F' | 'S' | 'FD'): void;
  output(type: 'blob'): Blob;
  output(type: 'arraybuffer'): ArrayBuffer;
  internal: {
    pageSize: {
      getWidth(): number;
      getHeight(): number;
    };
  };
}

export type JsPDFFactory = (opts?: {
  unit?: 'pt';
  format?: 'a4' | 'letter';
  orientation?: 'portrait' | 'landscape';
}) => JsPDFLike;

/**
 * Default factory — dynamic-imports jspdf. Caller is async, so
 * `renderADHDTaxReportPDF` is async. Tests inject a synchronous fake.
 */
export const defaultJsPDFFactory: () => Promise<JsPDFFactory> = async () => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — jspdf is added to package.json; install lands at next pnpm pass.
  const mod = await import('jspdf');
  const Ctor = (mod.jsPDF ?? mod.default ?? mod) as new (
    opts?: { unit?: string; format?: string; orientation?: string },
  ) => JsPDFLike;
  return (opts) => new Ctor(opts);
};

// ─── editorial-luxury palette ────────────────────────────────────────────
//
// B&W base with cream surface + sage accent + sky provenance. Never
// red/green for delta — sage for steady, dusty graphite for shift.
// All values RGB 0–255 for jsPDF.

const PALETTE = {
  ink:      [28, 26, 24],     // deep graphite — body text
  paper:    [248, 244, 236],  // cream surface — bg accents only
  sage:     [142, 152, 130],  // muted accent — bars + provenance
  graphite: [110, 106, 100],  // secondary text + delta neutral
  hairline: [200, 192, 180],  // hairlines + table rules
  muted:    [158, 152, 144],  // labels, caps-mono
  sky:      [180, 194, 200],  // provenance tint (rare use)
} as const;

const FONTS = {
  display: 'helvetica',
  body: 'helvetica',
  mono: 'courier',
} as const;

const LAYOUT = {
  marginTop: 64,
  marginBottom: 64,
  marginLeft: 64,
  marginRight: 64,
} as const;

// ─── public types ────────────────────────────────────────────────────────

export interface RenderADHDTaxReportPDFOpts {
  year: number;
  userName?: string;
  /** Inject jsPDF factory (tests). Defaults to dynamic-import. */
  jsPDFFactory?: JsPDFFactory | (() => Promise<JsPDFFactory>);
  /** Output format. Default 'blob'. */
  output?: 'blob' | 'arraybuffer';
}

// ─── helpers ─────────────────────────────────────────────────────────────

const MONTH_LABELS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

function fmtMoney(n: number): string {
  // factual; no currency glyph (international users + tax season
  // submission frequently strips $).
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(n);
  return r.toLocaleString('en-US');
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const pct = n * 100;
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function topCategoryForMonth(
  monthKey: string,
  // We don't have per-month category breakdown in the report shape,
  // so the table just shows totals + count. (Adding per-month category
  // means re-shaping the logic layer — out of scope for v1.) Returning
  // '—' here keeps the column header but admits we don't slice that.
): string {
  void monthKey;
  return '—';
}

async function resolveFactory(
  override: JsPDFFactory | (() => Promise<JsPDFFactory>) | undefined,
): Promise<JsPDFFactory> {
  if (!override) return defaultJsPDFFactory();
  // If override is itself an async resolver, await it; if it's a
  // factory function (sync), return as-is.
  // Heuristic: factories take 0–1 args and return an object with .text;
  // resolvers return a Promise.
  if (typeof override === 'function') {
    try {
      const maybe = (override as () => unknown)();
      if (maybe && typeof (maybe as Promise<unknown>).then === 'function') {
        return (await (maybe as Promise<JsPDFFactory>));
      }
      // It executed and returned a doc — that means `override` IS a
      // factory. We can't un-call it. Re-wrap.
      return override as JsPDFFactory;
    } catch {
      // It threw because it wants jsPDFConstructor args. So it's a factory.
      return override as JsPDFFactory;
    }
  }
  return override as JsPDFFactory;
}

// ─── page renderers ──────────────────────────────────────────────────────

function setInk(doc: JsPDFLike, rgb: readonly [number, number, number] | readonly number[]) {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

function setStroke(doc: JsPDFLike, rgb: readonly number[]) {
  doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
}

function setFill(doc: JsPDFLike, rgb: readonly number[]) {
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

function hairline(doc: JsPDFLike, x1: number, y1: number, x2: number, y2: number) {
  doc.setLineWidth(0.4);
  setStroke(doc, PALETTE.hairline);
  doc.line(x1, y1, x2, y2);
}

function smcpLabel(
  doc: JsPDFLike,
  text: string,
  x: number,
  y: number,
  align: 'left' | 'center' | 'right' = 'left',
) {
  doc.setFont(FONTS.mono, 'normal');
  doc.setFontSize(7.5);
  setInk(doc, PALETTE.muted);
  // courier uppercase to simulate smcp + letterspacing
  doc.text(text.toUpperCase(), x, y, { align });
}

function renderCover(
  doc: JsPDFLike,
  report: ExportADHDTaxReportResult,
  opts: { year: number; userName?: string },
) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const left = LAYOUT.marginLeft;
  const right = W - LAYOUT.marginRight;

  // top hairline + smcp label
  hairline(doc, left, LAYOUT.marginTop, right, LAYOUT.marginTop);
  smcpLabel(doc, 'annual report', left, LAYOUT.marginTop - 10);
  smcpLabel(doc, `volume ${opts.year}`, right, LAYOUT.marginTop - 10, 'right');

  // display title — large, italic-ish serif via helvetica oblique
  doc.setFont(FONTS.display, 'normal');
  doc.setFontSize(42);
  setInk(doc, PALETTE.ink);
  doc.text('adhd-tax report', left, H * 0.42);

  doc.setFont(FONTS.display, 'italic');
  doc.setFontSize(14);
  setInk(doc, PALETTE.graphite);
  doc.text('patterns, not failures.', left, H * 0.42 + 24);

  // year — large numeral, sage tint
  doc.setFont(FONTS.display, 'normal');
  doc.setFontSize(96);
  setInk(doc, PALETTE.sage);
  doc.text(String(opts.year), left, H * 0.66);

  // factual block — total + count, bottom-left
  const totalsY = H - LAYOUT.marginBottom - 60;
  hairline(doc, left, totalsY - 24, right, totalsY - 24);

  smcpLabel(doc, 'recorded total', left, totalsY - 10);
  doc.setFont(FONTS.body, 'normal');
  doc.setFontSize(22);
  setInk(doc, PALETTE.ink);
  doc.text(`${fmtMoney(report.yearTotals.adhd_tax_total)}`, left, totalsY + 14);

  smcpLabel(doc, 'event count', (left + right) / 2, totalsY - 10);
  doc.setFont(FONTS.body, 'normal');
  doc.setFontSize(22);
  setInk(doc, PALETTE.ink);
  doc.text(`${report.yearTotals.adhd_tax_count}`, (left + right) / 2, totalsY + 14);

  // optional name + footer caps
  smcpLabel(doc, 'prepared for', left, H - LAYOUT.marginBottom);
  doc.setFont(FONTS.body, 'normal');
  doc.setFontSize(10);
  setInk(doc, PALETTE.graphite);
  doc.text(opts.userName ?? 'self', left, H - LAYOUT.marginBottom + 14);

  smcpLabel(doc, 'ollie · finance · v1', right, H - LAYOUT.marginBottom, 'right');
}

function renderMonthsTable(doc: JsPDFLike, report: ExportADHDTaxReportResult) {
  const W = doc.internal.pageSize.getWidth();
  const left = LAYOUT.marginLeft;
  const right = W - LAYOUT.marginRight;

  // header
  hairline(doc, left, LAYOUT.marginTop, right, LAYOUT.marginTop);
  smcpLabel(doc, 'ii — month by month', left, LAYOUT.marginTop - 10);
  smcpLabel(doc, `${report.year}`, right, LAYOUT.marginTop - 10, 'right');

  doc.setFont(FONTS.display, 'normal');
  doc.setFontSize(22);
  setInk(doc, PALETTE.ink);
  doc.text('twelve months, in sequence', left, LAYOUT.marginTop + 32);

  doc.setFont(FONTS.body, 'italic');
  doc.setFontSize(10);
  setInk(doc, PALETTE.graphite);
  doc.text(
    'each row is one calendar month. blank months are kept.',
    left,
    LAYOUT.marginTop + 50,
  );

  // column geometry
  const tableTop = LAYOUT.marginTop + 80;
  const col = {
    month: left,
    adhd: left + 130,
    count: left + 230,
    top: left + 320,
  };

  // column heads
  smcpLabel(doc, 'month',     col.month, tableTop);
  smcpLabel(doc, 'adhd-tax',  col.adhd,  tableTop, 'right');
  smcpLabel(doc, 'events',    col.count, tableTop, 'right');
  smcpLabel(doc, 'top cat.',  col.top,   tableTop);
  hairline(doc, left, tableTop + 6, right, tableTop + 6);

  // rows — 12 of them, fixed line height
  const rowH = 22;
  doc.setFont(FONTS.body, 'normal');
  doc.setFontSize(11);

  for (let i = 0; i < 12; i++) {
    const m = report.months[i];
    const rowY = tableTop + 6 + (i + 1) * rowH;

    setInk(doc, PALETTE.ink);
    doc.text(MONTH_LABELS[i], col.month, rowY);

    setInk(doc, m.adhd_tax_total > 0 ? PALETTE.ink : PALETTE.muted);
    doc.text(fmtMoney(m.adhd_tax_total), col.adhd, rowY, { align: 'right' });

    setInk(doc, m.adhd_tax_count > 0 ? PALETTE.ink : PALETTE.muted);
    doc.text(String(m.adhd_tax_count), col.count, rowY, { align: 'right' });

    setInk(doc, PALETTE.graphite);
    doc.setFont(FONTS.mono, 'normal');
    doc.setFontSize(9);
    doc.text(topCategoryForMonth(m.month), col.top, rowY);
    doc.setFont(FONTS.body, 'normal');
    doc.setFontSize(11);

    // very faint row rule
    if (i < 11) {
      doc.setLineWidth(0.2);
      setStroke(doc, PALETTE.hairline);
      doc.line(left, rowY + 6, right, rowY + 6);
    }
  }

  // total row
  const totalY = tableTop + 6 + 13 * rowH + 8;
  hairline(doc, left, totalY - 16, right, totalY - 16);
  smcpLabel(doc, 'year', col.month, totalY);
  doc.setFont(FONTS.body, 'normal');
  doc.setFontSize(13);
  setInk(doc, PALETTE.ink);
  doc.text(fmtMoney(report.yearTotals.adhd_tax_total), col.adhd, totalY, {
    align: 'right',
  });
  doc.text(String(report.yearTotals.adhd_tax_count), col.count, totalY, {
    align: 'right',
  });
}

function renderCategorized(doc: JsPDFLike, report: ExportADHDTaxReportResult) {
  const W = doc.internal.pageSize.getWidth();
  const left = LAYOUT.marginLeft;
  const right = W - LAYOUT.marginRight;

  hairline(doc, left, LAYOUT.marginTop, right, LAYOUT.marginTop);
  smcpLabel(doc, 'iii — categorized', left, LAYOUT.marginTop - 10);
  smcpLabel(doc, `${report.year}`, right, LAYOUT.marginTop - 10, 'right');

  doc.setFont(FONTS.display, 'normal');
  doc.setFontSize(22);
  setInk(doc, PALETTE.ink);
  doc.text('expense, by bucket', left, LAYOUT.marginTop + 32);

  doc.setFont(FONTS.body, 'italic');
  doc.setFontSize(10);
  setInk(doc, PALETTE.graphite);
  doc.text(
    'sage bars are proportional. lengths are factual, not judgement.',
    left,
    LAYOUT.marginTop + 50,
  );

  // pick deductible categories only (income excluded — page is about
  // outflows). preserve a stable order.
  const buckets: Array<{ key: keyof typeof report.categorizedTotals; label: string }> = [
    { key: 'business_expense',  label: 'business expense' },
    { key: 'home_office',       label: 'home office' },
    { key: 'health',            label: 'health' },
    { key: 'transport',         label: 'transport' },
    { key: 'food',              label: 'food' },
    { key: 'subscriptions',     label: 'subscriptions' },
    { key: 'adhd_tax',          label: 'adhd-tax' },
    { key: 'other_deductible',  label: 'other deductible' },
    { key: 'uncategorized',     label: 'uncategorized' },
  ];

  const max = Math.max(
    1,
    ...buckets.map((b) => report.categorizedTotals[b.key]),
  );

  const top = LAYOUT.marginTop + 90;
  const rowH = 36;
  const barAreaLeft = left + 180;
  const barAreaRight = right - 100;
  const barAreaWidth = barAreaRight - barAreaLeft;

  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    const v = report.categorizedTotals[b.key];
    const y = top + i * rowH;

    // label
    doc.setFont(FONTS.body, 'normal');
    doc.setFontSize(11);
    setInk(doc, PALETTE.ink);
    doc.text(b.label, left, y + 4);

    // bar — sage outline + sage fill at proportional width
    const w = Math.max(2, (v / max) * barAreaWidth);
    setFill(doc, PALETTE.sage);
    doc.rect(barAreaLeft, y - 6, w, 10, 'F');

    // amount, right-aligned
    doc.setFont(FONTS.body, 'normal');
    doc.setFontSize(11);
    setInk(doc, PALETTE.ink);
    doc.text(fmtMoney(v), right, y + 4, { align: 'right' });

    // hairline below each row except last
    if (i < buckets.length - 1) {
      doc.setLineWidth(0.2);
      setStroke(doc, PALETTE.hairline);
      doc.line(left, y + 18, right, y + 18);
    }
  }
}

function renderYoY(doc: JsPDFLike, report: ExportADHDTaxReportResult) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const left = LAYOUT.marginLeft;
  const right = W - LAYOUT.marginRight;

  hairline(doc, left, LAYOUT.marginTop, right, LAYOUT.marginTop);
  smcpLabel(doc, 'iv — year over year', left, LAYOUT.marginTop - 10);
  smcpLabel(doc, `${report.year - 1} → ${report.year}`, right, LAYOUT.marginTop - 10, 'right');

  doc.setFont(FONTS.display, 'normal');
  doc.setFontSize(22);
  setInk(doc, PALETTE.ink);
  doc.text('this year, against the last', left, LAYOUT.marginTop + 32);

  doc.setFont(FONTS.body, 'italic');
  doc.setFontSize(10);
  setInk(doc, PALETTE.graphite);
  doc.text(
    'delta in net cash position. neither outcome is a verdict.',
    left,
    LAYOUT.marginTop + 50,
  );

  // two stacked numerals
  const blockY = LAYOUT.marginTop + 110;
  smcpLabel(doc, 'net · this year', left, blockY);
  doc.setFont(FONTS.display, 'normal');
  doc.setFontSize(46);
  setInk(doc, PALETTE.ink);
  doc.text(fmtMoney(report.yearTotals.net), left, blockY + 42);

  smcpLabel(doc, 'income · this year', left, blockY + 86);
  doc.setFont(FONTS.body, 'normal');
  doc.setFontSize(14);
  setInk(doc, PALETTE.graphite);
  doc.text(fmtMoney(report.yearTotals.income), left, blockY + 104);

  smcpLabel(doc, 'expense · this year', (left + right) / 2, blockY + 86);
  doc.text(fmtMoney(report.yearTotals.expenses), (left + right) / 2, blockY + 104);

  // delta — sage if positive, graphite if negative; never red/green
  const deltaY = blockY + 160;
  hairline(doc, left, deltaY - 18, right, deltaY - 18);
  smcpLabel(doc, 'delta vs prior year', left, deltaY);
  doc.setFont(FONTS.display, 'normal');
  doc.setFontSize(36);
  if (report.yoyDelta === 0) {
    setInk(doc, PALETTE.graphite);
  } else if (report.yoyDelta > 0) {
    setInk(doc, PALETTE.sage);
  } else {
    setInk(doc, PALETTE.graphite);
  }
  doc.text(fmtPct(report.yoyDelta), left, deltaY + 32);

  // footer credit
  smcpLabel(doc, 'end of report', left, H - LAYOUT.marginBottom);
  smcpLabel(
    doc,
    'ollie · finance · v1',
    right,
    H - LAYOUT.marginBottom,
    'right',
  );
}

// ─── main ────────────────────────────────────────────────────────────────

/**
 * renderADHDTaxReportPDF — produces a 4-page PDF for the annual
 * ADHD-tax report.
 *
 * Returns a Blob by default; pass `output: 'arraybuffer'` for the
 * raw bytes (useful when piping into encryptExport).
 */
export async function renderADHDTaxReportPDF(
  report: ExportADHDTaxReportResult,
  opts: RenderADHDTaxReportPDFOpts,
): Promise<Blob | ArrayBuffer> {
  if (!report) {
    throw new Error('renderADHDTaxReportPDF: report is required');
  }
  if (!opts || typeof opts.year !== 'number') {
    throw new Error('renderADHDTaxReportPDF: opts.year is required');
  }

  const factory = await resolveFactory(opts.jsPDFFactory);
  const doc = factory({ unit: 'pt', format: 'letter', orientation: 'portrait' });

  renderCover(doc, report, { year: opts.year, userName: opts.userName });
  doc.addPage();
  renderMonthsTable(doc, report);
  doc.addPage();
  renderCategorized(doc, report);
  doc.addPage();
  renderYoY(doc, report);

  if (opts.output === 'arraybuffer') {
    return doc.output('arraybuffer');
  }
  return doc.output('blob');
}
