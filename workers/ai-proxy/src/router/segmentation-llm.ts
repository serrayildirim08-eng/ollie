/**
 * Pass-2 segmentation · Gemini 2.5 Flash with structured output (Decision C).
 *
 * Sent only for fragments that pass-1 flagged via Decision A trigger:
 *   - words > 7  OR
 *   - (words > 4 AND no conjunctions AND no terminal punctuation)
 *
 * Output is a JSON array of strings (one intent unit per element). The
 * `response_schema` enforces shape; no try/catch parse fallback.
 *
 * Cache: pass-2 output is NEVER cached. Only the final classification
 * downstream goes to Vectorize.
 */

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT = `You split a long, weakly-punctuated user dump into discrete action units.

Input may mix Turkish, English, and Spanish within a single fragment, sometimes within a single sentence (e.g. "compré pasta and email boran"). Split based on intent boundaries, not language boundaries — do not paraphrase, do not translate, do not refuse on the basis of mixed language.

Return strictly a JSON array of strings. Each string is one intent (e.g. "compré pasta", "email boran", "tırnağı uzamış"). Preserve the user's wording verbatim. Do not add explanations.`;

const RESPONSE_SCHEMA = {
  type: 'array',
  items: { type: 'string', minLength: 2 },
} as const;

export async function pass2Split(text: string, apiKey: string): Promise<string[]> {
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`pass2 gemini ${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  // Structured output guarantees a JSON array. No try/catch parse — if
  // it fails, the upstream should know and surface the error.
  const arr = JSON.parse(rawText) as unknown;
  if (!Array.isArray(arr) || !arr.every((s) => typeof s === 'string')) {
    throw new Error(
      `pass2 gemini returned non-string-array: ${rawText.slice(0, 200)}`,
    );
  }
  return arr.map((s) => s.trim()).filter((s) => s.length >= 2);
}
