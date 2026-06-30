/**
 * Vision extraction · Gemini Flash 2.5 multimodal.
 *
 * Used by /route/dump when the request carries an `image` field. Returns
 * a terse factual description of what's in the image — receipts, pill
 * bottles, prescriptions, handwritten notes, calendar screenshots, food
 * photos, documents. The output gets prepended to the user's text dump
 * (if any) and the combined string flows through Layer 1 + Layer 2
 * exactly as a normal text dump.
 *
 * Image-only dumps are valid: the vision-extracted text becomes the dump.
 *
 * Cost (Gemini Flash 2.5 pricing, 2026-05):
 *   - Input: $0.075 / M tokens + ~258 tokens per image
 *   - Output: $0.30 / M tokens (capped at 200 maxOutputTokens here)
 *   - Per typical receipt-sized image: ~$0.0001 - $0.0003.
 */

import { fetchWithTimeout, UPSTREAM_TIMEOUT_MS } from '../fetch-timeout';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const VISION_SYSTEM_PROMPT = `You are extracting the brain-dump-relevant facts from this image. Output 1-3 short factual sentences, no commentary, no markdown.

Focus areas (cover what's actually visible — skip what isn't):
- RECEIPT: merchant name, total amount + currency, date if visible, 2-3 line items if relevant
- PILL BOTTLE / PRESCRIPTION: medication name (generic + brand if both), dose, prescriber if visible
- HANDWRITTEN NOTE: transcribe the text verbatim, preserve language (EN/TR/ES)
- CALENDAR / APPOINTMENT SCREENSHOT: date, time, with whom, what
- FOOD / GROCERY photo: item name(s), brand if visible
- DOCUMENT (passport, license, lease): document type + key date (expiry / renewal)

If the image doesn't fit any of these categories or is unintelligible, output exactly: "Image unrelated to known brain-dump categories."`;

export type VisionImageMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'application/pdf';

export interface VisionImage {
  mime: VisionImageMime;
  /** base64-encoded payload, no data: URL prefix. */
  data: string;
}

export interface VisionExtractResult {
  text: string;
  usage: { promptTokens: number; candidatesTokens: number };
}

export async function visionExtract(
  image: VisionImage,
  geminiKey: string,
): Promise<VisionExtractResult> {
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: VISION_SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: image.mime, data: image.data } },
          { text: 'Describe what is in this image per the focus areas above.' },
        ],
      },
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
  };

  // Per-call timeout (audit S2 · fix 3): the vision call is the heaviest dump
  // upstream (image upload + multimodal decode); without a bound a stalled call
  // pinned the Worker for the full 30s. On timeout fetchWithTimeout throws
  // UpstreamTimeoutError, which dump.ts catches → clean 502 vision_failed.
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey },
    body: JSON.stringify(body),
  };
  let res = await fetchWithTimeout(url, init, UPSTREAM_TIMEOUT_MS.vision, 'vision');

  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1000));
    res = await fetchWithTimeout(url, init, UPSTREAM_TIMEOUT_MS.vision, 'vision');
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`vision_failed gemini ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.text ?? '')
    .join(' ')
    .trim();

  if (!text) {
    throw new Error('vision_failed gemini returned empty description');
  }

  return {
    text,
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      candidatesTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

const ALLOWED_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export function isVisionImage(value: unknown): value is VisionImage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.mime === 'string' &&
    ALLOWED_MIMES.has(v.mime) &&
    typeof v.data === 'string' &&
    v.data.length > 0
  );
}

/** Raw-byte size of a base64 payload, without decoding. */
export function base64ByteSize(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}
