import { describe, it, expect } from 'vitest';
import { buildReceiptText } from './receiptCopy';

describe('buildReceiptText', () => {
  it('returns null when nothing was written', () => {
    expect(buildReceiptText([])).toBeNull();
  });

  it('names a single destination', () => {
    expect(buildReceiptText(['grocery'])).toBe('Saved to Groceries.');
  });

  it('joins two destinations with +', () => {
    expect(buildReceiptText(['grocery', 'medication'])).toBe('Saved to Groceries + Meds.');
  });

  it('uses friendly names (finance → Money, admin → To-do)', () => {
    expect(buildReceiptText(['finance'])).toBe('Saved to Money.');
    expect(buildReceiptText(['admin'])).toBe('Saved to To-do.');
  });

  it('dedupes repeated modules in first-seen order', () => {
    expect(buildReceiptText(['grocery', 'grocery', 'medication'])).toBe(
      'Saved to Groceries + Meds.',
    );
  });

  it('collapses the tail into "+ more" past three destinations', () => {
    expect(
      buildReceiptText(['grocery', 'medication', 'finance', 'cycle']),
    ).toBe('Saved to Groceries + Meds + Money + more.');
  });

  it('collapses generic/unroutable captures to "Noted."', () => {
    expect(buildReceiptText(['dump_only'])).toBe('Noted.');
    expect(buildReceiptText(['journal', 'crisis'])).toBe('Noted.');
  });

  it('drops generic modules but still names real ones', () => {
    expect(buildReceiptText(['dump_only', 'grocery'])).toBe('Saved to Groceries.');
  });

  it('falls back to title-case for an unknown module id', () => {
    expect(buildReceiptText(['side_effect'])).toBe('Saved to Side effect.');
  });
});
