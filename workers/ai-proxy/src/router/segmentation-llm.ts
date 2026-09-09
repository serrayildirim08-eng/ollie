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

/** Default bounded concurrency for the pass-2 fan-out. A multi-topic dump
 *  rarely flags more than a handful of fragments for pass-2; 4 in-flight Groq
 *  calls keeps a long dump fast without risking the free-tier rate limit (the
 *  cascade already absorbs a 429 by falling through to Gemini/Cloudflare). */
export const PASS2_CONCURRENCY = 4;

/** Structural subset of `Pass1Fragment` (segmentation.ts) that pass-2 needs. */
export interface Pass2Candidate {
  text: string;
  needsPass2: boolean;
}

/**
 * Run pass-2 LLM splitting for EVERY flagged fragment CONCURRENTLY (bounded),
 * then flatten the results back into a single ordered fragment list.
 *
 * Before S2 · fix 1 the dump handler awaited each flagged fragment's pass-2
 * call one after another, so a dump with N multi-topic fragments paid N × the
 * Groq round-trip (~15–20s on a busy dump). The pass-2 calls are independent,
 * so we fan them out with a small worker pool (default `PASS2_CONCURRENCY`) and
 * the wall-clock collapses to roughly one round-trip.
 *
 * Invariants preserved from the original serial loop:
 *   - OUTPUT ORDER matches input order. results[i] holds fragment i's output
 *     list; we concat in index order regardless of completion order.
 *   - FALLBACK is per-fragment: a pass-2 that throws, OR returns an empty
 *     split, falls back to the unsplit pass-1 text (never drops the fragment).
 *   - `pass2Triggered` counts every flagged fragment (matches the prior
 *     `pass2Triggered++` that fired before the try, i.e. attempts not successes).
 *
 * `splitter` is injectable purely so tests can drive timing/ordering; runtime
 * callers use the default `pass2Split`.
 */
export async function pass2SplitFragments(
  fragments: Pass2Candidate[],
  providers: JsonProviders,
  concurrency: number = PASS2_CONCURRENCY,
  splitter: (text: string, providers: JsonProviders) => Promise<string[]> = pass2Split,
): Promise<{ fragmentsText: string[]; pass2Triggered: number }> {
  // results[i] = the resolved fragment list for input fragment i.
  const results: string[][] = new Array(fragments.length);
  const flagged: number[] = [];

  for (let i = 0; i < fragments.length; i++) {
    if (fragments[i].needsPass2) {
      flagged.push(i);
    } else {
      results[i] = [fragments[i].text];
    }
  }

  // Bounded worker pool over the flagged indices. A shared cursor hands each
  // worker the next index; up to `concurrency` pass-2 calls are in flight.
  let cursor = 0;
  const runWorker = async (): Promise<void> => {
    while (cursor < flagged.length) {
      const idx = flagged[cursor++];
      const frag = fragments[idx];
      try {
        const split = await splitter(frag.text, providers);
        results[idx] = split.length > 0 ? split : [frag.text];
      } catch (err) {
        // Pass-2 failure: fall back to the pass-1 fragment unsplit.
        console.error('[route/dump] pass2 failed, using pass1 fragment', err);
        results[idx] = [frag.text];
      }
    }
  };

  const poolSize = Math.min(concurrency, flagged.length);
  await Promise.all(Array.from({ length: poolSize }, () => runWorker()));

  // Flatten in INPUT order — completion order is irrelevant.
  const fragmentsText: string[] = [];
  for (let i = 0; i < fragments.length; i++) {
    fragmentsText.push(...results[i]);
  }
  return { fragmentsText, pass2Triggered: flagged.length };
}

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
