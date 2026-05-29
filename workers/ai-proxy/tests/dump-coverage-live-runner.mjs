/**
 * Standalone runner for the live Groq dump-coverage check.
 *
 * Why standalone (not vitest):
 *   Vitest spawns multiple workers and buffers verbose output until each file
 *   completes. Combined with Groq's 12k TPM free-tier limit (≈ 2.4 calls/min
 *   sustained for the 5k-token SYSTEM_PROMPT), running all 553 fixtures via
 *   vitest takes 4+ hours with no per-test visibility. This script:
 *     1. Stratified-samples ~100 fixtures (≥2 per (module, action) pair) for a representative pass rate.
 *     2. Throttles to 1 call / 26s (≈ 2.3/min, safely below TPM cap).
 *     3. Honors Groq's `Retry-After` hint embedded in 429 responses.
 *     4. Streams pass/fail per fixture so we can watch progress.
 *
 * Run:
 *   GROQ_API_KEY=... node tests/dump-coverage-live-runner.mjs
 *
 * Cost:
 *   ~100 calls × ~5k input + ~150 output tokens × $0.59/M input + $0.79/M output
 *   ≈ $0.30 per run. Well under the $3-5 budget.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const API_KEY = process.env.GROQ_API_KEY;
if (!API_KEY) {
  console.error('GROQ_API_KEY not set');
  process.exit(1);
}

// ─── parse fixtures directly from dump-fixtures.ts ────────────────────────
// The fixture file is plain TypeScript with const-object literals. We strip
// the `text:` and `expected: { module, action, payloadKeys, payload, confidence? }`
// fields via regex. This avoids needing a TS loader (no tsx installed).
const fixturesSrc = readFileSync(
  new URL('./dump-fixtures.ts', import.meta.url),
  'utf-8',
);

// Match each fixture object: { text: '...', expected: { ... } }
const fixturePattern = /\{\s*text:\s*('([^'\\]|\\.)*'|"([^"\\]|\\.)*"),\s*expected:\s*\{([^{}]|\{[^{}]*\})*\}\s*\}/g;
const ALL_FIXTURES = [];
let match;
while ((match = fixturePattern.exec(fixturesSrc)) !== null) {
  const blob = match[0];
  // Extract text
  const textMatch = blob.match(/text:\s*'((?:[^'\\]|\\.)*)'/) ||
                    blob.match(/text:\s*"((?:[^"\\]|\\.)*)"/);
  if (!textMatch) continue;
  const text = textMatch[1]
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n');

  const moduleMatch = blob.match(/module:\s*'([^']+)'/);
  const actionMatch = blob.match(/action:\s*'([^']+)'/);
  if (!moduleMatch || !actionMatch) continue;

  const payloadKeysMatch = blob.match(/payloadKeys:\s*\[([^\]]*)\]/);
  const payloadKeys = payloadKeysMatch
    ? Array.from(payloadKeysMatch[1].matchAll(/'([^']+)'/g)).map((m) => m[1])
    : [];

  const confidenceMatch = blob.match(/confidence:\s*([\d.]+)/);
  const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : undefined;

  ALL_FIXTURES.push({
    text,
    expected: {
      module: moduleMatch[1],
      action: actionMatch[1],
      payloadKeys,
      confidence,
    },
  });
}
console.log(`loaded ${ALL_FIXTURES.length} fixtures via regex`);

// ─── stratified sample ────────────────────────────────────────────────────
const TARGET_PER_PAIR = 2;
const byPair = new Map();
for (const f of ALL_FIXTURES) {
  const k = `${f.expected.module}.${f.expected.action}`;
  if (!byPair.has(k)) byPair.set(k, []);
  byPair.get(k).push(f);
}
const SAMPLE = [];
for (const list of byPair.values()) {
  for (let i = 0; i < Math.min(TARGET_PER_PAIR, list.length); i++) {
    SAMPLE.push(list[i]);
  }
}
console.log(`sampled ${SAMPLE.length} fixtures across ${byPair.size} (module, action) pairs`);

// ─── extract SYSTEM_PROMPT from source ────────────────────────────────────
const classifySrc = readFileSync(
  new URL('../src/router/dump-classify.ts', import.meta.url),
  'utf-8',
);
const promptMatch = classifySrc.match(/const SYSTEM_PROMPT = `([\s\S]+?)`;\s*$/m);
if (!promptMatch) {
  console.error('failed to extract SYSTEM_PROMPT from dump-classify.ts');
  process.exit(1);
}
const SYSTEM_PROMPT = promptMatch[1].replace(/\\`/g, '`').replace(/\\\$/g, '$');
console.log(`SYSTEM_PROMPT length: ${SYSTEM_PROMPT.length} chars`);

// ─── helpers ──────────────────────────────────────────────────────────────
function detectLang(text) {
  if (/[ığüşöçİĞÜŞÖÇ]/.test(text)) return 'tr';
  if (/[¿¡áéíóúñ]/.test(text)) return 'es';
  return 'en';
}

async function classifyOnce(text, lang) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Fragment language: ${lang}\nFragment: ${text}` },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 512,
    }),
  });
  if (res.status === 429) {
    const body = await res.text();
    const m = body.match(/try again in ([\d.]+)s/);
    const wait = m ? Math.min(parseFloat(m[1]) + 1, 35) : 30;
    console.log(`  429 — waiting ${wait}s`);
    await sleep(wait * 1000);
    return classifyOnce(text, lang);
  }
  if (!res.ok) {
    throw new Error(`groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  const usage = data.usage ?? {};
  const parsed = JSON.parse(choice.message.content);
  return { parsed, usage };
}

// ─── main loop ─────────────────────────────────────────────────────────────
const SPACING_MS = 26_000;
const results = [];
let totalIn = 0;
let totalOut = 0;
const start = Date.now();

for (let i = 0; i < SAMPLE.length; i++) {
  const fix = SAMPLE[i];
  const lang = detectLang(fix.text);
  try {
    const { parsed, usage } = await classifyOnce(fix.text, lang);
    totalIn += usage.prompt_tokens ?? 0;
    totalOut += usage.completion_tokens ?? 0;
    const moduleOk = parsed.module === fix.expected.module;
    const actionOk = parsed.action === fix.expected.action;
    const payloadOk = fix.expected.payloadKeys.every((k) =>
      Object.prototype.hasOwnProperty.call(parsed.payload ?? {}, k),
    );
    const isDumpOnly = fix.expected.module === 'dump_only';
    const confidenceOk = isDumpOnly
      ? typeof parsed.confidence === 'number'
      : parsed.confidence >= 0.5;
    const pass = moduleOk && actionOk && payloadOk && confidenceOk;
    results.push({
      text: fix.text,
      lang,
      expected: `${fix.expected.module}.${fix.expected.action}`,
      got: `${parsed.module}.${parsed.action}`,
      confidence: parsed.confidence,
      pass,
      moduleOk,
      actionOk,
      payloadOk,
      confidenceOk,
    });
    const tag = pass ? 'PASS' : 'FAIL';
    console.log(
      `[${i + 1}/${SAMPLE.length}] ${tag} ${lang} "${fix.text.slice(0, 40)}" → ${parsed.module}.${parsed.action} (conf=${parsed.confidence}) want ${fix.expected.module}.${fix.expected.action}`,
    );
  } catch (err) {
    results.push({
      text: fix.text,
      lang,
      expected: `${fix.expected.module}.${fix.expected.action}`,
      got: 'ERROR',
      error: err.message,
      pass: false,
    });
    console.log(`[${i + 1}/${SAMPLE.length}] ERROR ${lang} "${fix.text.slice(0, 40)}" → ${err.message.slice(0, 80)}`);
  }
  if (i < SAMPLE.length - 1) {
    await sleep(SPACING_MS);
  }
}

const wallSec = ((Date.now() - start) / 1000).toFixed(1);
const passed = results.filter((r) => r.pass).length;
const byLang = { en: { p: 0, t: 0 }, es: { p: 0, t: 0 }, tr: { p: 0, t: 0 } };
for (const r of results) {
  byLang[r.lang].t += 1;
  if (r.pass) byLang[r.lang].p += 1;
}

const COST_IN = (totalIn / 1_000_000) * 0.59;
const COST_OUT = (totalOut / 1_000_000) * 0.79;

console.log('\n────────────────────────────────────────────────────');
console.log(`PASS RATE: ${passed}/${results.length} (${((passed / results.length) * 100).toFixed(1)}%)`);
console.log(`  EN: ${byLang.en.p}/${byLang.en.t}, ES: ${byLang.es.p}/${byLang.es.t}, TR: ${byLang.tr.p}/${byLang.tr.t}`);
console.log(`Wall clock: ${wallSec}s`);
console.log(`Tokens: ${totalIn.toLocaleString()} in + ${totalOut.toLocaleString()} out = $${(COST_IN + COST_OUT).toFixed(4)}`);
console.log('────────────────────────────────────────────────────\n');

const fails = results.filter((r) => !r.pass);
if (fails.length > 0) {
  console.log(`TOP MISCLASSIFIED (${fails.length} total):`);
  fails.slice(0, 15).forEach((f) => {
    console.log(`  "${f.text}" → expected ${f.expected}, got ${f.got} (conf=${f.confidence ?? 'n/a'})`);
  });
}

writeFileSync('/tmp/dump-coverage-live-results.json', JSON.stringify(results, null, 2));
console.log('\nfull results: /tmp/dump-coverage-live-results.json');
