/**
 * eslint-plugin-ollie · no-banned-copy · RuleTester suite
 *
 * Run via `node --test tools/eslint-plugin-ollie/rules/` (see CI + the
 * plugin's package.json `test` script).
 *
 * Coverage:
 *   - global bans on string literals + template literals
 *   - push-scope bans only inside a notification-context window
 *   - test-file exemption (the rule short-circuits on test paths)
 *   - JSXText scanning + the curly-quote false-positive class the old
 *     hand-rolled lexer got wrong (NotificationPrimer disavowal copy)
 *   - the `// notif-scope-allow` allowlist
 *
 * The parser is typescript-eslint's parser so .ts/.tsx + JSX all parse.
 */

'use strict';

const { test } = require('node:test');
const { RuleTester } = require('eslint');
const tseslint = require('typescript-eslint');

const rule = require('./no-banned-copy.cjs');
const { GLOBAL_BANS, SCOPED_BANS } = require('../../banned-phrases.cjs');

// Build the expected report `data` straight from the shared rule table —
// the test never re-types a `why` string, so banned-phrases.cjs stays the
// single source of truth (RuleTester needs full data to interpolate the
// message template it compares against).
const BAN_INDEX = new Map();
for (const b of GLOBAL_BANS) BAN_INDEX.set(b.id, { source: 'global', why: b.why });
for (const [scope, list] of Object.entries(SCOPED_BANS)) {
  for (const b of list) {
    if (!BAN_INDEX.has(b.id)) BAN_INDEX.set(b.id, { source: scope, why: b.why });
  }
}

/** Expected RuleTester error for a given ban id. */
function err(id) {
  const meta = BAN_INDEX.get(id);
  if (!meta) throw new Error(`unknown ban id in test: ${id}`);
  return { messageId: 'banned', data: { id, source: meta.source, why: meta.why } };
}

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
});

// RuleTester throws synchronously on the first failing case. Wrapping the
// whole run in one node:test `test()` keeps it in the same harness as
// banned-phrases.test.cjs and gives a clean pass/fail line.
test('ollie/no-banned-copy · RuleTester', () => {
  ruleTester.run('no-banned-copy', rule, {
    valid: [
      // ── clean copy, ordinary source file ──────────────────────────────
      {
        filename: 'apps/web/src/components/Bill.tsx',
        code: `const msg = 'rent is due in 3 days. just saying.';`,
      },
      {
        filename: 'apps/web/src/lib/copy.ts',
        code: 'const msg = `toilet paper szn approaching. adding to your list.`;',
      },
      // ── numeric / non-string literals must not be scanned ─────────────
      {
        filename: 'apps/web/src/lib/n.ts',
        code: 'const n = 42; const ok = true; const r = /streak/;',
      },
      // ── test-file exemption: a *.test.* file may quote banned words ───
      {
        filename: 'apps/web/src/lib/copy.test.ts',
        code: `expect(out).not.toContain('streak'); const s = 'great job';`,
      },
      // ── *.spec.* and tests/ dir are exempt too ────────────────────────
      {
        filename: 'packages/orchestrator/src/nudge.spec.ts',
        code: `const fixture = 'we miss you, come back';`,
      },
      {
        filename: 'apps/web/src/tests/fixtures.ts',
        code: `const fixture = 'burhan is sad';`,
      },
      // ── exclamation outside a push context is fine (global only) ──────
      {
        filename: 'apps/web/src/pages/Settings.tsx',
        code: `const heading = 'rent is due!';`,
      },
      // ── JSXText false-positive class: ordinary JSX prose, no ban ──────
      {
        filename: 'apps/web/src/components/Intro.tsx',
        code: `export const I = () => <p>ollie sends a notification only when something needs you.</p>;`,
      },
      // ── the NotificationPrimer incident: disavowal copy in JSX text.
      //    The old lexer mis-read the curly quotes as a string literal.
      //    Here it parses as JSXText; the notif-scope-allow comment 2 lines
      //    above suppresses the (legitimate) "we miss you" + "streak" hits.
      {
        filename: 'apps/web/src/components/NotificationPrimer.tsx',
        code: [
          'export const Primer = () => (',
          '  <div>',
          '    {/* notif-scope-allow — quotes "we miss you" only to disavow it;',
          '        anti-dark-pattern priming text, not an engagement push. */}',
          '    <p>no “we miss you”, no streaks, no guilt, no nudging you back.</p>',
          '  </div>',
          ');',
        ].join('\n'),
      },
      // ── allowlist on the same line as a string literal ────────────────
      {
        filename: 'packages/api/src/answers.ts',
        code: `const reply = 'you matter to us'; // notif-scope-allow — clinical answer-engine reply`,
      },
    ],

    invalid: [
      // ── global ban · string literal ───────────────────────────────────
      {
        filename: 'apps/web/src/components/Toast.tsx',
        code: `const msg = 'great job today';`,
        errors: [err('great-job')],
      },
      // ── global ban · template literal ────────────────────────────────
      {
        filename: 'apps/web/src/lib/copy.ts',
        code: 'const msg = `keep your streak alive`;',
        // matches both `streak` and `keep-streak`
        errors: [err('streak'), err('keep-streak')],
      },
      // ── global ban · JSX text (the class the old lexer mishandled) ────
      {
        filename: 'apps/web/src/components/ReEngage.tsx',
        code: `export const R = () => <p>we miss you, come back soon</p>;`,
        // order follows GLOBAL_BANS table order: come-back precedes miss-you.
        errors: [err('come-back'), err('miss-you')],
      },
      // ── push scope · exclamation mark inside a notification window ────
      // The pushTemplates marker opens a 30-line push context; the literal
      // below it then gets the push-scope bans (no exclamation in push).
      {
        filename: 'packages/orchestrator/src/nudge.ts',
        code: [
          'const pushTemplates = {',
          "  billDue: 'your rent is due tomorrow!',",
          '};',
        ].join('\n'),
        errors: [err('push-exclaim')],
      },
      // ── push scope · the same exclamation is NOT flagged when no
      //    notification marker is present (proves the window gates it) ──
      // (covered as a `valid` case above: 'rent is due!' in Settings.tsx)
      //
      // ── push scope · emoji celebration inside a notification window ──
      {
        filename: 'apps/web/src/lib/push-register.ts',
        code: [
          "import '@ollie/notifications';",
          "const body = 'all done \u{1F389}';",
        ].join('\n'),
        errors: [err('emoji-celebrate')],
      },
      // ── push scope · global ban still fires inside push context too ──
      {
        filename: 'packages/orchestrator/src/reminder.ts',
        code: [
          'const reminderTemplates = [',
          "  'we miss you',",
          '];',
        ].join('\n'),
        errors: [err('miss-you')],
      },
    ],
  });
});
