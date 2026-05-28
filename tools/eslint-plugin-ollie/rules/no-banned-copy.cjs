/**
 * eslint-plugin-ollie · no-banned-copy
 *
 * AST-based replacement for the hand-rolled tools/scan-banned-phrases.cjs
 * lexer. Visits string literals, template-literal chunks, and JSX text and
 * runs the SHARED rule table from tools/banned-phrases.cjs — that file stays
 * the single source of truth for the regexes; this rule does not duplicate
 * them.
 *
 * Why an AST rule beats the old lexer:
 *   - JSXText is a distinct node type, so disavowal copy like
 *       no “we miss you”, no streaks
 *     can never be mis-parsed as a string literal again (the curly-quote
 *     NotificationPrimer false-positive). JSX text IS still user-facing copy
 *     and is still scanned — but it is scanned as what it actually is.
 *   - Comments are skipped for free; the parser never hands them to us.
 *   - Node line numbers come from the real AST, so the `notif-scope-allow`
 *     allowlist and the push-scope window resolve precisely.
 *
 * Scope model (parity with the legacy scanner):
 *   - Global bans apply to every user-facing string in non-test files.
 *   - Push-scope bans apply additionally to strings within CTX_WINDOW lines
 *     below a notification-template marker (CTX_OPEN).
 *   - Test files (*.test.* / *.spec.* / under a tests/ dir) are exempt from
 *     ALL literal bans — tests quote banned words to assert against them.
 *   - `// notif-scope-allow` on the node's line or up to 3 lines above
 *     suppresses the report (used sparingly — see CLAUDE.md).
 */

'use strict';

const path = require('path');
const { scanForBanned } = require('../../banned-phrases.cjs');

// Notification-context opener — copied verbatim from the legacy scanner so
// push-scope detection stays byte-identical. If this list changes, change it
// in lockstep with any historical baseline.
const CTX_OPEN =
  /(NUDGE_TEMPLATES|notificationTemplates|pushTemplates|reminderTemplates|nudgeEngine|nudge_templates|push_templates|notif_templates|sendNotification|new\s+Notification\s*\(|invoke\(['"](show_notification|notify)|notification\s*[:=]\s*\{|push\s*[:=]\s*\{|reminder\s*[:=]\s*\{|nag\s*[:=]\s*['"`]|nudge\s*[:=]\s*['"`]|emit\(['"]void:reminder:scheduled['"]|emit\(['"]void:reminder:fired['"]|\bnotify\s*\(\s*\{|\bawait\s+notify\s*\(|@ollie\/notifications|installCapacitorBackend|installElectronBackend|installWebBackend)/i;
const CTX_WINDOW = 30;

/** Test files are exempt from every literal ban. */
function isTestFile(filename) {
  const rel = filename.split(path.sep).join('/');
  return (
    /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(rel) || /(^|\/)tests?\//.test(rel)
  );
}

/** Build a boolean mask: line N (1-based) is inside a push context. */
function buildContextMask(lines) {
  const mask = new Array(lines.length + 1).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (CTX_OPEN.test(lines[i])) {
      for (let j = i; j < Math.min(i + CTX_WINDOW, lines.length); j++) {
        mask[j + 1] = true; // store 1-based
      }
    }
  }
  return mask;
}

/** `// notif-scope-allow` on the line or up to 3 lines above (1-based line). */
function hasAllowComment(lines, line) {
  for (let i = line; i >= Math.max(1, line - 3); i--) {
    if (/notif-scope-allow/i.test(lines[i - 1] ?? '')) return true;
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid voice-library banned phrases in user-facing copy (string literals, template literals, JSX text).',
      recommended: true,
    },
    schema: [],
    messages: {
      banned: "banned copy [{{source}}/{{id}}] — {{why}}. fix: quiet, functional copy, or delete.",
    },
  },

  create(context) {
    const filename = context.filename || context.getFilename();

    // Test files: skip the whole file. Tests legitimately quote banned words.
    if (isTestFile(filename)) {
      return {};
    }

    const sourceCode = context.sourceCode || context.getSourceCode();
    const lines = sourceCode.lines;
    const ctxMask = buildContextMask(lines);

    /**
     * Report every banned hit found in `text`, attributed to `node`.
     * Push-scope bans run only when the node sits in a notification context.
     */
    function check(node, text) {
      if (!text || !text.trim()) return;

      const line = node.loc.start.line;
      if (hasAllowComment(lines, line)) return;

      const inPushCtx = ctxMask[line] === true;
      // Global bans always; push-scope bans only inside a notification window.
      const scopes = inPushCtx ? ['push'] : [];
      const hits = scanForBanned(text, scopes);

      for (const h of hits) {
        context.report({
          node,
          messageId: 'banned',
          data: { source: h.source, id: h.id, why: h.why },
        });
      }
    }

    return {
      // Plain string literals: 'foo', "bar". Numbers/regex/bigint are Literal
      // nodes too — only strings carry a `.value` of type string.
      Literal(node) {
        if (typeof node.value === 'string') {
          check(node, node.value);
        }
      },

      // Template literals: scan each static chunk. ${...} interpolations are
      // separate Expression nodes and are intentionally not concatenated, so
      // a phrase split across an interpolation boundary is not matched —
      // identical to the legacy scanner, which preserved `${}` as literal
      // text and never reached across it.
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw ?? '');
      },

      // JSX text — the false-positive class the old lexer got wrong. This is
      // genuine user-facing copy so it IS scanned, but as JSXText, never
      // mistaken for a string literal. Curly quotes carry no lexer meaning.
      JSXText(node) {
        check(node, node.value);
      },
    };
  },
};

module.exports = rule;
