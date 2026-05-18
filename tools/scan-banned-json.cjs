#!/usr/bin/env node
/**
 * ollie · CI guard · banned-phrase scanner (i18n JSON pass)
 *
 * The TS/TSX source pass formerly done by tools/scan-banned-phrases.cjs is
 * now the ESLint rule `ollie/no-banned-copy` (runs via `pnpm lint`). ESLint
 * cannot cleanly lint the VALUES inside a JSON file, so this small script
 * keeps that one job: scan every leaf string in the i18n string tables.
 *
 * It reuses the SHARED rule table in tools/banned-phrases.cjs — no regexes
 * are duplicated here. Scope is derived from the JSON key path, exactly as
 * the legacy scanner did.
 *
 * Exit:  0 = clean, 1 = banned phrase found.
 * Usage: node tools/scan-banned-json.cjs [--quiet]
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { scanForBanned } = require('./banned-phrases.cjs');

const ROOT = path.resolve(__dirname, '..');
const QUIET = process.argv.includes('--quiet');

// i18n string tables — strings.en.json, strings.es.json,
// strings.en.literal.json, and any future locale/voice variant.
const I18N_DIR = path.join(ROOT, 'apps/web/src/i18n');

function listJsonFiles() {
  let entries;
  try {
    entries = fs.readdirSync(I18N_DIR);
  } catch {
    return [];
  }
  return entries
    .filter((f) => /^strings\..+\.json$/.test(f))
    .map((f) => path.join(I18N_DIR, f));
}

// Recurse a parsed JSON tree, invoking cb(keyPath, value) on every string.
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

// Derive a scoped-ban set from the key path (parity with the legacy scanner).
function scopeFromKey(keyPath) {
  // Meta / help / onboarding copy DESCRIBES app rules — it doesn't emit
  // them. A help string explaining "no calorie tracking" must contain the
  // word "calorie". Skip scoped bans here; global bans still apply.
  if (/(?:^|\.)(help|onboarding|legal|about|settings_help)\b/i.test(keyPath)) return [];
  if (/(?:^|\.)(push|nudge|notification|reminder|nag)\b/i.test(keyPath)) return ['push'];
  if (/(?:^|\.)confirmation\b/i.test(keyPath)) return ['confirmation'];
  if (/(?:^|\.)cycle\b/i.test(keyPath)) return ['cycle'];
  if (/(?:^|\.)pets?\b/i.test(keyPath)) return ['pets'];
  if (/(?:^|\.)habits?\b/i.test(keyPath)) return ['habits'];
  if (/(?:^|\.)body|pantry\b/i.test(keyPath)) return ['bodyPantry'];
  return [];
}

function main() {
  const report = [];
  const files = listJsonFiles();

  for (const abs of files) {
    const rel = path.relative(ROOT, abs);
    let json;
    try {
      json = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch {
      continue;
    }
    walkJsonLeaves(json, [], (keyPath, value) => {
      // `_meta` / `_doc` branches document the file; not user-facing copy.
      if (/(?:^|\.)_/.test(keyPath)) return;
      for (const h of scanForBanned(value, scopeFromKey(keyPath))) {
        report.push({
          rel,
          where: keyPath,
          line: `${keyPath} = ${value}`.slice(0, 200),
          why: h.why,
          id: h.id,
          source: h.source,
        });
      }
    });
  }

  if (report.length === 0) {
    if (!QUIET) {
      console.log(`banned-phrase i18n scan: clean across ${files.length} string table(s).`);
    }
    process.exit(0);
  }

  console.error('\n✗ BANNED PHRASE VIOLATIONS — i18n string tables\n');
  console.error('  see CLAUDE.md "Notification Scope" + design-pitches/voice-library.html.\n');
  for (const v of report) {
    console.error(`  ${v.rel}  [${v.source}/${v.id}]`);
    console.error(`    why:  ${v.why}`);
    console.error(`    line: ${v.line}`);
    console.error('');
  }
  const fileCount = new Set(report.map((r) => r.rel)).size;
  console.error(
    `${report.length} violation${report.length === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'}.`,
  );
  console.error('\nfix: replace with quiet, functional copy in the string table.\n');
  process.exit(1);
}

main();
