import { describe, it, expect } from 'vitest';
import {
  segment,
  extractRuleBased,
  stripCodeFence,
  snapToWordBoundaries,
  filterInSpan,
  mergeOverlappingEntries,
  validateEntry,
  tokenize,
  levenshtein1,
  searchEntries,
  resurface,
  resurfaceAnniversaries,
  resurfacePhaseAnniversaries,
  resurfaceSemanticEchoes,
  resurfaceFilterRecency,
  resurfaceMMR,
  extractionPromptFor,
  type StoredEntry,
  type JournalEntry,
} from '../src/journal';

const DAY = 86_400_000;
const NOW = 1_746_000_000_000; // fixed epoch for determinism

// ─── segment ─────────────────────────────────────────────────────────

describe('segment', () => {
  it('returns [] for empty string', () => {
    expect(segment('')).toEqual([]);
    expect(segment('   ')).toEqual([]);
  });

  it('splits on double newline (paragraphs)', () => {
    const result = segment('first para\n\nsecond para');
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('first para');
    expect(result[1].text).toBe('second para');
  });

  it('assigns correct start/end offsets', () => {
    // Use longer texts so neither is merged as a tiny fragment (<4 chars)
    const raw = 'first chunk\n\nsecond chunk';
    const result = segment(raw);
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(11);
    expect(result[1].start).toBe(13);
    expect(result[1].end).toBe(25);
  });

  it('merges tiny trailing fragment into previous span', () => {
    // "Bye" is only 3 chars — should be merged into the prior span
    const raw = 'Hello world. Bye';
    const result = segment(raw);
    // The last segment "Bye" is short and should be absorbed
    expect(result.every(s => s.text.trim().length >= 4 || result.length === 1)).toBe(true);
  });
});

// ─── extractRuleBased ────────────────────────────────────────────────

describe('extractRuleBased', () => {
  it('extracts emotion words present in text', () => {
    const r = extractRuleBased('I feel so anxious and overwhelmed today');
    expect(r.emotions).toContain('anxious');
    expect(r.emotions).toContain('overwhelmed');
  });

  it('does not include emotions not in text', () => {
    const r = extractRuleBased('just went for a walk');
    expect(r.emotions).toHaveLength(0);
  });

  it('extracts questions', () => {
    const r = extractRuleBased('Why does everything feel so hard? Not sure what to do.');
    expect(r.questions.length).toBeGreaterThan(0);
    expect(r.questions[0]).toContain('?');
  });

  it('extracts decisions via pattern', () => {
    const r = extractRuleBased('I decided to quit the job.');
    expect(r.decisions.some(d => /decided/i.test(d))).toBe(true);
  });

  it('extracts time anchors', () => {
    const r = extractRuleBased('yesterday I slept terribly');
    expect(r.time_anchors.some(ta => ta.text === 'yesterday')).toBe(true);
  });

  it('generates summary when text > 120 chars', () => {
    const long = 'This is a fairly long journal entry that goes well beyond one hundred and twenty characters in total length so it triggers the summary path.';
    expect(long.length).toBeGreaterThan(120);
    const r = extractRuleBased(long);
    expect(r.summary).not.toBeNull();
    expect((r.summary ?? '').length).toBeLessThanOrEqual(80);
  });

  it('no summary for short text', () => {
    const r = extractRuleBased('short text');
    expect(r.summary).toBeNull();
  });

  it('filters user entities by presence in text', () => {
    const r = extractRuleBased('met with Serra at home', {
      people: ['Serra', 'Burhan'],
      places: ['home', 'office'],
    });
    expect(r.people).toContain('Serra');
    expect(r.people).not.toContain('Burhan');
    expect(r.places).toContain('home');
    expect(r.places).not.toContain('office');
  });
});

// ─── stripCodeFence ───────────────────────────────────────────────────

describe('stripCodeFence', () => {
  it('strips ```json ... ``` wrapper', () => {
    const raw = '```json\n{"entries":[]}\n```';
    expect(stripCodeFence(raw)).toBe('{"entries":[]}');
  });

  it('strips plain ``` wrapper', () => {
    expect(stripCodeFence('```\n{}\n```')).toBe('{}');
  });

  it('passes through plain JSON unchanged', () => {
    expect(stripCodeFence('{"entries":[]}')).toBe('{"entries":[]}');
  });

  it('returns non-string input unchanged', () => {
    expect(stripCodeFence(42)).toBe(42);
    expect(stripCodeFence(null)).toBe(null);
  });
});

// ─── snapToWordBoundaries ─────────────────────────────────────────────

describe('snapToWordBoundaries', () => {
  it('expands a span that cuts mid-word', () => {
    const text = 'hello world';
    // start=1, end=9 cuts "ello wor" — expand to full words
    const { start, end } = snapToWordBoundaries(text, 1, 9);
    expect(start).toBe(0);   // expanded back to 'h'
    expect(end).toBe(11);    // expanded to end of 'world'
  });

  it('leaves clean boundaries unchanged', () => {
    const text = 'hello world';
    const { start, end } = snapToWordBoundaries(text, 0, 5);
    expect(start).toBe(0);
    expect(end).toBe(5);
  });

  it('clamps to [0, text.length]', () => {
    const { start, end } = snapToWordBoundaries('abc', -5, 100);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeLessThanOrEqual(3);
  });
});

// ─── filterInSpan ─────────────────────────────────────────────────────

describe('filterInSpan', () => {
  it('keeps items present in span text', () => {
    expect(filterInSpan(['anxious', 'sad'], 'I am feeling anxious')).toEqual(['anxious']);
  });

  it('is case-insensitive', () => {
    expect(filterInSpan(['ANXIOUS'], 'feeling anxious today')).toEqual(['ANXIOUS']);
  });

  it('returns [] for non-array', () => {
    expect(filterInSpan(null as unknown as [], 'text')).toEqual([]);
  });
});

// ─── mergeOverlappingEntries ─────────────────────────────────────────

describe('mergeOverlappingEntries', () => {
  const makeEntry = (start: number, end: number): JournalEntry => ({
    span: { start, end },
    summary: null,
    people: [],
    places: [],
    emotions: [],
    questions: [],
    decisions: [],
    time_anchors: [],
    module_hints: [],
  });

  it('returns [] for empty input', () => {
    expect(mergeOverlappingEntries([])).toEqual([]);
  });

  it('merges overlapping spans', () => {
    const merged = mergeOverlappingEntries([makeEntry(0, 50), makeEntry(48, 100)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].span.end).toBe(100);
  });

  it('drops micro-fragments < 8 chars', () => {
    const result = mergeOverlappingEntries([makeEntry(0, 5)]);
    expect(result).toHaveLength(0);
  });

  it('keeps non-overlapping entries separate', () => {
    const result = mergeOverlappingEntries([makeEntry(0, 20), makeEntry(30, 60)]);
    expect(result).toHaveLength(2);
  });
});

// ─── validateEntry ────────────────────────────────────────────────────

describe('validateEntry', () => {
  it('rejects null', () => {
    expect(validateEntry(null).valid).toBe(false);
  });

  it('rejects banned field mood_score', () => {
    const { valid, errors } = validateEntry({ mood_score: 5 });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('mood_score'))).toBe(true);
  });

  it('rejects summary > 80 chars', () => {
    const long = 'a'.repeat(81);
    const { valid, errors } = validateEntry({ summary: long });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('summary >80'))).toBe(true);
  });

  it('accepts valid entry', () => {
    const { valid } = validateEntry({ summary: 'short summary', emotions: [] });
    expect(valid).toBe(true);
  });
});

// ─── tokenize + levenshtein1 ──────────────────────────────────────────

describe('tokenize', () => {
  it('lowercases and splits', () => {
    expect(tokenize('Hello World')).toContain('hello');
    expect(tokenize('Hello World')).toContain('world');
  });

  it('removes stopwords', () => {
    const toks = tokenize('the cat is on the mat');
    expect(toks).not.toContain('the');
    expect(toks).not.toContain('is');
    expect(toks).not.toContain('on');
  });

  it('filters single-char tokens', () => {
    // 'a' and 'I' are 1 char — filtered. 'go' is 2 chars — kept.
    const toks = tokenize('a I go');
    expect(toks).not.toContain('a');
    expect(toks).not.toContain('i');
    expect(toks).toContain('go');
  });
});

describe('levenshtein1', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein1('cat', 'cat')).toBe(0);
  });

  it('returns 1 for one substitution', () => {
    expect(levenshtein1('cat', 'bat')).toBe(1);
  });

  it('returns 2 for strings > 1 apart', () => {
    expect(levenshtein1('cat', 'dog')).toBe(2);
  });

  it('returns 1 for insertion', () => {
    expect(levenshtein1('car', 'cars')).toBe(1);
  });
});

// ─── searchEntries ────────────────────────────────────────────────────

describe('searchEntries', () => {
  const entries: StoredEntry[] = [
    { ts: 1000, text_rendered: 'feeling anxious about rent payment' },
    { ts: 2000, text_rendered: 'had a great walk in the park' },
    { ts: 3000, text_rendered: 'anxious again about the deadline' },
  ];

  it('returns [] for empty entries', () => {
    expect(searchEntries([], 'query')).toEqual([]);
  });

  it('returns [] for empty query', () => {
    expect(searchEntries(entries, '')).toEqual([]);
  });

  it('ranks entries containing query terms higher', () => {
    const results = searchEntries(entries, 'anxious');
    expect(results[0].entry.ts).not.toBe(2000); // walk entry should not be first
    expect(results.every(r => r.score > 0)).toBe(true);
  });

  it('fuzzy-matches near-typo (1 substitution)', () => {
    // 'anxiots' vs 'anxious': 1 substitution at position 6 — covered by levenshtein1
    const results = searchEntries(entries, 'anxiots');
    expect(results.length).toBeGreaterThan(0);
  });
});

// ─── resurface ────────────────────────────────────────────────────────

describe('resurface', () => {
  it('returns empty buckets for empty entries', () => {
    const r = resurface([], NOW);
    expect(r.weekAgo).toHaveLength(0);
    expect(r.yearAgo).toHaveLength(0);
  });

  it('places entry in weekAgo bucket', () => {
    const ts = NOW - 7 * DAY;
    const entries: StoredEntry[] = [{ ts, text_rendered: 'a week ago entry' }];
    const r = resurface(entries, NOW);
    expect(r.weekAgo.length).toBeGreaterThan(0);
  });
});

// ─── resurfaceAnniversaries ───────────────────────────────────────────

describe('resurfaceAnniversaries', () => {
  it('returns [] for empty entries', () => {
    expect(resurfaceAnniversaries([], NOW)).toEqual([]);
  });

  it('detects a year-ago entry', () => {
    const ts = NOW - 365 * DAY;
    const entries: StoredEntry[] = [{ ts, text_rendered: 'year ago' }];
    const result = resurfaceAnniversaries(entries, NOW);
    const yearBucket = result.find(b => b.offsetDays === 365);
    expect(yearBucket).toBeDefined();
    expect(yearBucket?.entries).toHaveLength(1);
  });
});

// ─── resurfacePhaseAnniversaries ──────────────────────────────────────

describe('resurfacePhaseAnniversaries', () => {
  it('returns [] with fewer than 2 cycles', () => {
    const entries: StoredEntry[] = [{ ts: NOW - 5 * DAY, text: 'test' }];
    expect(resurfacePhaseAnniversaries(entries, [], NOW)).toEqual([]);
    expect(resurfacePhaseAnniversaries(entries, [{ cycleStartTs: NOW - 10 * DAY }], NOW)).toEqual([]);
  });

  it('finds matching cycle-day entry from prior cycle', () => {
    // current cycle starts 5 days ago → today is cycle day 6
    const currentStart = NOW - 5 * DAY;
    // prior cycle started 33 days ago (cycle day 6 would be NOW - 33 + 5 = NOW - 28)
    const priorStart = NOW - 33 * DAY;
    const priorCycleDay6 = priorStart + 5 * DAY; // day 6 of prior cycle

    const entries: StoredEntry[] = [{ ts: priorCycleDay6, text: 'headache on cycle day 6' }];
    const cycles = [
      { cycleStartTs: priorStart, cycleLengthDays: 28 },
      { cycleStartTs: currentStart, cycleLengthDays: 28 },
    ];

    const result = resurfacePhaseAnniversaries(entries, cycles, NOW);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].cycleDay).toBe(6);
  });
});

// ─── resurfaceSemanticEchoes ──────────────────────────────────────────

describe('resurfaceSemanticEchoes', () => {
  it('returns [] when no entries old enough', () => {
    const entries: StoredEntry[] = [{ ts: NOW - DAY, text_rendered: 'anxious about rent' }];
    const r = resurfaceSemanticEchoes(entries, 'anxious', NOW, { minDaysOld: 14 });
    expect(r).toEqual([]);
  });

  it('returns matching old entries', () => {
    const old = { ts: NOW - 30 * DAY, text_rendered: 'so anxious about the rent payment' };
    const r = resurfaceSemanticEchoes([old], 'anxious rent', NOW, { minDaysOld: 14 });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].daysSince).toBeGreaterThan(14);
  });
});

// ─── resurfaceFilterRecency ───────────────────────────────────────────

describe('resurfaceFilterRecency', () => {
  it('returns all candidates when recentlyShown is empty', () => {
    const candidates: StoredEntry[] = [{ ts: 1000, text: 'x' }];
    expect(resurfaceFilterRecency(candidates, [], 3 * DAY * 24, NOW)).toHaveLength(1);
  });

  it('filters out recently shown entries', () => {
    const candidates: StoredEntry[] = [
      { ts: 1000, text: 'a' },
      { ts: 2000, text: 'b' },
    ];
    const recentlyShown = [{ ts: 1000, seenAt: NOW - DAY }];
    const result = resurfaceFilterRecency(candidates, recentlyShown, 3 * DAY, NOW);
    expect(result).toHaveLength(1);
    expect((result[0] as StoredEntry).ts).toBe(2000);
  });
});

// ─── resurfaceMMR ─────────────────────────────────────────────────────

describe('resurfaceMMR', () => {
  it('returns [] for empty input', () => {
    expect(resurfaceMMR([])).toEqual([]);
  });

  it('returns single item unchanged', () => {
    const c = [{ ts: 1, text: 'hello world', score: 1 }] as unknown[];
    expect(resurfaceMMR(c as StoredEntry[])).toHaveLength(1);
  });

  it('dedupes near-identical entries', () => {
    const c = [
      { ts: 1, text: 'feeling anxious stressed overwhelmed today', score: 0.9 },
      { ts: 2, text: 'feeling anxious stressed overwhelmed today', score: 0.8 },
      { ts: 3, text: 'went for a long walk in the forest', score: 0.5 },
    ] as unknown[];
    const result = resurfaceMMR(c as StoredEntry[], { maxOut: 2 });
    expect(result).toHaveLength(2);
    // Should pick the diverse one (ts:3) over the duplicate (ts:2)
    const tsList = result.map(r => (r as { ts: number }).ts);
    expect(tsList).toContain(1); // highest score
    expect(tsList).toContain(3); // diverse
  });
});

// ─── extractionPromptFor ─────────────────────────────────────────────

describe('extractionPromptFor', () => {
  it('returns correct model and max_tokens', () => {
    const p = extractionPromptFor('some text');
    expect(p.model).toBe('claude-haiku-4-5-20251001');
    expect(p.max_tokens).toBe(1200);
  });

  it('includes rawText as user message', () => {
    const p = extractionPromptFor('hello');
    expect(p.messages[0].content).toBe('hello');
    expect(p.messages[0].role).toBe('user');
  });

  it('system prompt contains module list', () => {
    const p = extractionPromptFor('x');
    expect(p.system).toContain('cycle');
    expect(p.system).toContain('grocery');
  });
});
