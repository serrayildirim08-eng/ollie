/**
 * Shared free-tier JSON provider cascade.
 *
 * Both router stages that need a structured JSON answer — pass-2 segmentation
 * and per-fragment classification — run their prompt through the SAME ordered
 * cascade so a single provider hiccup never silently degrades the result:
 *
 *   Groq (fastest, 8k TPM) → Cloudflare Workers AI (same-platform, no key)
 *     → Gemini 2.5 Flash (~250k TPM) → OpenRouter (catch-all)
 *
 * A provider advances to the next when it (a) throws (429/503/5xx/network) OR
 * (b) returns text that the caller's `parse` rejects — e.g. Groq's
 * `json_validate_failed` 400, or a truncated/empty body. Stacking four free
 * tiers makes the chain effectively un-exhaustable; only the LAST provider's
 * error bubbles up so the caller can map a final 429/503 to a soft
 * "rate_limited" rather than an alarming 502.
 *
 * Before this helper existed, pass-2 segmentation called Groq directly with no
 * fallback: a Groq `json_validate_failed` made it throw, the dump handler fell
 * back to the UNSPLIT pass-1 fragment, and a multi-topic dump collapsed to a
 * single classification — silent data loss (dogfood B3, 2026-06-05).
 */

import { groqChat } from '../groq';
import { geminiJson } from '../gemini';
import { cloudflareJson, type CfAiBinding } from '../cloudflare-ai';
import { openRouterJson } from '../openrouter';

export interface JsonProviders {
  /** Groq API key — primary (fastest). Required. */
  groq: string;
  /** Gemini API key — high-TPM fallback (~250k tokens/min). */
  gemini?: string;
  /** Cloudflare Workers AI binding — same-platform fallback, no key, ~10k/day. */
  cfAI?: CfAiBinding;
  /** OpenRouter API key — final catch-all (one key → many free models). */
  openrouter?: string;
}

export interface JsonCascadeOpts {
  system: string;
  user: string;
  maxTokens: number;
  /** Stable label for the `ai_call` metric + fallthrough logs (e.g. 'pass2'). */
  label: string;
}

/**
 * Run a system+user JSON prompt through the provider cascade. Returns the
 * `parse`d result of the first provider whose call succeeds AND whose output
 * `parse` accepts. `parse` receives the raw text + provider name and should
 * THROW to reject (advancing the cascade); its thrown message surfaces if it
 * was the last provider.
 */
export async function jsonCascade<T>(
  opts: JsonCascadeOpts,
  providers: JsonProviders,
  parse: (rawText: string, provider: string) => T,
): Promise<T> {
  const { system, user, maxTokens, label } = opts;

  const chain: Array<{ name: string; run: () => Promise<string> }> = [
    {
      name: 'groq',
      run: async () => {
        const choice = await groqChat(
          {
            apiKey: providers.groq,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            jsonMode: true,
            maxTokens,
          },
          label,
        );
        const rawText = choice.message.content ?? '';
        if (!rawText) {
          throw new Error(`${label} groq empty content (finish=${choice.finish_reason})`);
        }
        return rawText;
      },
    },
  ];
  if (providers.cfAI) {
    const cf = providers.cfAI;
    chain.push({
      name: 'cloudflare',
      run: () => cloudflareJson(cf, { system, user, maxTokens }, label),
    });
  }
  if (providers.gemini) {
    const key = providers.gemini;
    chain.push({
      name: 'gemini',
      run: () => geminiJson({ apiKey: key, system, user, maxTokens }, label),
    });
  }
  if (providers.openrouter) {
    const key = providers.openrouter;
    chain.push({
      name: 'openrouter',
      run: () => openRouterJson({ apiKey: key, system, user, maxTokens }, label),
    });
  }

  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const isLast = i === chain.length - 1;
    try {
      const rawText = await provider.run();
      return parse(rawText, provider.name);
    } catch (err) {
      lastErr = err;
      if (isLast) throw err;
      console.error(`[${label}] ${provider.name} failed, falling through to next provider`, err);
    }
  }
  throw lastErr;
}
