/**
 * Cloudflare Workers AI client for JSON-mode classification.
 *
 * Third tier in the brain-dump router's provider cascade (Groq → Gemini → CF).
 * Runs ON the same Cloudflare platform the worker already lives on, so there's
 * NO API key to manage, the lowest possible latency (no external egress), and
 * a free allocation of ~10k neurons/day. Model: Llama 3.3 70B fp8-fast.
 *
 * Binding: declared as `[ai] binding = "AI"` in wrangler.toml → env.AI.
 */

const CF_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Error thrown when Workers AI fails. `status` mirrors the Groq/Gemini
 *  contract so the cascade can treat it as recoverable (advance to next
 *  provider) the same way. Workers AI exhaustion surfaces as a thrown error
 *  rather than an HTTP status, so we tag it 429 to mean "recoverable". */
export type CfAiError = Error & { status?: number };

/** Minimal shape of the Workers AI binding (avoids a hard dep on
 *  @cloudflare/workers-types). `run` returns `{ response }` for chat models. */
export interface CfAiBinding {
  run(
    model: string,
    inputs: {
      messages: Array<{ role: string; content: string }>;
      max_tokens?: number;
      temperature?: number;
    },
  ): Promise<{ response?: unknown } | string>;
}

/** Strip ```json … ``` fences some models wrap JSON in, returning the inner
 *  payload so JSON.parse downstream succeeds. */
function unfence(text: string): string {
  const t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : t;
}

/**
 * Single JSON-mode completion via Workers AI. Returns the raw JSON string;
 * the caller parses it. Throws CfAiError (tagged recoverable) on failure.
 */
export async function cloudflareJson(
  ai: CfAiBinding,
  opts: { system: string; user: string; maxTokens?: number },
  label: string,
): Promise<string> {
  let out: { response?: unknown } | string;
  try {
    out = await ai.run(CF_MODEL, {
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      max_tokens: opts.maxTokens ?? 1024,
      temperature: 0,
    });
  } catch (e) {
    // Quota / overload / transient — tag recoverable so the cascade advances.
    const err = new Error(`${label} cloudflare-ai: ${(e as Error)?.message ?? e}`) as CfAiError;
    err.status = 429;
    throw err;
  }

  // Workers AI returns `{ response: string }` for most chat models, but some
  // hand back `response` as an already-parsed object — stringify so the
  // caller's JSON.parse round-trips either way.
  const raw = typeof out === 'string' ? out : out.response;
  const text =
    typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? JSON.stringify(raw) : '';
  if (!text.trim()) {
    throw new Error(`${label} cloudflare-ai returned empty content`);
  }
  return unfence(text);
}
