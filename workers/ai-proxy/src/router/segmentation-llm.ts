/**
 * Pass-2 segmentation · gpt-oss-120b with JSON mode (Decision C), run through
 * the shared free-tier provider cascade (Groq → Cloudflare → Gemini →
 * OpenRouter).
 *
 * Sent only for fragments that pass-1 flagged via Decision A trigger:
 *   - words > 7  OR
 *   - (words > 4 AND no conjunctions AND no terminal punctuation)
 *
 * Output is a JSON object `{ fragments: string[] }` — JSON mode requires an
 * object root, so we wrap the array. A bad shape / `json_validate_failed`
 * from one provider advances the cascade instead of collapsing the dump;
 * only if EVERY provider fails does this throw to the dump handler, which
 * then falls back to the unsplit pass-1 fragment. (Pre-cascade, pass-2 hit
 * Groq alone and a single `json_validate_failed` silently collapsed
 * multi-topic dumps to one fragment — dogfood B3, 2026-06-05.)
 *
 * Cache: pass-2 output is NEVER cached. Only the final classification
 * downstream goes to Vectorize.
 */

import { jsonCascade, type JsonProviders } from './json-cascade';

const SYSTEM_PROMPT = `You split a long, weakly-punctuated user dump into discrete action units.

Input may mix Turkish, English, and Spanish within a single fragment, sometimes within a single sentence (e.g. "compré pasta and email boran"). Split based on intent boundaries, not language boundaries — do not paraphrase, do not translate, do not refuse on the basis of mixed language.

Respond with a JSON object EXACTLY of the form:
{ "fragments": ["...", "..."] }

Each element is one intent unit (e.g. "compré pasta", "email boran", "tırnağı uzamış"). Preserve the user's wording verbatim. Do not add explanations.`;

export async function pass2Split(text: string, providers: JsonProviders): Promise<string[]> {
  // maxTokens 1024 (was 512): a long run-on dump split into many verbatim
  // fragments can exceed 512 output tokens, and a truncated body is exactly
  // what trips Groq's `json_validate_failed`. More headroom = fewer truncation
  // failures before the cascade even has to fall through.
  return jsonCascade(
    { system: SYSTEM_PROMPT, user: text, maxTokens: 1024, label: 'pass2' },
    providers,
    (rawText, provider) => {
      let parsed: { fragments?: unknown };
      try {
        parsed = JSON.parse(rawText) as { fragments?: unknown };
      } catch {
        throw new Error(`pass2 ${provider} bad json: ${rawText.slice(0, 200)}`);
      }

      const arr = parsed?.fragments;
      if (!Array.isArray(arr) || !arr.every((s) => typeof s === 'string')) {
        throw new Error(`pass2 ${provider} returned non-string-array: ${rawText.slice(0, 200)}`);
      }
      return arr.map((s) => s.trim()).filter((s) => s.length >= 2);
    },
  );
}
