/**
 * compressImage · client-side image preparation for /route/dump.
 *
 * Pipeline (in order):
 *   1. validate mime is jpeg|png|webp; reject otherwise.
 *   2. resize so longest dimension ≤ MAX_DIM (1280px).
 *   3. choose output format:
 *        - jpeg in / webp in → keep type
 *        - png in → keep as png IFF it has alpha, else re-encode jpeg q=0.85.
 *      (transparency is preserved; opaque pngs are wasteful for photos.)
 *   4. encode → base64; if encoded length > MAX_B64_BYTES, drop q to 0.7
 *      and re-encode once. If still too big, return a SizeError.
 *
 * Output: { mime, data } shaped exactly like RouteDumpImage so callers can
 * spread it into the worker body without remapping.
 *
 * Design: the canvas/encode side is the runtime "engine"; the size-budget
 * loop is pure and decoupled so we can unit-test the boundary without a
 * real Canvas (jsdom has no encoder).
 */

import type { RouteDumpImage, RouteDumpImageMime } from '../api';

// ─── budget knobs ────────────────────────────────────────────────────────────

/** Longest edge after resize. 1280 is plenty for receipts & labels. */
export const MAX_DIM = 1280;

/** Max payload size after base64 encoding. Spec says ≤900KB. */
export const MAX_B64_BYTES = 900 * 1024;

/** Initial JPEG quality. */
export const Q_HIGH = 0.85;

/** Fallback JPEG quality if first encode overshoots the size budget. */
export const Q_LOW = 0.7;

// ─── result types ────────────────────────────────────────────────────────────

export type CompressResult =
  | { ok: true; image: RouteDumpImage }
  | { ok: false; reason: 'unsupported_mime' | 'too_large' | 'decode_failed' };

const ALLOWED_MIMES: ReadonlySet<string> = new Set<RouteDumpImageMime>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

/** Raw byte cap on PDFs (no client-side resize possible). Matches worker
 *  MAX_IMAGE_BYTES (8MB) minus headroom for base64 inflation. */
export const MAX_PDF_RAW_BYTES = 6 * 1024 * 1024;

// ─── pure: resize math + budget verdict (testable, no Canvas needed) ─────────

export interface Dims { width: number; height: number; }

/**
 * Compute the resized dimensions so that the longest edge equals `maxDim`,
 * preserving aspect ratio. If both edges are already within budget, returns
 * the original dimensions unchanged.
 */
export function fitWithin(src: Dims, maxDim: number = MAX_DIM): Dims {
  const longest = Math.max(src.width, src.height);
  if (longest <= maxDim) return { width: src.width, height: src.height };
  const scale = maxDim / longest;
  // Math.round, not floor, so a 1281x720 lands on 1280x719 (not 1280x718).
  return {
    width: Math.max(1, Math.round(src.width * scale)),
    height: Math.max(1, Math.round(src.height * scale)),
  };
}

/**
 * True iff the base64 payload fits the contract budget. Returns the size
 * inline so callers can log / surface it without recomputing.
 */
export function withinBudget(base64: string, max: number = MAX_B64_BYTES): {
  ok: boolean; bytes: number;
} {
  return { ok: base64.length <= max, bytes: base64.length };
}

// ─── runtime: load + canvas encode + budget loop ─────────────────────────────

/**
 * Load a File / Blob into an HTMLImageElement via an object URL.
 * Revokes the URL once decode resolves so we don't leak.
 */
async function loadBitmap(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // safe to revoke after decode — bitmap is detached from the URL by now
    URL.revokeObjectURL(url);
  }
}

/**
 * Draw a source image onto a canvas at `dims` and read it back as a Blob
 * in the requested mime. Throws if the canvas backend can't encode.
 */
async function drawAndEncode(
  img: HTMLImageElement,
  dims: Dims,
  mime: RouteDumpImageMime,
  quality: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(img, 0, 0, dims.width, dims.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, quality),
  );
  if (!blob) throw new Error(`canvas.toBlob returned null for ${mime}`);
  return blob;
}

/** Convert a Blob to a base64 string (no data: prefix). */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // chunk to avoid stack overflow on big buffers in String.fromCharCode
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Cheap PNG alpha sniff: draw at a tiny size and scan for any pixel whose
 * alpha channel ≠ 255. Used to decide whether to re-encode a PNG → JPEG or
 * preserve transparency. Sampling 64x64 is enough for receipt-style scans.
 */
function pngHasAlpha(img: HTMLImageElement): boolean {
  const probe = document.createElement('canvas');
  const w = (probe.width = Math.min(64, img.naturalWidth || 64));
  const h = (probe.height = Math.min(64, img.naturalHeight || 64));
  const ctx = probe.getContext('2d');
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }
  return false;
}

/**
 * Main entry. Takes a Blob/File from any of the three intake paths
 * (drag, paste, picker) and returns a `RouteDumpImage` or a typed failure.
 *
 * The function is shaped as a result-type to mirror the API client style;
 * call sites never have to try/catch.
 */
export async function compressImage(input: Blob): Promise<CompressResult> {
  if (!ALLOWED_MIMES.has(input.type)) {
    return { ok: false, reason: 'unsupported_mime' };
  }

  // PDF path: no canvas, no resize. Cap raw size + base64 encode the bytes.
  if (input.type === 'application/pdf') {
    if (input.size > MAX_PDF_RAW_BYTES) {
      return { ok: false, reason: 'too_large' };
    }
    let data: string;
    try {
      data = await blobToBase64(input);
    } catch {
      return { ok: false, reason: 'decode_failed' };
    }
    return { ok: true, image: { mime: 'application/pdf', data } };
  }

  let img: HTMLImageElement;
  try {
    img = await loadBitmap(input);
  } catch {
    return { ok: false, reason: 'decode_failed' };
  }

  const srcDims: Dims = {
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
  };
  if (srcDims.width === 0 || srcDims.height === 0) {
    return { ok: false, reason: 'decode_failed' };
  }
  const dims = fitWithin(srcDims, MAX_DIM);

  // Decide output mime.
  // PNG with alpha → keep PNG (transparency matters); else → JPEG.
  // WEBP → keep WEBP. JPEG → keep JPEG.
  let outMime: RouteDumpImageMime;
  if (input.type === 'image/png') {
    outMime = pngHasAlpha(img) ? 'image/png' : 'image/jpeg';
  } else {
    outMime = input.type as RouteDumpImageMime;
  }

  // First-pass encode.
  let blob: Blob;
  try {
    blob = await drawAndEncode(img, dims, outMime, Q_HIGH);
  } catch {
    return { ok: false, reason: 'decode_failed' };
  }
  let b64 = await blobToBase64(blob);

  if (!withinBudget(b64).ok) {
    // PNG can't be re-quality-stepped; drop to JPEG at low quality.
    const retryMime: RouteDumpImageMime =
      outMime === 'image/png' ? 'image/jpeg' : outMime;
    try {
      blob = await drawAndEncode(img, dims, retryMime, Q_LOW);
    } catch {
      return { ok: false, reason: 'decode_failed' };
    }
    b64 = await blobToBase64(blob);
    if (!withinBudget(b64).ok) {
      return { ok: false, reason: 'too_large' };
    }
    return { ok: true, image: { mime: retryMime, data: b64 } };
  }

  return { ok: true, image: { mime: outMime, data: b64 } };
}
