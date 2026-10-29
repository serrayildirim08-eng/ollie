/**
 * ask.live.test.ts — the Ask Ollie golden set against the LIVE model (Groq), exactly as the route
 * runs it: PII scrub first, then findQuestions. No vi.mock in this file; it no-ops unless ASK_LIVE=1.
 *
 * HOW TO RUN
 *   cd workers/ai-proxy
 *   ASK_LIVE=1 GROQ_API_KEY=$(grep -E '^GROQ_API_KEY=' .dev.vars | cut -d= -f2-) pnpm exec vitest run tests/ask.live
 *
 * PASS BARS (Ask Ollie plan, methodology section)
 *   - questions understood (right shape, area, period, required filters): at least 90%
 *   - log / question mix-ups: 0
 * A rate-limited call is retried up to 3 times with growing, jittered waits before it counts.
 */
import { describe, expect, it, vi } from 'vitest';
import { asLocale, scrubPII } from '@ollie/pii-scrub';
import { findQuestions, type AskedQuestion } from '../src/router/ask';
import { ASK_GOLDEN, type AskGolden } from './ask-golden';

const LIVE = process.env.ASK_LIVE === '1';
const KEY = process.env.GROQ_API_KEY ?? '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** findQuestions swallows provider failures (a safe product default); here a failure must be retried, not scored. */
async function askLive(scrubbed: string): Promise<AskedQuestion[]> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await findQuestions([scrubbed], { groq: KEY });
    const failed = warn.mock.calls.some((c) => String(c[0]).includes('ask detection failed'));
    warn.mockRestore();
    if (!failed) return result;
    await sleep(2 ** attempt * 8000 + Math.random() * 2000);
  }
  throw new Error('model unreachable after 3 retries');
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

interface Verdict {
  id: string;
  ok: boolean;
  mixUp: boolean;
  got: string;
}

function judge(g: AskGolden, scrubbed: string, got: AskedQuestion[]): Verdict {
  const found = got.find((x) => x.index === 0);
  const gotText = found ? JSON.stringify({ lang: found.lang, query: found.query }) : 'log';
  if (g.expect.kind === 'log') {
    return { id: g.id, ok: !found, mixUp: Boolean(found), got: gotText };
  }
  if (!found) return { id: g.id, ok: false, mixUp: true, got: gotText };
  const e = g.expect;
  if (e.shape === null) return { id: g.id, ok: found.query === null, mixUp: false, got: gotText };
  const qy = found.query;
  let ok = Boolean(qy) && qy?.shape === e.shape && found.lang === g.lang;
  if (ok && e.area) ok = qy?.area === e.area;
  if (ok && e.period !== undefined) ok = (qy?.period ?? null) === e.period;
  if (ok && e.filter) {
    for (const [key, value] of Object.entries(e.filter)) {
      const actual = norm(qy?.filter[key]);
      if (key === 'status') {
        ok = ok && actual === value;
      } else if (value === '[NAME]') {
        // A name: scrubbed ("[NAME]") or, when the scrubber missed it, as typed. The phone resolves both.
        ok = ok && actual.length > 0;
      } else if (!norm(scrubbed).includes(norm(value))) {
        // The scrubber hid this value; the phone puts the real one back (ask/names.ts).
        ok = ok && actual.includes('[');
      } else {
        ok = ok && actual.includes(norm(value));
      }
    }
  }
  return { id: g.id, ok, mixUp: false, got: gotText };
}

describe.skipIf(!LIVE)('Ask Ollie golden set, live', () => {
  it(
    'understands at least 90% of questions and never mixes up a log and a question',
    async () => {
      const verdicts: Verdict[] = [];
      for (const g of ASK_GOLDEN) {
        const { scrubbed } = scrubPII(g.text, asLocale(g.lang));
        verdicts.push(judge(g, scrubbed, await askLive(scrubbed)));
        await sleep(1500); // stay under the free tier's tokens per minute
      }
      const questions = ASK_GOLDEN.filter((g) => g.expect.kind === 'question');
      const understood = verdicts.filter((v, i) => ASK_GOLDEN[i]?.expect.kind === 'question' && v.ok).length;
      const mixUps = verdicts.filter((v) => v.mixUp);
      const misses = verdicts.filter((v) => !v.ok);
      process.stdout.write(
        `\nASK GOLDEN: ${String(understood)}/${String(questions.length)} questions understood, ` +
          `${String(mixUps.length)} log/question mix-ups, ${String(misses.length)} misses in total\n` +
          misses.map((m) => `  MISS ${m.id}: got ${m.got}`).join('\n') +
          '\n',
      );
      expect(mixUps.map((m) => m.id)).toEqual([]);
      expect(understood / questions.length).toBeGreaterThanOrEqual(0.9);
    },
    60 * 60 * 1000,
  );
});
