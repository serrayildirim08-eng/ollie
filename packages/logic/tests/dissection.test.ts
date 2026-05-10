import { describe, it, expect } from 'vitest';
import { dissection } from '../src/index';
import type { Action, AnswerRoute } from '../src/dissection';

const { extract, fallbackRoute } = dissection;

// ─── helpers ──────────────────────────────────────────────────────────────────

function isAnswer(r: unknown): r is AnswerRoute {
  return typeof r === 'object' && r !== null && (r as AnswerRoute).isAnswer === true;
}

function asEvents(r: ReturnType<typeof extract>): Action[] {
  if (isAnswer(r)) throw new Error('Expected action array, got answer');
  return r as Action[];
}

// ─── catch-all / dump ─────────────────────────────────────────────────────────

describe('dissection.extract · catch-all', () => {
  it('routes unknown text to dump', () => {
    const events = asEvents(extract('zxqwerty nothing useful'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ module: 'dump', action: 'log' });
  });

  it('routes emotion-heavy text to dump', () => {
    const events = asEvents(extract('i feel so overwhelmed today'));
    expect(events.some(e => e.module === 'dump')).toBe(true);
  });
});

// ─── grocery ─────────────────────────────────────────────────────────────────

describe('dissection.extract · grocery', () => {
  it('routes "need milk" to grocery', () => {
    const events = asEvents(extract('need milk'));
    expect(events.some(e => e.module === 'grocery')).toBe(true);
  });

  it('routes Turkish "süt aldım" to grocery', () => {
    const events = asEvents(extract('süt aldım'));
    expect(events.some(e => e.module === 'grocery')).toBe(true);
  });
});

// ─── finance ─────────────────────────────────────────────────────────────────

describe('dissection.extract · finance', () => {
  it('routes "pay rent" to finance', () => {
    const events = asEvents(extract('pay rent'));
    expect(events.some(e => e.module === 'finance')).toBe(true);
  });
});

// ─── habits ──────────────────────────────────────────────────────────────────

describe('dissection.extract · habits', () => {
  it('routes "did my workout" to habits', () => {
    const events = asEvents(extract('did my workout'));
    expect(events.some(e => e.module === 'habits')).toBe(true);
  });
});

// ─── cycle · period start / end ──────────────────────────────────────────────

describe('dissection.extract · cycle', () => {
  it('detects period started', () => {
    const events = asEvents(extract('my period started today'));
    const e = events.find(x => x.module === 'cycle' && x.action === 'started');
    expect(e).toBeDefined();
  });

  it('detects period ended', () => {
    const events = asEvents(extract('period ended yesterday'));
    const e = events.find(x => x.module === 'cycle' && x.action === 'ended');
    expect(e).toBeDefined();
    expect(e?.daysAgo).toBe(1);
  });

  it('detects cramps symptom in cycle context', () => {
    const events = asEvents(extract('having cramps and my period started'));
    expect(events.some(e => e.module === 'cycle' && e.action === 'symptom' && e.data === 'cramps')).toBe(true);
  });

  it('detects unambiguous symptom (pms) without explicit cycle context', () => {
    const events = asEvents(extract('pms is awful'));
    expect(events.some(e => e.module === 'cycle' && e.action === 'symptom' && e.data === 'pms')).toBe(true);
  });
});

// ─── products ────────────────────────────────────────────────────────────────

describe('dissection.extract · products', () => {
  it('routes "need tampons" to grocery', () => {
    const events = asEvents(extract('need tampons'));
    expect(events.some(e => e.module === 'grocery' && e.action === 'add' && e.data === 'tampons')).toBe(true);
  });

  it('routes "bought a box of tampons" to cycle productUse with count 20', () => {
    const events = asEvents(extract('bought a box of tampons'));
    const e = events.find(x => x.module === 'cycle' && x.action === 'productUse');
    expect(e).toBeDefined();
    expect(e?.productType).toBe('tampon');
    expect(e?.productCount).toBe(20);
  });
});

// ─── daysAgo stamping ────────────────────────────────────────────────────────

describe('dissection.extract · daysAgo', () => {
  it('stamps daysAgo=1 for "yesterday"', () => {
    const events = asEvents(extract('went to the gym yesterday'));
    expect(events.every(e => e.daysAgo === 1)).toBe(true);
  });

  it('stamps daysAgo=3 for "3 days ago"', () => {
    const events = asEvents(extract('paid rent 3 days ago'));
    expect(events.every(e => e.daysAgo === 3)).toBe(true);
  });
});

// ─── question / answer ────────────────────────────────────────────────────────

describe('dissection.extract · answer routing', () => {
  it('returns an answer object for a direct question', () => {
    const result = extract('when did I last pay rent?');
    expect(isAnswer(result)).toBe(true);
    if (isAnswer(result)) {
      expect(result.type).toBe('answer');
      expect(result.lookupModules).toContain('finance');
    }
  });

  it('falls back to dump lookupModule for unrecognised question', () => {
    const result = extract('what is the meaning of life?');
    expect(isAnswer(result)).toBe(true);
    if (isAnswer(result)) {
      expect(result.lookupModules).toContain('dump');
    }
  });
});

// ─── deduplication ───────────────────────────────────────────────────────────

describe('dissection.extract · dedup', () => {
  it('does not emit the same event twice', () => {
    const events = asEvents(extract('period started, period started'));
    const startEvents = events.filter(e => e.module === 'cycle' && e.action === 'started');
    expect(startEvents).toHaveLength(1);
  });
});

// ─── fallbackRoute is re-exported ────────────────────────────────────────────

describe('dissection.fallbackRoute', () => {
  it('is exported directly', () => {
    expect(typeof fallbackRoute).toBe('function');
  });

  it('produces same result as extract', () => {
    const text = 'buy eggs and milk';
    expect(extract(text)).toEqual(fallbackRoute(text));
  });
});
