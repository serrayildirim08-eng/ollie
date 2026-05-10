/**
 * @ollie/logic · finance dump parser
 *
 * Pure text → FinanceRecord extraction. No wall-clock reads.
 */

import type { ParsedFinanceDump } from './types';
import { normalizeMerchant } from './jaro';
import { isoDate } from './math';

const INCOME_MARKERS = [
  'got paid', 'received', 'salary', 'paycheck', 'deposit',
  'earned', 'income', 'refund', 'transferred in',
];
const EXPENSE_MARKERS = [
  'paid', 'bought', 'spent', 'expense', 'purchase',
  'subscribed', 'charged', 'fee', 'bill', 'rent', 'due',
];
const ADHD_TAX_MARKERS: Record<string, string[]> = {
  late_fee: ['late fee', 'late charge', 'overdraft', 'missed payment'],
  replacement: ['replaced', 'replacement', 'lost again', 'bought another'],
  unused: ['never used', 'havent used', "haven't used"],
  duplicate: ['bought twice', 'duplicate', 'double charged'],
};

const DEFAULT_KEYWORDS: Record<string, string[]> = {
  late: ['late', 'overdue', 'overdraft'],
  forgot: ['forgot', 'missed'],
  impulse: ['impulse'],
};

export function parseFinanceDump(
  text: string,
  now: number,
  keywords?: Record<string, string[]>,
  currency?: string,
): ParsedFinanceDump {
  const src = String(text || '');
  if (!src.trim()) return { record: null, span: null };
  const lower = src.toLowerCase();

  let amount: number | null = null;
  let detected = currency ?? 'USD';
  const amountRe = /(?:^|[^a-zA-Z0-9])(?:[$£€¥])?\s*(\d[\d,]*(?:\.\d{1,2})?)(?![a-zA-Z0-9])/;
  const am = src.match(amountRe);
  if (am) {
    const v = parseFloat(am[1].replace(/,/g, ''));
    if (isFinite(v) && v > 0) amount = v;
  }
  if (/\$/.test(src)) detected = currency ?? 'USD';
  else if (/£/.test(src)) detected = 'GBP';
  else if (/€/.test(src)) detected = 'EUR';
  else if (/¥/.test(src)) detected = 'JPY';

  let direction: 'in' | 'out' | null = null;
  if (INCOME_MARKERS.some((m) => lower.includes(m))) direction = 'in';
  if (EXPENSE_MARKERS.some((m) => lower.includes(m)))
    direction = direction === 'in' ? direction : 'out';

  let merchant: string | null = null;
  const merchantPatterns = [
    /\b(?:paid|bought|subscribed to|rent|for)\s+([a-z][a-z0-9\s&'.-]{1,40}?)(?:\s*(?:\$|£|€|¥|\d|today|yesterday|tomorrow|friday|monday|tuesday|wednesday|thursday|saturday|sunday)|[,.]|$)/i,
    /^\s*([a-z][a-z0-9\s&'.-]{2,40}?)\s*(?:\$|£|€|¥|\d+)/i,
  ];
  for (const p of merchantPatterns) {
    const m = src.match(p);
    if (m?.[1]) {
      const c = m[1].trim().replace(/\s+/g, ' ');
      if (c.length >= 2 && c.length <= 40 && !/^(a|an|the|to|for|of|in|on|at|by|with)$/i.test(c)) {
        merchant = c;
        break;
      }
    }
  }

  let isAdhdTax = false;
  let adhdTaxType: string | null = null;
  for (const [tn, markers] of Object.entries(ADHD_TAX_MARKERS)) {
    if (markers.some((m) => lower.includes(m))) {
      isAdhdTax = true;
      adhdTaxType = tn;
      break;
    }
  }

  const tokenMap = keywords ?? DEFAULT_KEYWORDS;
  const tokens: string[] = [];
  for (const [cat, words] of Object.entries(tokenMap)) {
    for (const w of words) {
      if (new RegExp('\\b' + w + '\\b', 'i').test(lower)) {
        tokens.push(cat + ':' + w.toLowerCase());
        break;
      }
    }
  }

  const hasContent = amount != null || direction != null || isAdhdTax;
  if (!hasContent) return { record: null, span: null };

  return {
    record: {
      event_date: isoDate(now),
      amount,
      currency: detected,
      merchant,
      merchant_normalized: merchant ? normalizeMerchant(merchant) : null,
      category: null,
      notes: null,
      direction: direction ?? 'out',
      tokens,
      is_adhd_tax: isAdhdTax,
      adhd_tax_type: adhdTaxType as import('./types').ADHDTaxType | null,
      raw_span: { start: 0, end: src.length },
    },
    span: { start: 0, end: src.length },
  };
}
