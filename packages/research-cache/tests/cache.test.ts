import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SECTOR_PATTERN_FLOOR,
  SECTORS,
  type CorpusRow,
  type CorpusSource,
  type DateRange,
  type Sector,
  _resetResearchCache,
  configureResearchCache,
  getCorpusSnapshot,
  getSectorPatterns,
  isSector,
} from '../src/index';

function makeRow(tag: string, sector: Sector = 'tech'): CorpusRow {
  return {
    corpus_id: crypto.randomUUID(),
    scrubbed_text: 'scrubbed-text',
    label_json: { adhd_pattern_tag: tag, confidence: 0.9 },
    sector,
    locale: 'en',
    created_at: Date.now(),
  };
}

function memorySource(seed: CorpusRow[]): CorpusSource {
  return {
    async fetchRows(sector: Sector, _range: DateRange) {
      return seed.filter((r) => r.sector === sector);
    },
    async countSector(sector: Sector) {
      return seed.filter((r) => r.sector === sector).length;
    },
  };
}

describe('@ollie/research-cache', () => {
  beforeEach(() => _resetResearchCache());
  afterEach(() => _resetResearchCache());

  it('exposes the locked 10-sector list', () => {
    expect(SECTORS).toEqual([
      'tech', 'law', 'med', 'fin', 'edu', 'creative',
      'parenting', 'hospitality', 'gov', 'other',
    ]);
  });

  it('isSector accepts only locked sectors', () => {
    expect(isSector('tech')).toBe(true);
    expect(isSector('crypto')).toBe(false);
    expect(isSector('')).toBe(false);
  });

  it('returns [] for unknown sector', async () => {
    configureResearchCache({ source: memorySource([]) });
    expect(await getSectorPatterns('crypto')).toEqual([]);
  });

  it('returns [] when sector empty (no source rows)', async () => {
    configureResearchCache({ source: memorySource([]) });
    expect(await getSectorPatterns('tech')).toEqual([]);
  });

  it('respects SECTOR_PATTERN_FLOOR (suppress sparse patterns)', async () => {
    // 5 rows tagged 'hyperfocus' — below the 10 floor
    const seed = Array.from({ length: 5 }, () => makeRow('hyperfocus'));
    configureResearchCache({ source: memorySource(seed) });
    const stats = await getSectorPatterns('tech');
    expect(stats).toEqual([]);
  });

  it('returns ≥1 pattern after 50 seeded opt-in samples in tech sector (acceptance criterion 5)', async () => {
    // mix of tags — 50 hyperfocus, 30 task-switching, 20 deadline-anxiety
    const seed: CorpusRow[] = [];
    for (let i = 0; i < 50; i++) seed.push(makeRow('hyperfocus'));
    for (let i = 0; i < 30; i++) seed.push(makeRow('task-switching'));
    for (let i = 0; i < 20; i++) seed.push(makeRow('deadline-anxiety'));

    configureResearchCache({ source: memorySource(seed) });
    const stats = await getSectorPatterns('tech');

    expect(stats.length).toBeGreaterThanOrEqual(1);
    expect(stats[0].tag).toBe('hyperfocus');
    expect(stats[0].count).toBe(50);
    // All three exceed floor
    expect(stats).toHaveLength(3);
    // Sorted by count desc
    expect(stats[0].count).toBeGreaterThanOrEqual(stats[1].count);
    expect(stats[1].count).toBeGreaterThanOrEqual(stats[2].count);
  });

  it('ratio sums match per-tag count / total tagged rows', async () => {
    const seed: CorpusRow[] = [];
    for (let i = 0; i < SECTOR_PATTERN_FLOOR + 5; i++) seed.push(makeRow('a'));
    for (let i = 0; i < SECTOR_PATTERN_FLOOR + 5; i++) seed.push(makeRow('b'));

    configureResearchCache({ source: memorySource(seed) });
    const stats = await getSectorPatterns('tech');
    expect(stats).toHaveLength(2);
    expect(stats[0].ratio).toBeCloseTo(0.5, 2);
    expect(stats[1].ratio).toBeCloseTo(0.5, 2);
  });

  it('getCorpusSnapshot returns rows + total for B2B export', async () => {
    const seed: CorpusRow[] = Array.from({ length: 15 }, (_, i) =>
      makeRow(i % 2 === 0 ? 'hyperfocus' : 'task-switching'),
    );
    configureResearchCache({ source: memorySource(seed) });

    const snap = await getCorpusSnapshot('tech', {
      start: Date.now() - 1000 * 60 * 60 * 24,
      end: Date.now() + 1000,
    });
    expect(snap).not.toBeNull();
    expect(snap!.sector).toBe('tech');
    expect(snap!.total).toBe(15);
    expect(snap!.rows).toHaveLength(15);
    // anonymized — no user_id field
    for (const r of snap!.rows) {
      expect(Object.keys(r)).not.toContain('user_id');
    }
  });

  it('getCorpusSnapshot returns null for invalid sector', async () => {
    configureResearchCache({ source: memorySource([]) });
    const snap = await getCorpusSnapshot('crypto', { start: 0, end: 1 });
    expect(snap).toBeNull();
  });
});
