/**
 * Pass-2 segmentation · Groq Llama 3.3 70B with JSON mode (Decision C).
 *
 * Sent only for fragments that pass-1 flagged via Decision A trigger:
 *   - words > 7  OR
 *   - (words > 4 AND no conjunctions AND no terminal punctuation)
 *
 * Output is a JSON object `{ fragments: string[] }` — Groq's JSON mode
 * requires an object root, so we wrap the array. No try/catch fallback
 * once parsed: bad shape throws to the dump handler which logs and
 * falls back to the unsplit pass-1 fragment.
 *
 * Cache: pass-2 output is NEVER cached. Only the final classification
 * downstream goes to Vectorize.
 */

import { groqChat } from '../groq';

const SYSTEM_PROMPT = `You split a long, weakly-punctuated user dump into discrete action units.

Input may mix Turkish, English, and Spanish within a single fragment, sometimes within a single sentence (e.g. "compré pasta and email boran"). Split based on intent boundaries, not language boundaries — do not paraphrase, do not translate, do not refuse on the basis of mixed language.

Respond with a JSON object EXACTLY of the form:
{ "fragments": ["...", "..."] }

Each element is one intent unit (e.g. "compré pasta", "email boran", "tırnağı uzamış"). Preserve the user's wording verbatim. Do not add explanations.`;

export async function pass2Split(text: string, apiKey: string): Promise<string[]> {
  const choice = await groqChat(
    {
      apiKey,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      jsonMode: true,
      maxTokens: 512,
    },
    'pass2',
  );

  const rawText = choice.message.content ?? '';
  if (!rawText) {
    throw new Error(`pass2 groq empty content (finish=${choice.finish_reason})`);
  }

  let parsed: { fragments?: unknown };
  try {
    parsed = JSON.parse(rawText) as { fragments?: unknown };
  } catch {
    throw new Error(`pass2 groq bad json: ${rawText.slice(0, 200)}`);
  }

  const arr = parsed?.fragments;
  if (!Array.isArray(arr) || !arr.every((s) => typeof s === 'string')) {
    throw new Error(
      `pass2 groq returned non-string-array: ${rawText.slice(0, 200)}`,
    );
  }
  return arr.map((s) => s.trim()).filter((s) => s.length >= 2);
}
