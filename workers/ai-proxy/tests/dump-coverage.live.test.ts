/**
 * dump-coverage.live.test.ts — LIVE Groq variant of dump-coverage.test.ts.
 *
 * SPLIT-FILE RATIONALE (Approach A): vi.mock is statically hoisted regardless of
 * runtime guards, so the mock version (dump-coverage.test.ts) cannot conditionally
 * skip mocking. This file contains ZERO vi.mock calls and is gated by
 * describe.skipIf(!LIVE) — it no-ops unless DUMP_COVERAGE_LIVE=1 is set.
 *
 * HOW TO RUN
 *   cd workers/ai-proxy
 *   DUMP_COVERAGE_LIVE=1 GROQ_API_KEY=$(grep -E '^GROQ_API_KEY=' .dev.vars | cut -d= -f2-) \
 *     pnpm test -- dump-coverage.live
 *
 * COST
 *   ~580 Groq Llama 3.3 70B calls per run; est $3-5 total. Sequential by default
 *   (vitest runs `it` cases serially within a describe block). Wall-clock ~10-30 min.
 *
 * INTERPRETATION
 *   - 95%+ pass: classifier prompt is in good shape; misses → prompt tighten
 *   - 80-94%: specific (module, action) pairs need disambiguation
 *   - <80%: prompt or model regressed; investigate before shipping
 *
 *   For dump_only fixtures the LIVE confidence floor is relaxed to >= 0 — the
 *   whole point of dump_only is genuine model uncertainty.
 */

import { describe, expect, it } from 'vitest';
import { classifyFragment, type ClassifyResult } from '../src/router/dump-classify';
import type { FragmentLanguage } from '../src/router/dump-schema';
import { DUMP_FIXTURES } from './dump-fixtures';

const LIVE = process.env.DUMP_COVERAGE_LIVE === '1';
const API_KEY = process.env.GROQ_API_KEY ?? '';

// Groq free-tier TPM is 12k for llama-3.3-70b-versatile. The SYSTEM_PROMPT is
// ~5k tokens, so we can only do ~2 calls/min sustained. We MUST run serially
// (vitest --no-file-parallelism + sequence.concurrent=false) AND retry on 429.
const PER_TEST_TIMEOUT_MS = 120_000; // includes worst-case 429 backoff

/**
 * Retry wrapper for the LIVE Groq path. Honors Retry-After hint embedded in the
 * 429 response body (Groq returns "Please try again in X.Ys"). Test-only — does
 * NOT change production groq.ts behaviour.
 */
async function classifyWithRetry(
  text: string,
  lang: FragmentLanguage,
  apiKey: string,
  attempt = 0,
): Promise<ClassifyResult> {
  try {
    return await classifyFragment(text, lang, apiKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('groq 429') && attempt < 4) {
      const retryMatch = msg.match(/try again in ([\d.]+)s/);
      const waitS = retryMatch ? Math.min(parseFloat(retryMatch[1]!), 30) : 10;
      await new Promise((r) => setTimeout(r, (waitS + 1) * 1000));
      return classifyWithRetry(text, lang, apiKey, attempt + 1);
    }
    throw err;
  }
}

function detectLang(text: string): FragmentLanguage {
  if (/[ığüşöçİĞÜŞÖÇ]/.test(text)) return 'tr';
  if (/[¿¡áéíóúñ]/.test(text)) return 'es';
  return 'en';
}

describe.skipIf(!LIVE)('dump-coverage · Layer 1 classifier regression (LIVE Groq)', () => {
  it('has GROQ_API_KEY in env', () => {
    expect(API_KEY.length).toBeGreaterThan(10);
  });

  describe('per-fixture classification', () => {
    for (const fixture of DUMP_FIXTURES) {
      it(
        `"${fixture.text}" → ${fixture.expected.module}.${fixture.expected.action}`,
        async () => {
          const lang = detectLang(fixture.text);
          const result = await classifyWithRetry(fixture.text, lang, API_KEY);

          // module + action — the only assertions we care about in live mode
          expect(result.module).toBe(fixture.expected.module);
          expect(result.payload.action).toBe(fixture.expected.action);

          // required payload keys present
          for (const key of fixture.expected.payloadKeys) {
            expect(
              Object.prototype.hasOwnProperty.call(result.payload, key),
              `payload missing required key "${key}" — got ${JSON.stringify(result.payload)}`,
            ).toBe(true);
          }

          // confidence: for dump_only fixtures the whole point is uncertainty,
          // so we only assert it's a valid number in [0, 1]. For everything
          // else we assert >= 0.5 — anything lower means the real model is
          // genuinely confused, which is a prompt-repair signal.
          if (fixture.expected.module === 'dump_only') {
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
          } else {
            expect(result.confidence).toBeGreaterThanOrEqual(0.5);
          }
        },
        PER_TEST_TIMEOUT_MS,
      );
    }
  });
});
