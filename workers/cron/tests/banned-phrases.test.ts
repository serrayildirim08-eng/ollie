/**
 * Tests for the Worker-runtime banned-phrase port.
 *
 * The drain's last-gate copy check (src/banned-phrases.ts) is a port of
 * tools/banned-phrases.cjs. These tests pin the behaviour AND assert the
 * port stays in lockstep with the CJS source of truth for every GLOBAL
 * and 'push' ban — so a ban added to tools/ but forgotten here fails CI.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { scanForBanned, checkNotificationCopy } from '../src/banned-phrases';

// The CJS module of record. Loaded at test time only (never bundled into
// the worker) to cross-check our port.
const require = createRequire(import.meta.url);
const cjs = require(resolve(__dirname, '../../../tools/banned-phrases.cjs')) as {
  GLOBAL_BANS: Array<{ id: string }>;
  SCOPED_BANS: { push: Array<{ id: string }> };
};

describe('banned-phrases port · detection', () => {
  it('flags cheerleading copy', () => {
    expect(scanForBanned('great job tracking today').length).toBeGreaterThan(0);
    expect(scanForBanned('you are crushing it').length).toBeGreaterThan(0);
  });

  it('flags streak language', () => {
    expect(scanForBanned("don't break your streak").length).toBeGreaterThan(0);
    expect(scanForBanned('your streak is at 7').length).toBeGreaterThan(0);
  });

  it('flags engagement / re-engagement pushes', () => {
    expect(scanForBanned('we miss you').length).toBeGreaterThan(0);
    expect(scanForBanned("you haven't logged in a while").length).toBeGreaterThan(0);
  });

  it('flags exclamation marks in push copy', () => {
    expect(scanForBanned('time to hydrate!').some((h) => h.id === 'push-exclaim')).toBe(true);
  });

  it('flags celebration emoji', () => {
    expect(scanForBanned('nice work 🎉').some((h) => h.id === 'emoji-celebrate')).toBe(true);
  });

  it('passes quiet, factual copy', () => {
    expect(scanForBanned('bill due tomorrow')).toEqual([]);
    expect(scanForBanned('electric bill, $84')).toEqual([]);
    expect(scanForBanned('period approaching in 5 days')).toEqual([]);
  });
});

describe('banned-phrases port · checkNotificationCopy', () => {
  it('clean when title + body are factual', () => {
    const r = checkNotificationCopy({ title: 'vet appointment', body: 'tomorrow at 3pm' });
    expect(r.clean).toBe(true);
    expect(r.hits).toEqual([]);
  });

  it('dirty when title carries a banned phrase', () => {
    const r = checkNotificationCopy({ title: 'great job today', body: 'see you tomorrow' });
    expect(r.clean).toBe(false);
  });

  it('dirty when body carries a banned phrase', () => {
    const r = checkNotificationCopy({ title: 'reminder', body: 'we miss you' });
    expect(r.clean).toBe(false);
  });

  it('ignores non-string title/body', () => {
    const r = checkNotificationCopy({ title: undefined, body: 123 as unknown as string });
    expect(r.clean).toBe(true);
  });
});

describe('banned-phrases port · lockstep with tools/banned-phrases.cjs', () => {
  it('GLOBAL ban ids fired by both implementations match', () => {
    // For each global ban, build a probe string that the CJS source flags,
    // and assert the port flags it too. Done by id coverage: every CJS
    // global ban id must be reachable from our port's GLOBAL list.
    const portGlobalIds = new Set(
      // Reach into the port by exercising representative phrases per id.
      [
        'great job', 'awesome.', 'woohoo', 'good work', "you've got this",
        'crushing it', 'rockstar', 'killing it', 'streak', 'streak broken',
        "don't break your streak", '7 days in a row', 'keep your streak alive',
        'you missed yesterday', 'come back soon', 'we miss you',
        'check in with ollie', "you haven't logged", '5 days since you opened',
        'where have you been', 'your friend just logged', 'burhan is sad',
        'burhan needs you', 'limited time', 'today only', 'last chance',
        'you matter to us', 'please reach out',
      ].flatMap((p) => scanForBanned(p).filter((h) => h.source === 'global').map((h) => h.id)),
    );
    for (const ban of cjs.GLOBAL_BANS) {
      expect(portGlobalIds.has(ban.id)).toBe(true);
    }
  });

  it('push-scope ban ids are all reachable from the port', () => {
    const portPushIds = new Set(
      ['hydrate!', 'nice 🎉', 'great job today'].flatMap((p) =>
        scanForBanned(p).filter((h) => h.source === 'push').map((h) => h.id),
      ),
    );
    for (const ban of cjs.SCOPED_BANS.push) {
      expect(portPushIds.has(ban.id)).toBe(true);
    }
  });
});
