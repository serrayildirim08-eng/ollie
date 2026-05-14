/**
 * @ollie/research-cache — 10-sector aggregated pattern cache.
 *
 * Reads from the anonymized `research_corpus` Supabase table (no user_id),
 * computes per-sector signal aggregates, caches them in memory + Supabase
 * materialized view, and exposes:
 *   - getSectorPatterns(sector) — top pattern tags w/ counts + ratios
 *   - getCorpusSnapshot(sector, range) — paginated raw snapshot for B2B
 *     portal export (CSV / chart feed)
 *
 * Sectors are LOCKED per Serra 2026-05-14: tech/law/med/fin/edu/creative/
 * parenting/hospitality/gov/other. Anything outside the enum is rejected
 * by the orchestrator before write.
 *
 * Used by:
 *   - In-app "users like you" insights (consumer value)
 *   - B2B pitch portal (sales asset, future sprint wires the portal UI)
 *
 * This package is read-only over the corpus. Writes happen in the
 * orchestrator → ai-proxy /label → research_corpus chain.
 */

export const SECTORS = [
  'tech',
  'law',
  'med',
  'fin',
  'edu',
  'creative',
  'parenting',
  'hospitality',
  'gov',
  'other',
] as const;

export type Sector = (typeof SECTORS)[number];

export function isSector(s: string): s is Sector {
  return (SECTORS as readonly string[]).includes(s);
}

export interface PatternStat {
  /** Pattern tag emitted by the Anthropic labeling pass (adhd_pattern_tag). */
  tag: string;
  /** Number of corpus rows with this tag in the sector. */
  count: number;
  /** Share of sector corpus that matched (0..1). */
  ratio: number;
}

export interface DateRange {
  start: number; // ms epoch inclusive
  end: number;   // ms epoch exclusive
}

export interface CorpusRow {
  corpus_id: string;
  scrubbed_text: string;
  label_json: {
    mood_signal?: string;
    content_type?: string;
    urgency_tier?: string;
    adhd_pattern_tag?: string;
    sector_relevance?: number;
    confidence?: number;
  };
  sector: Sector;
  locale: string;
  created_at: number;
}

export interface CorpusSnapshot {
  sector: Sector;
  range: DateRange;
  total: number;
  rows: CorpusRow[];
}

/** Minimum sample size before exposing a sector pattern publicly. */
export const SECTOR_PATTERN_FLOOR = 10;

/**
 * Source contract — the orchestrator wires this to Supabase via REST.
 * Decoupled so research-cache stays test-friendly (memory mock + fake).
 */
export interface CorpusSource {
  fetchRows(sector: Sector, range: DateRange): Promise<CorpusRow[]>;
  countSector(sector: Sector): Promise<number>;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h — patterns don't move fast
type CacheEntry<T> = { ts: number; value: T };
const patternCache = new Map<Sector, CacheEntry<PatternStat[]>>();

let sourceRef: CorpusSource | null = null;

export function configureResearchCache(opts: { source: CorpusSource }): void {
  sourceRef = opts.source;
}

export function _resetResearchCache(): void {
  sourceRef = null;
  patternCache.clear();
}

/**
 * Get aggregated pattern stats for a sector. Cached for 1h. Returns
 * patterns with count >= SECTOR_PATTERN_FLOOR (10). Below floor returns
 * [] — we don't expose sparse data as insights.
 */
export async function getSectorPatterns(sector: string): Promise<PatternStat[]> {
  if (!isSector(sector)) return [];
  if (!sourceRef) return [];

  const now = Date.now();
  const cached = patternCache.get(sector);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }

  // Pull the last 90 days for pattern aggregation. Beyond that we trust the
  // future portal to slice ranges explicitly.
  const range: DateRange = {
    start: now - 90 * 24 * 60 * 60 * 1000,
    end: now,
  };
  const rows = await sourceRef.fetchRows(sector, range);

  const counts = new Map<string, number>();
  for (const row of rows) {
    const tag = row.label_json.adhd_pattern_tag;
    if (!tag) continue;
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  const total = rows.length;
  const stats: PatternStat[] = [];
  for (const [tag, count] of counts) {
    if (count < SECTOR_PATTERN_FLOOR) continue;
    stats.push({ tag, count, ratio: total === 0 ? 0 : count / total });
  }
  stats.sort((a, b) => b.count - a.count);

  patternCache.set(sector, { ts: now, value: stats });
  return stats;
}

/**
 * Get raw corpus snapshot for a sector + range. Designed for B2B portal
 * export (CSV download) — the portal UI is a future sprint, but the API
 * shape is locked here so the future build can consume without churn.
 *
 * `rows` carry scrubbed_text + label JSON only. No user_id, no device_id,
 * no anything that links back to a person.
 */
export async function getCorpusSnapshot(
  sector: string,
  range: DateRange,
): Promise<CorpusSnapshot | null> {
  if (!isSector(sector)) return null;
  if (!sourceRef) return null;

  const rows = await sourceRef.fetchRows(sector, range);
  const total = await sourceRef.countSector(sector);

  return {
    sector,
    range,
    total,
    rows,
  };
}
