/**
 * Thin Gemini text-completion client for JSON-mode classification.
 *
 * Used as the FREE-TIER FALLBACK for the brain-dump router when Groq returns
 * 429 (Groq's free tier caps at 8k tokens/min). Gemini 2.5 Flash free tier
 * gives 250k TPM — ~31× Groq's — so it absorbs the overflow without a paid
 * Groq Dev Tier. The trade-off is a 250 requests/day cap, fine for dogfood.
 *
 * Vision uses the same key + endpoint (see router/vision.ts); this is the
 * text-only sibling. JSON mode via generationConfig.responseMimeType.
 *
 * Endpoint: https://generativelanguage.googleapis.com/v1beta/models
 * Auth:     x-goog-api-key: <GEMINI_API_KEY> header (Worker secret; never
 *           client-shipped). Sent as a header, NOT a ?key= query param, so the
 *           key cannot leak into request logs / proxy access logs (audit #6).
 */

import { fetchWithTimeout, UPSTREAM_TIMEOUT_MS } from './fetch-timeout';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Error thrown when Gemini returns a non-2xx. `status` carries the HTTP code
 *  so callers can distinguish 429 (rate limit) from a genuine failure — same
 *  contract as GroqHttpError. */
export type GeminiHttpError = Error & { status?: number };

export interface GeminiJsonOpts {
  apiKey: string;
  /** System instruction (the shared classifier knowledge base). */
  system: string;
  /** User turn (the fragment list + output-shape instruction). */
  user: string;
  maxTokens?: number;
}

/**
 * Single JSON-mode completion against Gemini Flash. Returns the raw JSON
 * string from the first candidate; the caller parses it. Throws
 * GeminiHttpError (with `.status`) on a non-2xx response.
 */
export async function geminiJson(opts: GeminiJsonOpts, label: string): Promise<string> {
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: opts.maxTokens ?? 1024,
      responseMimeType: 'application/json',
      // Gemini 2.5 Flash enables "thinking" by default; those tokens are drawn
      // from maxOutputTokens and would truncate the JSON answer to nothing.
      // We don't need reasoning for structured classification — disable it.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  // Gemini's free tier returns transient 429 (rate) / 503 (model overloaded)
  // under load; a single short backoff clears most of them (vision.ts does
  // the same). One retry only — we're already a fallback, don't stack latency.
  // Per-call timeout (audit S2 · fix 3): bound each Gemini call so a stalled
  // fallback can't hold the Worker for the full 30s wall. A timeout throws a
  // typed UpstreamTimeoutError the cascade handles like any provider failure.
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify(body),
  };
  let res = await fetchWithTimeout(url, init, UPSTREAM_TIMEOUT_MS.gemini, label);
  if (res.status === 429 || res.status === 503) {
    await new Promise((r) => setTimeout(r, 900));
    res = await fetchWithTimeout(url, init, UPSTREAM_TIMEOUT_MS.gemini, label);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`${label} gemini ${res.status}: ${detail.slice(0, 300)}`) as GeminiHttpError;
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();

  if (!text) {
    throw new Error(`${label} gemini returned empty content`);
  }
  return text;
}
