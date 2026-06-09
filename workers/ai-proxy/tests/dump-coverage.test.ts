/**
 * dump-coverage.test.ts — MOCK-ONLY regression suite for the Layer 1 brain-dump classifier.
 *
 * SPLIT-FILE RATIONALE (Approach A): vi.mock is statically hoisted regardless of any
 * `if (!LIVE)` guard, so the mock would clobber real Groq calls. The live variant lives
 * in dump-coverage.live.test.ts which contains zero vi.mock calls and uses
 * describe.skipIf(!LIVE) to no-op unless DUMP_COVERAGE_LIVE=1 is set.
 *
 * HOW TO RUN
 *   cd workers/ai-proxy
 *   pnpm test -- dump-coverage         # both files; live one auto-skips
 *   pnpm test -- dump-coverage.test    # this file only
 *
 * WHAT IT TESTS
 *   - Every fixture in tests/dump-fixtures.ts runs through `classifyFragment`.
 *   - The Groq HTTP call is replaced with a deterministic lookup keyed on
 *     fragment text → expected classification (also defined in the fixture
 *     file). The classifier code itself is exercised end-to-end (prompt
 *     assembly + JSON parse + payload assembly), only the network is mocked.
 *
 * EXPECTED PASS RATE
 *   - Target: 100% with the mock. Any failure means the classifier wrapper
 *     code (NOT the model) regressed — payload shape, action-to-payload
 *     plumbing, confidence handling, or the empty-content / bad-JSON
 *     branches.
 *
 * WHAT FAILURES MEAN
 *   - module mismatch        → prompt is mis-routing; tighten the
 *                              disambiguation hint or move the action into a
 *                              different module.
 *   - action mismatch        → action vocabulary for the chosen module is
 *                              ambiguous; split or rename actions.
 *   - missing payload key    → the action's REQUIRED slot isn't being
 *                              extracted; add an example or sharpen the
 *                              required-key wording in the prompt.
 *   - low confidence         → fragment is genuinely ambiguous; verify it
 *                              still lands in dump_only via
 *                              applyConfidencePolicy (separate concern).
 *
 * SCOPE NOTE
 *   This test does NOT cover applyConfidencePolicy (dump-schema.ts) — see
 *   dump.test.ts for the smoke-level confidence-tier behaviour. Crisis
 *   fragments in the edge-case block are tested only at the classifier
 *   level; the upstream crisis lexicon catches them before classifyFragment
 *   runs in production.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyFragment } from '../src/router/dump-classify';
import type { FragmentLanguage } from '../src/router/dump-schema';
import { DUMP_FIXTURES, EXPECTED_FIXTURE_COUNT, fixturesByPair } from './dump-fixtures';

// ─── mocks ──────────────────────────────────────────────────────────────────
// Replace groqChat with a fixture-keyed lookup. Whatever fragment text we pass
// to classifyFragment, we look up the matching expected classification and
// return it as if Groq produced it.
vi.mock('../src/groq', () => {
  return {
    groqChat: vi.fn(async (opts: { messages: { role: string; content: string }[] }) => {
      // The user message is the second message: "Fragment language: X\nFragment: <text>"
      const userMessage = opts.messages.find((m) => m.role === 'user');
      const userContent = userMessage?.content ?? '';
      const match = userContent.match(/^Fragment language: \S+\nFragment: ([\s\S]+)$/);
      const fragmentText = match?.[1] ?? userContent;

      const fixture = DUMP_FIXTURES.find((f) => f.text === fragmentText);
      if (!fixture) {
        // Fall back to dump_only so the test reports a missing-fixture failure
        // through the assertion, not through an unrelated parse exception.
        return {
          message: {
            content: JSON.stringify({
              module: 'dump_only',
              action: 'archive_only',
              confidence: 0.5,
              payload: { reason: 'no_module_match', _testMiss: fragmentText },
            }),
          },
          finish_reason: 'stop',
        };
      }

      return {
        message: {
          content: JSON.stringify({
            module: fixture.expected.module,
            action: fixture.expected.action,
            confidence: fixture.expected.confidence ?? 0.9,
            payload: fixture.expected.payload,
          }),
        },
        finish_reason: 'stop',
      };
    }),
  };
});

// ─── per-fixture assertions ─────────────────────────────────────────────────

const FAKE_API_KEY = 'gsk-test-stub';

function detectLang(text: string): FragmentLanguage {
  if (/[ığüşöçİĞÜŞÖÇ]/.test(text)) return 'tr';
  if (/[¿¡áéíóúñ]/.test(text)) return 'es';
  return 'en';
}

describe('dump-coverage · Layer 1 classifier regression (mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(`fixture file declares ${EXPECTED_FIXTURE_COUNT} fixtures (>= 550 target)`, () => {
    expect(EXPECTED_FIXTURE_COUNT).toBeGreaterThanOrEqual(550);
    expect(DUMP_FIXTURES.length).toBe(EXPECTED_FIXTURE_COUNT);
  });

  it('every (module, action) pair has at least 5 fixtures', () => {
    const pairs = fixturesByPair();
    const thin: string[] = [];
    for (const [key, list] of pairs) {
      // streak_break_note is intentionally tested by re-routing fragments, so
      // it can legitimately have 0 direct fixtures. Crisis pairs are upstream-only.
      if (key === 'habits.streak_break_note') continue;
      if (list.length < 5) thin.push(`${key} (${list.length})`);
    }
    if (thin.length > 0) {
      throw new Error(`Underfilled pairs: ${thin.join(', ')}`);
    }
  });

  describe('per-fixture classification', () => {
    for (const fixture of DUMP_FIXTURES) {
      it(`"${fixture.text}" → ${fixture.expected.module}.${fixture.expected.action}`, async () => {
        const lang = detectLang(fixture.text);
        const result = await classifyFragment(fixture.text, lang, FAKE_API_KEY);

        // module + action
        expect(result.module).toBe(fixture.expected.module);
        expect(result.payload.action).toBe(fixture.expected.action);

        // required payload keys present
        for (const key of fixture.expected.payloadKeys) {
          expect(
            Object.prototype.hasOwnProperty.call(result.payload, key),
            `payload missing required key "${key}" — got ${JSON.stringify(result.payload)}`,
          ).toBe(true);
        }

        // confidence: exact match (mock returns fixture value verbatim)
        const expectedConfidence = fixture.expected.confidence ?? 0.9;
        expect(result.confidence).toBeCloseTo(expectedConfidence, 5);
      });
    }
  });
});
