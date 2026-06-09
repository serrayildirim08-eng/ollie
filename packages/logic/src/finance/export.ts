/**
 * @ollie/logic · finance · export (CSV + structured annual report)
 *
 * Money-module gap closure. Pure data shaping; the UI owns the
 * file-download, the passphrase modal, and any PDF rendering.
 *
 * RFC 4180 CSV escaping: any field containing comma, double-quote, or
 * newline is wrapped in double-quotes; embedded double-quotes are
 * doubled.
 *
 * The encryption path is async (depends on WebCrypto) and is the only
 * non-pure function here — but it has no store/DOM access, so it's
 * still test-safe.
 */

import type { FinanceRecord } from './types';

// NOTE: @ollie/crypto deliberately not imported here — @ollie/logic is
// kept free of cross-package runtime deps. encryptExport delegates to
// crypto primitives the caller injects, so the logic module stays
// pure (no crypto.subtle calls) and the React layer (which already
// depends on @ollie/crypto) wires the primitives in.

// ─── CSV ──────────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  'event_date',
  'amount',
  'currency',
  'direction',
  'merchant',
  'merchant_normalized',
  'category',
  'kind',
  'is_adhd_tax',
  'adhd_tax_type',
  'cycle_phase',
  'notes',
] as const;

type CsvColumn = typeof CSV_COLUMNS[number];

export interface ExportCSVOpts {
  /** Optional explicit column ordering. Default: all columns. */
  columns?: readonly CsvColumn[];
  /** Date range filter (inclusive YYYY-MM-DD strings). */
  fromDate?: string;
  /** Date range filter (inclusive YYYY-MM-DD strings). */
  toDate?: string;
  /** Filter by direction. */
  direction?: 'in' | 'out';
  /** When true, omit the header row. Default false. */
  omitHeader?: boolean;
}

/**
 * RFC 4180-compliant escaping. Quotes any field containing CR, LF, ",
 * or comma.
 */
function escapeCsvField(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  if (str === '') return '';
  const needsQuote = /[",\r\n]/.test(str);
  if (!needsQuote) return str;
  return '"' + str.replace(/"/g, '""') + '"';
}

/**
 * exportToCSV — full transaction dump with stable column order.
 * Returns the CSV string (no I/O — caller writes it).
 *
 * Line separator is CRLF per RFC 4180 §2.1.
 */
export function exportToCSV(records: FinanceRecord[], opts?: ExportCSVOpts): string {
  const o = opts ?? {};
  const cols = (o.columns ?? CSV_COLUMNS) as readonly CsvColumn[];

  const filtered = (records ?? []).filter((r) => {
    if (!r) return false;
    if (o.fromDate && r.event_date && r.event_date < o.fromDate) return false;
    if (o.toDate && r.event_date && r.event_date > o.toDate) return false;
    if (o.direction && r.direction !== o.direction) return false;
    return true;
  });

  const lines: string[] = [];
  if (!o.omitHeader) {
    lines.push(cols.map((c) => escapeCsvField(c)).join(','));
  }
  for (const r of filtered) {
    const indexed = r as unknown as Record<string, unknown>;
    const row = cols.map((c) => {
      const v = indexed[c];
      // Booleans → 'true' / 'false' for spreadsheet friendliness
      if (typeof v === 'boolean') return escapeCsvField(v ? 'true' : 'false');
      return escapeCsvField(v);
    });
    lines.push(row.join(','));
  }
  return lines.join('\r\n');
}

// ─── annual ADHD-tax report (structured data only) ────────────────────────

export type TaxCategory =
  | 'income'
  | 'business_expense'
  | 'home_office'
  | 'health'
  | 'transport'
  | 'food'
  | 'subscriptions'
  | 'adhd_tax'
  | 'other_deductible'
  | 'uncategorized';

/**
 * Maps a record's `category` and `kind` to a tax-relevant bucket.
 * Conservative: anything not recognised falls to 'uncategorized'.
 */
function classifyForTax(record: FinanceRecord): TaxCategory {
  if (record.direction === 'in') return 'income';
  if (record.is_adhd_tax) return 'adhd_tax';
  const c = (record.category ?? '').toLowerCase();
  if (!c) return 'uncategorized';
  if (/^(work|business|client|invoice|software|tool)/.test(c)) return 'business_expense';
  if (/(home.?office|rent.+office|office.+supplies)/.test(c)) return 'home_office';
  if (/(health|medical|therapy|dental|pharmacy|copay|insurance.+health)/.test(c)) return 'health';
  if (/(transit|transport|uber|lyft|gas|fuel|parking|metro|taxi)/.test(c)) return 'transport';
  if (/(grocery|food|restaurant|cafe|coffee|takeout|delivery)/.test(c)) return 'food';
  if (/(subscription|streaming|membership)/.test(c)) return 'subscriptions';
  return 'other_deductible';
}

export interface MonthBreakdown {
  month: string; // YYYY-MM
  income: number;
  expenses: number;
  net: number;
  adhd_tax_total: number;
  adhd_tax_count: number;
}

export interface ExportADHDTaxReportResult {
  year: number;
  months: MonthBreakdown[];
  yoyDelta: number;            // pct change in net vs prior year (0 if no prior data)
  categorizedTotals: Record<TaxCategory, number>;
  yearTotals: {
    income: number;
    expenses: number;
    net: number;
    adhd_tax_total: number;
    adhd_tax_count: number;
  };
}

const ZERO_CATEGORIES: Record<TaxCategory, number> = {
  income: 0,
  business_expense: 0,
  home_office: 0,
  health: 0,
  transport: 0,
  food: 0,
  subscriptions: 0,
  adhd_tax: 0,
  other_deductible: 0,
  uncategorized: 0,
};

function emptyMonth(month: string): MonthBreakdown {
  return {
    month,
    income: 0,
    expenses: 0,
    net: 0,
    adhd_tax_total: 0,
    adhd_tax_count: 0,
  };
}

function yearOf(date: string): number | null {
  const m = /^(\d{4})-/.exec(date);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function monthOf(date: string): string | null {
  const m = /^(\d{4}-\d{2})/.exec(date);
  if (!m) return null;
  return m[1];
}

/**
 * exportADHDTaxReport — structured annual report for tax season. UI
 * renders this to PDF; logic just shapes the numbers.
 *
 * Returns 12 monthly rows even if some months have zero activity, so
 * the PDF table has a stable shape.
 */
export function exportADHDTaxReport(
  records: FinanceRecord[],
  year: number,
): ExportADHDTaxReportResult {
  const months: MonthBreakdown[] = [];
  for (let i = 1; i <= 12; i++) {
    months.push(emptyMonth(`${year}-${String(i).padStart(2, '0')}`));
  }

  const categorizedTotals: Record<TaxCategory, number> = { ...ZERO_CATEGORIES };

  let yearIncome = 0;
  let yearExpenses = 0;
  let yearADHDTotal = 0;
  let yearADHDCount = 0;

  let priorYearNet = 0;
  let priorYearHasData = false;

  for (const r of records ?? []) {
    if (!r?.event_date || r.amount == null) continue;
    const y = yearOf(r.event_date);
    if (y == null) continue;

    if (y === year) {
      const mKey = monthOf(r.event_date);
      if (!mKey) continue;
      const mIdx = parseInt(mKey.slice(5), 10) - 1;
      if (mIdx < 0 || mIdx > 11) continue;
      const slot = months[mIdx];
      const amt = Math.abs(r.amount);

      const cat = classifyForTax(r);
      categorizedTotals[cat] += amt;

      if (r.direction === 'in') {
        slot.income += amt;
        yearIncome += amt;
      } else {
        slot.expenses += amt;
        yearExpenses += amt;
        if (r.is_adhd_tax) {
          slot.adhd_tax_total += amt;
          slot.adhd_tax_count += 1;
          yearADHDTotal += amt;
          yearADHDCount += 1;
        }
      }
      slot.net = slot.income - slot.expenses;
    } else if (y === year - 1) {
      priorYearHasData = true;
      const amt = Math.abs(r.amount);
      if (r.direction === 'in') priorYearNet += amt;
      else priorYearNet -= amt;
    }
  }

  const yearNet = yearIncome - yearExpenses;
  let yoyDelta = 0;
  if (priorYearHasData && priorYearNet !== 0) {
    yoyDelta = (yearNet - priorYearNet) / Math.abs(priorYearNet);
  }

  // Round numbers for stable PDF output
  for (const m of months) {
    m.income = round2(m.income);
    m.expenses = round2(m.expenses);
    m.net = round2(m.net);
    m.adhd_tax_total = round2(m.adhd_tax_total);
  }
  (Object.keys(categorizedTotals) as TaxCategory[]).forEach((k) => {
    categorizedTotals[k] = round2(categorizedTotals[k]);
  });

  return {
    year,
    months,
    yoyDelta: Number(yoyDelta.toFixed(4)),
    categorizedTotals,
    yearTotals: {
      income: round2(yearIncome),
      expenses: round2(yearExpenses),
      net: round2(yearNet),
      adhd_tax_total: round2(yearADHDTotal),
      adhd_tax_count: yearADHDCount,
    },
  };
}

// ─── encrypted export ─────────────────────────────────────────────────────

/**
 * The on-disk envelope shape. Stored as JSON inside the returned Blob.
 *
 * Format v1:
 *   { v: 1, alg: 'AES-GCM-256+PBKDF2-SHA256', salt, iv, ciphertext,
 *     kdf_iterations }
 *
 * salt/iv/ciphertext are base64 strings (RFC 4648). The decrypter must
 * re-derive the key from the user's passphrase + salt + `kdf_iterations`,
 * then decrypt the ciphertext using the iv.
 *
 * SECURITY (S7): `kdf_iterations` records the PBKDF2 iteration count so a
 * decrypter reproduces the same key after the global default changes.
 * Envelopes written before S7 used the `...-100k` alg tag and carry no
 * `kdf_iterations` field — a decrypter must fall back to 100k for those.
 */
export interface EncryptedExportEnvelope {
  v: 1;
  alg: 'AES-GCM-256+PBKDF2-SHA256' | 'AES-GCM-256+PBKDF2-SHA256-100k';
  salt: string;       // base64
  iv: string;         // base64
  ciphertext: string; // base64
  /** PBKDF2 iteration count (S7). Absent on pre-S7 envelopes → assume 100k. */
  kdf_iterations?: number;
  /** Optional content-type hint for the original payload (e.g. 'text/csv'). */
  contentType?: string;
}

export interface EncryptExportOpts {
  /** MIME hint stored in the envelope. Default 'text/csv'. */
  contentType?: string;
}

/**
 * Crypto-primitive injection surface. The React layer passes in real
 * @ollie/crypto functions; tests pass deterministic fakes. Keeps the
 * logic package free of platform crypto dependencies.
 */
export interface CryptoPrimitives {
  randomSalt: () => Uint8Array;
  /**
   * Derive an AES-GCM key. The optional third arg is the PBKDF2 iteration
   * count (S7); `@ollie/crypto.deriveKey` defaults it to the current 600k.
   */
  deriveKey: (passphrase: string, salt: Uint8Array, iterations?: number) => Promise<CryptoKey>;
  encryptData: (
    key: CryptoKey,
    data: unknown,
  ) => Promise<{ iv: Uint8Array; ciphertext: Uint8Array }>;
  bytesToBase64: (bytes: Uint8Array) => string;
  /**
   * PBKDF2 iteration count to derive with + record in the envelope (S7).
   * Optional — defaults to 600k (the current `@ollie/crypto` default) so
   * existing callers that don't pass it still produce a correct envelope.
   */
  kdfIterations?: number;
}

/** Current PBKDF2 iteration count — kept in sync with `@ollie/crypto`. */
const DEFAULT_KDF_ITERATIONS = 600_000;

/**
 * encryptExport — AES-GCM-256 wrap of `content` with a key derived
 * from `passphrase`. Returns the JSON envelope STRING; UI is
 * responsible for wrapping in a Blob and triggering the download.
 *
 * Fresh salt + IV per call (provided by the injected primitives).
 * Caller is responsible for the passphrase lifecycle (never persist).
 */
export async function encryptExport(
  content: string,
  passphrase: string,
  crypto: CryptoPrimitives,
  opts?: EncryptExportOpts,
): Promise<string> {
  if (!passphrase || passphrase.length < 1) {
    throw new Error('encryptExport: passphrase is required');
  }
  if (!crypto) {
    throw new Error('encryptExport: crypto primitives are required');
  }
  const o = opts ?? {};
  const salt = crypto.randomSalt();
  // SECURITY (S7): derive at the current iteration count and record it.
  const kdfIterations = crypto.kdfIterations ?? DEFAULT_KDF_ITERATIONS;
  const key = await crypto.deriveKey(passphrase, salt, kdfIterations);
  const { iv, ciphertext } = await crypto.encryptData(key, content);

  const envelope: EncryptedExportEnvelope = {
    v: 1,
    alg: 'AES-GCM-256+PBKDF2-SHA256',
    salt: crypto.bytesToBase64(salt),
    iv: crypto.bytesToBase64(iv),
    ciphertext: crypto.bytesToBase64(ciphertext),
    kdf_iterations: kdfIterations,
    contentType: o.contentType ?? 'text/csv',
  };
  return JSON.stringify(envelope);
}

// ─── helpers ──────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Number(n.toFixed(2));
}
