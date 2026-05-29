/**
 * compressImage · pure-helper + entry-validation tests.
 *
 * jsdom has no real canvas encoder, so the full canvas path is exercised
 * by a runtime-level integration test instead. Here we lock down:
 *
 *   1. fitWithin — pure math: aspect preserved, no upscale when inside max.
 *   2. withinBudget — pure boundary: under = ok; over = not ok; size echoed.
 *   3. compressImage rejects unsupported mimes (entry guard, no canvas).
 *   4. compressImage rejects an unreadable blob (decode failure path).
 */

import { describe, it, expect } from 'vitest';
import {
  fitWithin,
  withinBudget,
  compressImage,
  MAX_DIM,
  MAX_B64_BYTES,
  MAX_PDF_RAW_BYTES,
} from './compressImage';

describe('fitWithin', () => {
  it('does not upscale when both dimensions are within budget', () => {
    expect(fitWithin({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(fitWithin({ width: MAX_DIM, height: 100 })).toEqual({ width: MAX_DIM, height: 100 });
  });

  it('scales landscape so longest edge equals MAX_DIM', () => {
    const out = fitWithin({ width: 4000, height: 2000 });
    expect(out.width).toBe(MAX_DIM);
    // 2000 * (1280/4000) = 640
    expect(out.height).toBe(640);
  });

  it('scales portrait so longest edge equals MAX_DIM', () => {
    const out = fitWithin({ width: 1500, height: 3000 });
    expect(out.height).toBe(MAX_DIM);
    // 1500 * (1280/3000) = 640
    expect(out.width).toBe(640);
  });

  it('respects a custom maxDim', () => {
    const out = fitWithin({ width: 600, height: 300 }, 256);
    expect(out.width).toBe(256);
    expect(out.height).toBe(128);
  });

  it('never returns a 0-pixel dimension', () => {
    // an absurdly extreme aspect ratio could round to 0 without the guard
    const out = fitWithin({ width: 10000, height: 1 }, 100);
    expect(out.width).toBe(100);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });
});

describe('withinBudget', () => {
  it('reports ok=true when under the byte budget', () => {
    const small = 'a'.repeat(1000);
    const verdict = withinBudget(small);
    expect(verdict.ok).toBe(true);
    expect(verdict.bytes).toBe(1000);
  });

  it('reports ok=false when over the byte budget', () => {
    const big = 'a'.repeat(MAX_B64_BYTES + 1);
    const verdict = withinBudget(big);
    expect(verdict.ok).toBe(false);
    expect(verdict.bytes).toBe(MAX_B64_BYTES + 1);
  });

  it('treats exactly-at-budget as ok', () => {
    const right = 'a'.repeat(MAX_B64_BYTES);
    expect(withinBudget(right).ok).toBe(true);
  });
});

describe('compressImage entry-validation', () => {
  it('rejects unsupported mime types with a typed reason', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/gif' });
    const result = await compressImage(blob);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported_mime');
  });

  it('rejects an unreadable / non-image jpeg blob with decode_failed', async () => {
    // mime says jpeg, payload is garbage — img.decode() must reject.
    const blob = new Blob([new Uint8Array([0, 1, 2, 3, 4])], { type: 'image/jpeg' });
    const result = await compressImage(blob);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('decode_failed');
  });

  it('accepts a small PDF blob and returns application/pdf payload', async () => {
    // 12 fake bytes; PDF path skips canvas entirely, just size-checks + base64.
    const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3, 4, 5, 6, 7, 8])], {
      type: 'application/pdf',
    });
    const result = await compressImage(pdf);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.image.mime).toBe('application/pdf');
      expect(result.image.data.length).toBeGreaterThan(0);
    }
  });

  it('rejects a PDF blob larger than MAX_PDF_RAW_BYTES with too_large', async () => {
    const big = new Blob([new Uint8Array(MAX_PDF_RAW_BYTES + 1)], { type: 'application/pdf' });
    const result = await compressImage(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_large');
  });
});
