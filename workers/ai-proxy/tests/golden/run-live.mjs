#!/usr/bin/env node
/**
 * Live golden-test harness — POSTs each test from OLLIE_AI_ROUTER_TESTS.md
 * to the deployed staging /route/dump and grades the result.
 *
 * Usage:
 *   STAGING_BEARER=$(cat /tmp/ollie-staging-bearer.txt) \
 *     node tests/golden/run-live.mjs
 *
 * Pass rule (per test):
 *   - HTTP 200
 *   - Every expected_fragment has at least one matching returned fragment by
 *     (module, payload.action). If `min_confidence` is set, confidence >=
 *     min_confidence on at least one match.
 *
 * Failures are classified into one of:
 *   - HTTP_ERROR        (non-200)
 *   - WRONG_MODULE      (no returned fragment with the expected module)
 *   - WRONG_ACTION      (module ok, no matching action)
 *   - LOW_CONFIDENCE    (module+action ok but below min_confidence)
 *   - MISSING_FRAGMENT  (expected N fragments, got fewer)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_FILE = join(__dirname, 'OLLIE_AI_ROUTER_TESTS.md');
const ENDPOINT = process.env.ENDPOINT || 'https://ollie-ai-proxy-staging.ollieapp.workers.dev/route/dump';
const BEARER = process.env.STAGING_BEARER;
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const DELAY_MS = Number(process.env.DELAY_MS || 0); // per-worker between calls
const RETRY_502 = Number(process.env.RETRY_502 || 2); // retry attempts on 502
const ONLY = process.env.ONLY; // optional substring filter on test id

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!BEARER) {
  console.error('STAGING_BEARER env var required');
  process.exit(2);
}

// ─── parse tests from markdown ────────────────────────────────────────────
function extractTests(md) {
  // Pull every ```json ... ``` block then extract objects with id + input.
  const tests = [];
  const blockRe = /```json\n([\s\S]*?)\n```/g;
  let m;
  while ((m = blockRe.exec(md)) !== null) {
    const body = m[1];
    // The body is `{ "<key>": [ ... ] }` — drop the wrapper and parse the array.
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Skip malformed blocks.
      continue;
    }
    for (const key of Object.keys(parsed)) {
      const arr = parsed[key];
      if (!Array.isArray(arr)) continue;
      for (const t of arr) {
        if (t && typeof t.id === 'string' && typeof t.input === 'string' && Array.isArray(t.expected_fragments)) {
          tests.push(t);
        }
      }
    }
  }
  return tests;
}

// ─── grading ──────────────────────────────────────────────────────────────
function grade(test, response) {
  const expected = test.expected_fragments;
  const returned = response.fragments || [];
  const reasons = [];

  for (const exp of expected) {
    const expMod = exp.module;
    const expAct = exp.payload?.action;
    const minConf = typeof exp.min_confidence === 'number' ? exp.min_confidence : 0;

    const moduleMatches = returned.filter((f) => f.module === expMod);
    if (moduleMatches.length === 0) {
      reasons.push(`WRONG_MODULE: expected ${expMod}, got ${returned.map((f) => f.module).join(',') || 'none'}`);
      continue;
    }
    const actionMatches = moduleMatches.filter((f) => (f.payload?.action ?? null) === expAct);
    if (actionMatches.length === 0) {
      reasons.push(`WRONG_ACTION: ${expMod}.${expAct} — got ${moduleMatches.map((f) => f.payload?.action ?? 'null').join(',')}`);
      continue;
    }
    const confOk = actionMatches.some((f) => (f.confidence ?? 0) >= minConf);
    if (!confOk) {
      const got = actionMatches.map((f) => f.confidence ?? 0).join(',');
      reasons.push(`LOW_CONFIDENCE: ${expMod}.${expAct} min=${minConf} got=[${got}]`);
    }
  }

  if (returned.length < expected.length && reasons.length === 0) {
    reasons.push(`MISSING_FRAGMENT: expected ${expected.length} got ${returned.length}`);
  }

  return { pass: reasons.length === 0, reasons };
}

// ─── runner with concurrency ──────────────────────────────────────────────
async function postOnce(test) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${BEARER}`,
    },
    body: JSON.stringify({ text: test.input }),
  });
  return res;
}

async function runOne(test) {
  const t0 = Date.now();
  let lastDetail = '';
  let lastStatus = 0;
  let attempts = 0;

  while (attempts <= RETRY_502) {
    attempts++;
    let res;
    try {
      res = await postOnce(test);
    } catch (err) {
      lastDetail = err.message;
      lastStatus = 0;
      await sleep(2000 * attempts);
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      const graded = grade(test, data);
      return {
        id: test.id,
        input: test.input,
        pass: graded.pass,
        reasons: graded.reasons,
        fragments: data.fragments,
        ms: Date.now() - t0,
        attempts,
      };
    }
    lastStatus = res.status;
    lastDetail = await res.text().catch(() => '');
    // Only retry transient 502 (upstream gemini fail).
    if (res.status !== 502) break;
    await sleep(2000 * attempts);
  }

  return {
    id: test.id,
    input: test.input,
    pass: false,
    reasons: [`HTTP_ERROR: ${lastStatus} ${lastDetail.slice(0, 120)}`],
    ms: Date.now() - t0,
    attempts,
  };
}

async function runAll(tests) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tests.length) {
      const idx = i++;
      const t = tests[idx];
      const r = await runOne(t);
      results.push(r);
      const tag = r.pass ? 'PASS' : 'FAIL';
      const reason = r.pass ? '' : ` — ${r.reasons.join(' | ')}`;
      const att = r.attempts > 1 ? ` x${r.attempts}` : '';
      console.log(`[${tag}] ${r.id} (${r.ms}ms${att}) "${t.input.slice(0, 60)}"${reason}`);
      if (DELAY_MS) await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return results;
}

// ─── main ─────────────────────────────────────────────────────────────────
const md = readFileSync(TEST_FILE, 'utf-8');
let tests = extractTests(md);
if (ONLY) tests = tests.filter((t) => t.id.includes(ONLY));

console.log(`Loaded ${tests.length} tests from ${TEST_FILE.replace(process.env.HOME, '~')}`);
console.log(`Endpoint: ${ENDPOINT}`);
console.log(`Concurrency: ${CONCURRENCY}\n`);

const results = await runAll(tests);

// ─── summary ──────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
const passRate = results.length ? (passed / results.length) * 100 : 0;

// Group failures by reason class.
const classes = {};
for (const r of results) {
  if (r.pass) continue;
  for (const reason of r.reasons) {
    const cls = reason.split(':')[0];
    classes[cls] = (classes[cls] || 0) + 1;
  }
}

const avgMs = results.length ? Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length) : 0;

console.log('\n──────── SUMMARY ────────');
console.log(`Total:    ${results.length}`);
console.log(`Passed:   ${passed}`);
console.log(`Failed:   ${failed}`);
console.log(`Pass %:   ${passRate.toFixed(1)}`);
console.log(`Avg time: ${avgMs}ms`);
console.log(`\nFailure classes:`);
for (const [cls, n] of Object.entries(classes).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cls}: ${n}`);
}
console.log('');

// Write detail JSON for triage.
const outFile = join(__dirname, `results-${Date.now()}.json`);
const fs = await import('node:fs/promises');
await fs.writeFile(outFile, JSON.stringify({ passRate, results }, null, 2));
console.log(`Detail: ${outFile.replace(process.env.HOME, '~')}`);
