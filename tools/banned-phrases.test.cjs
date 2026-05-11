/**
 * banned-phrases scanner · unit tests
 *
 * Hand-run via `node tools/banned-phrases.test.cjs`. Also invoked by the
 * pretest hook in package.json so `pnpm test` fails on regressions.
 *
 * Uses node:test so we don't drag vitest into the tools/ runtime.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { GLOBAL_BANS, SCOPED_BANS, scanForBanned } = require('./banned-phrases.cjs');

// ── global bans ──────────────────────────────────────────────────────────

test('global · catches "great job"', () => {
  const hits = scanForBanned('great job today!');
  assert.ok(hits.some((h) => h.id === 'great-job'));
});

test('global · catches "streak"', () => {
  assert.ok(scanForBanned('keep your streak alive').some((h) => h.id === 'streak'));
});

test('global · catches "we miss you"', () => {
  assert.ok(scanForBanned('we miss you, come back!').some((h) => h.id === 'miss-you'));
});

test('global · catches "burhan is sad" (Finch trap)', () => {
  assert.ok(scanForBanned('burhan is sad').some((h) => h.id === 'burhan-sad'));
});

test('global · catches "X days since you opened"', () => {
  assert.ok(
    scanForBanned("it's been 3 days since your last dump").some((h) => h.id === 'days-since-x'),
  );
});

test('global · catches "limited time"', () => {
  assert.ok(scanForBanned('limited time offer').some((h) => h.id === 'limited-time'));
});

test('global · catches "you matter to us" (hallmark crisis copy)', () => {
  assert.ok(scanForBanned('you matter to us').some((h) => h.id === 'you-matter'));
});

test('global · clean copy passes', () => {
  assert.deepStrictEqual(scanForBanned('rent is due in 3 days. just saying.'), []);
});

test('global · "toilet paper szn approaching" passes', () => {
  assert.deepStrictEqual(
    scanForBanned('toilet paper szn approaching. adding to your list.'),
    [],
  );
});

// ── push scope ──────────────────────────────────────────────────────────

test('push scope · catches exclamation marks', () => {
  const hits = scanForBanned('great work!', ['push']);
  assert.ok(hits.some((h) => h.id === 'push-exclaim' && h.source === 'push'));
});

test('push scope · exclamation in non-push scope does NOT fire push-exclaim', () => {
  const hits = scanForBanned('rent is due!', []);
  assert.ok(!hits.some((h) => h.id === 'push-exclaim'));
});

test('push scope · catches 🎉 emoji', () => {
  const hits = scanForBanned('done 🎉', ['push']);
  assert.ok(hits.some((h) => h.id === 'emoji-celebrate'));
});

// ── scoped bans ─────────────────────────────────────────────────────────

test('cycle scope · catches "fertile day"', () => {
  const hits = scanForBanned('your fertile day is wednesday', ['cycle']);
  assert.ok(hits.some((h) => h.id === 'fertile-day'));
});

test('bodyPantry scope · catches "calorie"', () => {
  const hits = scanForBanned('total calories today: 1800', ['bodyPantry']);
  assert.ok(hits.some((h) => h.id === 'calorie'));
});

test('pets scope · catches "tontin is sad"', () => {
  const hits = scanForBanned('tontin is sad', ['pets']);
  assert.ok(hits.some((h) => h.id === 'pet-sad'));
});

// ── shape ──────────────────────────────────────────────────────────────

test('GLOBAL_BANS exposed as an array of {id, re, why}', () => {
  assert.ok(Array.isArray(GLOBAL_BANS));
  for (const b of GLOBAL_BANS) {
    assert.strictEqual(typeof b.id, 'string');
    assert.ok(b.re instanceof RegExp);
    assert.strictEqual(typeof b.why, 'string');
  }
});

test('SCOPED_BANS exposes push/cycle/pets/habits/bodyPantry/confirmation', () => {
  for (const k of ['push', 'cycle', 'pets', 'habits', 'bodyPantry', 'confirmation']) {
    assert.ok(Array.isArray(SCOPED_BANS[k]), `expected SCOPED_BANS.${k} array`);
  }
});

// ── invariants ─────────────────────────────────────────────────────────

test('no ban id is duplicated globally', () => {
  const seen = new Set();
  for (const b of GLOBAL_BANS) {
    assert.ok(!seen.has(b.id), `duplicate id: ${b.id}`);
    seen.add(b.id);
  }
});

// ── NL5 · notify() call sites get push-scope rules ─────────────────────

test('NL5 · "we miss you!" copy fires both global and push bans', () => {
  // global ban: miss-you. push-scope: exclamation mark.
  const hits = scanForBanned('we miss you!', ['push']);
  assert.ok(hits.some((h) => h.id === 'miss-you'));
  assert.ok(hits.some((h) => h.id === 'push-exclaim'));
});

test('NL5 · "you matter to us!" — hallmark crisis copy in push', () => {
  const hits = scanForBanned('you matter to us!', ['push']);
  assert.ok(hits.some((h) => h.id === 'you-matter'));
  assert.ok(hits.some((h) => h.id === 'push-exclaim'));
});

test('NL5 · "rent is due in 3 days" passes push scope', () => {
  assert.deepStrictEqual(scanForBanned('rent is due in 3 days', ['push']), []);
});
