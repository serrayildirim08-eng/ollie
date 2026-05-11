#!/usr/bin/env node
/**
 * ollie · CI guard · banned-phrase scanner
 *
 * Ported from tools/notification_scope_tests.js (legacy void-app) +
 * design-pitches/handoff/banned-phrases.js. The two were never wired
 * together in legacy; consolidating into one pass here so the build
 * fails on any voice-library violation.
 *
 * Three scan modes, one runner:
 *
 *   1. i18n JSON files (apps/web/src/i18n/strings.*.json):
 *      every leaf string is user-facing copy. apply global bans + push
 *      bans on push-shaped keys.
 *
 *   2. TS/TSX/JS source string literals:
 *      extract single-quote, double-quote, and template-literal
 *      contents. apply global bans.
 *
 *   3. notification-context windows:
 *      lines within 30 lines of a notification template marker
 *      (NUDGE_TEMPLATES, pushTemplates, emit('void:reminder:…'), etc.)
 *      get the extra push-scope bans (exclamation marks, emoji
 *      celebration).
 *
 * Exit:  0 = clean, 1 = banned phrase found.
 * Usage: node tools/scan-banned-phrases.cjs [--quiet]
 *
 * Allowlist: add `// notif-scope-allow` on or just above the offending
 * line. Used twice in legacy void in 18 months — for clinical answer-
 * engine replies. Don't reach for it casually.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { GLOBAL_BANS, SCOPED_BANS, scanForBanned } = require('./banned-phrases.cjs');

const ROOT = path.resolve(__dirname, '..');
const QUIET = process.argv.includes('--quiet');

// ──────────────────────────────────────────────────────────────────────────
// Globs — what to scan
// ──────────────────────────────────────────────────────────────────────────

const SCAN_DIRS = [
  'apps/web/src',
  'apps/desktop/src',
  'packages/logic/src',
  'packages/orchestrator/src',
  'packages/router/src',
  'packages/events/src',
  'packages/store/src',
  'packages/api/src',
];

const SCAN_EXTS_TS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SCAN_EXTS_JSON = new Set(['.json']);

// Files exempt from scanning. They either ARE the rule (so banned phrases
// appear as documentation), or they describe banned patterns.
const EXEMPT_FILES = new Set([
  'tools/banned-phrases.cjs',
  'tools/scan-banned-phrases.cjs',
  'tools/banned-phrases.test.cjs',
  'CLAUDE.md',
  'SCANNER_PORT_DONE.md',
  'SPRINT_3_SUMMARY.md',
]);

// Path fragments to skip entirely.
const SKIP_FRAGMENTS = ['node_modules', 'dist', '.git', '.next', 'build', '__snapshots__', 'coverage'];

// Test files: scanned for global bans, but exempt from notification-context
// bans (test files often reference push templates by name). Identified by
// `.test.` segment or living under a `tests/` dir.
function isTestFile(rel) {
  return /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(rel) || /(^|\/)tests?\//.test(rel);
}

// ──────────────────────────────────────────────────────────────────────────
// Walk + filter
// ──────────────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP_FRAGMENTS.includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function listFiles() {
  const all = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(ROOT, d);
    if (fs.existsSync(abs)) walk(abs, all);
  }
  return all
    .map((abs) => ({ abs, rel: path.relative(ROOT, abs) }))
    .filter(({ rel }) => !EXEMPT_FILES.has(rel))
    .filter(({ rel }) => !SKIP_FRAGMENTS.some((s) => rel.includes(`/${s}/`)));
}

// ──────────────────────────────────────────────────────────────────────────
// String-literal extraction
// ──────────────────────────────────────────────────────────────────────────

/**
 * Extract every string-literal value from a TS/TSX/JS source.
 * Tracks single-quoted, double-quoted, and backtick template literals.
 * Naive but adequate — comments are not parsed out, so banned phrases
 * INSIDE block comments will also fire. That's acceptable: a comment
 * shouldn't whisper "great job" either; if you need to talk about the
 * rule, do it in CLAUDE.md (which is exempt).
 *
 * Returns array of { text, lineNo } where lineNo is 1-based.
 */
function extractStringLiterals(src) {
  const out = [];
  let i = 0;
  let line = 1;
  const len = src.length;

  function advanceLine(ch) {
    if (ch === '\n') line++;
  }

  while (i < len) {
    const ch = src[i];

    // Skip line comments
    if (ch === '/' && src[i + 1] === '/') {
      while (i < len && src[i] !== '\n') i++;
      continue;
    }
    // Skip block comments
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < len && !(src[i] === '*' && src[i + 1] === '/')) {
        advanceLine(src[i]);
        i++;
      }
      i += 2;
      continue;
    }

    // String literals
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      const startLine = line;
      const startI = ++i;
      let buf = '';
      while (i < len) {
        const c = src[i];
        if (c === '\\') {
          // copy the escape literally; we only care about visible text
          buf += c + (src[i + 1] ?? '');
          advanceLine(src[i + 1]);
          i += 2;
          continue;
        }
        if (c === quote) { i++; break; }
        // template-literal expression — preserve as literal text so we
        // don't trip on ${} interpolation
        if (quote === '`' && c === '$' && src[i + 1] === '{') {
          buf += '${';
          i += 2;
          let depth = 1;
          while (i < len && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            advanceLine(src[i]);
            if (depth > 0) buf += src[i];
            i++;
          }
          buf += '}';
          continue;
        }
        buf += c;
        advanceLine(c);
        i++;
      }
      out.push({ text: buf, lineNo: startLine });
      continue;
    }

    advanceLine(ch);
    i++;
  }

  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Notification-context detection (mirrors legacy)
// ──────────────────────────────────────────────────────────────────────────

const CTX_OPEN = /(NUDGE_TEMPLATES|notificationTemplates|pushTemplates|reminderTemplates|nudgeEngine|nudge_templates|push_templates|notif_templates|sendNotification|new\s+Notification\s*\(|invoke\(['"](show_notification|notify)|notification\s*[:=]\s*\{|push\s*[:=]\s*\{|reminder\s*[:=]\s*\{|nag\s*[:=]\s*['"`]|nudge\s*[:=]\s*['"`]|emit\(['"]void:reminder:scheduled['"]|emit\(['"]void:reminder:fired['"]|\bnotify\s*\(\s*\{|\bawait\s+notify\s*\(|@ollie\/notifications|installCapacitorBackend|installElectronBackend|installWebBackend)/i;
const CTX_WINDOW = 30;

function buildContextMask(lines) {
  const inContext = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (CTX_OPEN.test(lines[i])) {
      for (let j = i; j < Math.min(i + CTX_WINDOW, lines.length); j++) {
        inContext[j] = true;
      }
    }
  }
  return inContext;
}

function hasAllowComment(lines, idx) {
  // The marker can sit on the same line or up to 3 lines above. A
  // multi-line `notif-scope-allow — why…` block is common above an
  // LLM system prompt, so we accept up to 3 preceding lines.
  for (let i = idx; i >= Math.max(0, idx - 3); i--) {
    if (/notif-scope-allow/i.test(lines[i] ?? '')) return true;
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────────────
// JSON walk
// ──────────────────────────────────────────────────────────────────────────

function walkJsonLeaves(node, pathParts, cb) {
  if (typeof node === 'string') {
    cb(pathParts.join('.'), node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkJsonLeaves(v, [...pathParts, String(i)], cb));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      walkJsonLeaves(v, [...pathParts, k], cb);
    }
  }
}

function scopeFromKey(keyPath) {
  // Meta / help / onboarding copy describes app rules — it doesn't
  // emit them. A string under `help.body.*` explaining "no calorie
  // tracking" must contain the word "calorie" to make sense. Skip
  // scoped bans for these branches; global bans still apply.
  if (/(?:^|\.)(help|onboarding|legal|about|settings_help)\b/i.test(keyPath)) return [];
  // Push/nudge keys → push scope
  if (/(?:^|\.)(push|nudge|notification|reminder|nag)\b/i.test(keyPath)) return ['push'];
  if (/(?:^|\.)confirmation\b/i.test(keyPath)) return ['confirmation'];
  if (/(?:^|\.)cycle\b/i.test(keyPath)) return ['cycle'];
  if (/(?:^|\.)pets?\b/i.test(keyPath)) return ['pets'];
  if (/(?:^|\.)habits?\b/i.test(keyPath)) return ['habits'];
  if (/(?:^|\.)body|pantry\b/i.test(keyPath)) return ['bodyPantry'];
  return [];
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

function main() {
  const report = [];
  const files = listFiles();

  for (const { abs, rel } of files) {
    let src;
    try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const ext = path.extname(abs).toLowerCase();

    // ── JSON: scan every leaf string with key-derived scope ─────────────
    if (SCAN_EXTS_JSON.has(ext)) {
      let json;
      try { json = JSON.parse(src); } catch { continue; }
      walkJsonLeaves(json, [], (keyPath, value) => {
        const hits = scanForBanned(value, scopeFromKey(keyPath));
        for (const h of hits) {
          report.push({ rel, lineNo: 0, line: `${keyPath} = ${value}`.slice(0, 200), why: h.why, id: h.id, source: h.source });
        }
      });
      continue;
    }

    // ── TS/TSX/JS: extract string literals + run global bans ────────────
    if (!SCAN_EXTS_TS.has(ext)) continue;

    const lines = src.split(/\r?\n/);
    const inCtx = buildContextMask(lines);
    const isTest = isTestFile(rel);

    const literals = extractStringLiterals(src);
    for (const { text, lineNo } of literals) {
      // Skip empty / pure whitespace strings
      if (!text.trim()) continue;
      // Allowlist
      if (hasAllowComment(lines, lineNo - 1)) continue;

      // Always run global bans
      const globalHits = scanForBanned(text, []);
      for (const h of globalHits) {
        report.push({
          rel,
          lineNo,
          line: text.trim().slice(0, 200),
          why: h.why,
          id: h.id,
          source: h.source,
        });
      }

      // Run push-scope bans only when the literal is inside a notification
      // context, AND not in a test file (test files freely quote push
      // templates by name).
      if (!isTest && inCtx[lineNo - 1]) {
        const pushHits = scanForBanned(text, ['push']);
        for (const h of pushHits) {
          if (h.source !== 'push') continue; // skip globals (already reported)
          report.push({
            rel,
            lineNo,
            line: text.trim().slice(0, 200),
            why: h.why,
            id: h.id,
            source: h.source,
          });
        }
      }
    }
  }

  if (report.length === 0) {
    if (!QUIET) {
      console.log(`banned-phrase scanner: clean across ${files.length} files.`);
    }
    process.exit(0);
  }

  console.error('\n✗ BANNED PHRASE VIOLATIONS — voice-library / notification-scope guard\n');
  console.error('  see CLAUDE.md "Notification Scope" + design-pitches/voice-library.html.\n');
  for (const v of report) {
    const where = v.lineNo > 0 ? `${v.rel}:${v.lineNo}` : v.rel;
    console.error(`  ${where}  [${v.source}/${v.id}]`);
    console.error(`    why:  ${v.why}`);
    console.error(`    line: ${v.line}`);
    console.error('');
  }
  const fileCount = new Set(report.map((r) => r.rel)).size;
  console.error(
    `${report.length} violation${report.length === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'}.`,
  );
  console.error('\nfix: replace with quiet, functional copy or delete entirely.');
  console.error('inline allowlist: add `// notif-scope-allow` on or above the line. use sparingly.\n');
  process.exit(1);
}

main();
