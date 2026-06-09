/**
 * OpenRouter text-completion client for JSON-mode classification.
 *
 * Fourth tier in the brain-dump router's provider cascade
 * (Groq → Cloudflare → Gemini → OpenRouter). OpenRouter is OpenAI-compatible
 * and exposes many FREE models behind a single key (`:free` suffix), so one
 * signup buys a deep, diverse backstop. We pin a Llama-class free model so the
 * existing prompt behaves consistently with the Groq primary.
 *
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 * Auth:     Bearer <OPENROUTER_API_KEY>  (Worker secret; never client-shipped)
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';

/** Error thrown when OpenRouter returns a non-2xx. `status` mirrors the
 *  Groq/Gemini contract so the cascade treats 429/5xx as recoverable. */
export type OpenRouterHttpError = Error & { status?: number };

export interface OpenRouterJsonOpts {
  apiKey: string;
  system: string;
  user: string;
  maxTokens?: number;
}

/**
 * Single JSON-mode completion via OpenRouter. Returns the raw JSON string;
 * the caller parses it. Throws OpenRouterHttpError (with `.status`) on a
 * non-2xx response.
 */
export async function openRouterJson(opts: OpenRouterJsonOpts, label: string): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
      // OpenRouter asks for these for attribution; harmless if omitted.
      'http-referer': 'https://ollieapp.workers.dev',
      'x-title': 'Ollie',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      temperature: 0,
      max_tokens: opts.maxTokens ?? 1024,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`${label} openrouter ${res.status}: ${detail.slice(0, 300)}`) as OpenRouterHttpError;
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) {
    throw new Error(`${label} openrouter returned empty content`);
  }
  return text;
}
