/**
 * apps/native · modules/brain/learn.ts  —  the learning-loop wiring ("learn YOU")
 *
 * Sprint 4. The native half of the per-person procrastination map:
 *   - READ the raw signals Sprint 1 captured: `brain_deferral_events` (every
 *     postpone — what she chose to defer, with module/category) and
 *     `brain_harm_events` (spoiled / late / missed — did letting it slide hurt).
 *   - GROUP them into buckets at two granularities (DECISION 1 coarse→fine):
 *       coarse = the cold-start category/module bucket (groceries / bills / …)
 *       fine   = `${coarse}:${item}` when the deferred noticing named an item
 *     and, per bucket, count defers + how many are tied to a harm event.
 *   - LEARN each bucket via the PURE @ollie/logic/brain · learnBucket (cautious
 *     MIN_SAMPLE gate; harm flips to 'protect').
 *   - PERSIST the resulting verdicts into `brain_learned_map` (recomputed on
 *     boot / after a dump — NOT on every render) and read user pins from
 *     `brain_pins`.
 *   - EXPOSE a resolver the Sprint-2 selector consults: USER PIN > learned
 *     (if confident) > cold-start default.
 *
 * SILENT (DECISION 3): nothing here emits copy or a notification. The behaviour
 * just quietly adapts. No-shame throughout — this is "what's genuinely fine for
 * HER to let rest", never blame.
 *
 * Best-effort: every read/write is isolated; a failure yields an empty map
 * (→ pure cold-start) rather than throwing into the boot / dump / render path.
 */

import {
  learnBucket,
  resolveDeferability,
  verdictToDeferability,
  type BucketObservations,
  type LearnedMap,
  type LearnedVerdict,
  type Pin,
  type NoticingCandidate,
  type DeferabilityResolver,
} from '@ollie/logic/brain';

import { sql } from '../../storage';
import { migrateBrain } from './migrate';

// ─── reading the raw signals ───────────────────────────────────────────────

interface DeferralRow {
  noticing_id: string;
  module: string | null;
  category: string | null;
  deferred_at: number;
  [col: string]: unknown;
}

interface HarmRow {
  ref_kind: string;
  harm_kind: string;
  [col: string]: unknown;
}

/**
 * The cold-start "domain" a deferral or a harm belongs to — the coarse bucket
 * key. Kept aligned with select.ts's category/module map so a learned verdict
 * keys onto the same family the cold-start default would resolve. Lower-cased.
 *
 * A deferral row keys off its category (falling back to its module); a harm row
 * keys off its harm_kind + ref_kind. The two must AGREE for a defer to count as
 * "this kind of deferral later hurt", so we normalise both onto the same small
 * vocabulary.
 */
const HARM_DOMAIN: Record<string, string> = {
  spoiled: 'groceries', // a pantry item turned
  late: 'bills', // a recurring bill slipped
  missed: 'deadlines', // a deadline / renewal passed
};

/** Normalise a deferral row's (category, module) → its coarse bucket key. */
export function coarseBucketOf(category: string | null, module: string | null): string {
  const cat = (category ?? '').toLowerCase();
  const mod = (module ?? '').toLowerCase();
  // harm-origin noticings carry the harm_kind as their category.
  if (cat in HARM_DOMAIN) return HARM_DOMAIN[cat];
  // grocery replenish + stale-list + the grocery module → groceries.
  if (cat.includes('replenish') || cat.includes('grocery') || mod === 'grocery') return 'groceries';
  if (cat.includes('bill') || cat.includes('late') || mod === 'finance') return 'bills';
  if (
    cat.includes('deadline') ||
    cat.includes('overdue') ||
    cat.includes('due') ||
    cat.includes('renewal') ||
    cat.includes('missed') ||
    mod === 'admin'
  ) {
    return 'deadlines';
  }
  if (cat.includes('med') || cat.includes('dose') || mod === 'medication') return 'meds';
  if (cat.includes('health') || cat.includes('symptom') || mod === 'body' || mod === 'cycle') return 'health';
  if (cat.includes('chore') || cat.includes('errand') || mod === 'habits') return 'chores';
  if (cat.includes('social') || cat.includes('call')) return 'social';
  // fall back to the module name so unmapped modules still bucket consistently.
  return mod || cat || 'other';
}

/** The harm domain a harm row belongs to (or null if it has no learning home). */
function harmDomainOf(h: HarmRow): string | null {
  return HARM_DOMAIN[(h.harm_kind ?? '').toLowerCase()] ?? null;
}

/**
 * Recover the fine-grain item from a deferral row, when the noticing named one.
 * The noticing id is `${module}:${detectorId-or-copy}` or `harm:…`. We can't
 * always recover a clean item from the id, so the fine bucket is only minted
 * when the category itself encodes an item (replenish detectors namespace it).
 * Conservative: when in doubt we DON'T mint a fine bucket — coarse still learns.
 */
function fineItemOf(row: DeferralRow): string | null {
  // Pattern noticing ids look like `grocery:grocery-replenish-needed`. Some
  // detectors append the item, e.g. `grocery:grocery-replenish-needed:milk`.
  const id = row.noticing_id ?? '';
  const parts = id.split(':');
  if (parts.length >= 3 && parts[0] !== 'harm') {
    const tail = parts[parts.length - 1].trim();
    if (tail && !/^\d+$/.test(tail)) return tail.toLowerCase();
  }
  return null;
}

// ─── bucketing + harm linkage ──────────────────────────────────────────────

interface BucketTally extends BucketObservations {
  coarse: string;
}

/**
 * Build per-bucket observation tallies from the raw deferral + harm rows.
 *
 * Harm linkage (DECISION 2 fuel): a deferral "led to harm" when its COARSE
 * domain saw at least one harm event. We attribute harm at the coarse-domain
 * level (not per-row, which we can't reliably join), so the harm RATE per
 * bucket is `min(domainHarmCount, deferCount) / deferCount` — i.e. how much of
 * her deferring in this family coincided with real harm. A fine bucket inherits
 * its coarse domain's harm signal (milk spoiling is groceries-domain harm).
 *
 * Pure given its inputs; exported for unit testing without a DB.
 */
export function tallyBuckets(
  deferrals: DeferralRow[],
  harms: HarmRow[],
): Map<string, BucketTally> {
  // harm counts per coarse domain.
  const harmByDomain = new Map<string, number>();
  for (const h of harms) {
    const dom = harmDomainOf(h);
    if (!dom) continue;
    harmByDomain.set(dom, (harmByDomain.get(dom) ?? 0) + 1);
  }

  // defer counts per bucket key (both coarse + fine).
  const deferByKey = new Map<string, { coarse: string; count: number }>();
  for (const d of deferrals) {
    const coarse = coarseBucketOf(d.category, d.module);
    bump(deferByKey, coarse, coarse);
    const item = fineItemOf(d);
    if (item) bump(deferByKey, `${coarse}:${item}`, coarse);
  }

  const out = new Map<string, BucketTally>();
  for (const [key, { coarse, count }] of deferByKey) {
    const domainHarm = harmByDomain.get(coarse) ?? 0;
    out.set(key, {
      coarse,
      deferCount: count,
      // harm can't exceed the defers it's attributed against.
      harmCount: Math.min(domainHarm, count),
    });
  }
  return out;
}

function bump(
  m: Map<string, { coarse: string; count: number }>,
  key: string,
  coarse: string,
): void {
  const cur = m.get(key);
  if (cur) cur.count += 1;
  else m.set(key, { coarse, count: 1 });
}

// ─── persistence ───────────────────────────────────────────────────────────

interface VerdictRow {
  bucket: string;
  deferability: string;
  confidence: number;
  sample_size: number;
  harm_rate: number;
  [col: string]: unknown;
}

interface PinRow {
  bucket: string;
  pin: string;
  [col: string]: unknown;
}

/**
 * Recompute the learned map from the raw event tables and persist the verdicts
 * into `brain_learned_map` (replacing the prior snapshot). Returns the number of
 * buckets that produced a TRUSTED (non-'unknown') verdict — purely for tests /
 * introspection; nothing user-facing. Best-effort; never throws.
 *
 * Fired from recomputeBrain on boot / after a dump (NOT per render).
 */
export async function recomputeLearnedMap(now: number = Date.now()): Promise<number> {
  try {
    await migrateBrain();
    const [deferrals, harms] = await Promise.all([
      sql.select<DeferralRow>(
        `SELECT noticing_id, module, category, deferred_at FROM brain_deferral_events`,
      ),
      sql.select<HarmRow>(`SELECT ref_kind, harm_kind FROM brain_harm_events`),
    ]);

    const buckets = tallyBuckets(deferrals, harms);

    // Compute every verdict, then replace the snapshot in one pass.
    const rows: Array<VerdictRow> = [];
    for (const [bucket, tally] of buckets) {
      const v = learnBucket(tally);
      rows.push({
        bucket,
        deferability: v.deferability,
        confidence: v.confidence,
        sample_size: v.sampleSize,
        harm_rate: v.harmRate,
      });
    }

    await sql.execute(`DELETE FROM brain_learned_map`);
    let trusted = 0;
    for (const r of rows) {
      await sql.execute(
        `INSERT INTO brain_learned_map
           (bucket, deferability, confidence, sample_size, harm_rate, computed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [r.bucket, r.deferability, r.confidence, r.sample_size, r.harm_rate, now],
      );
      if (r.deferability !== 'unknown') trusted += 1;
    }
    return trusted;
  } catch (err) {
    console.error('[brain] recomputeLearnedMap failed (non-fatal):', err);
    return 0;
  }
}

/**
 * Load the persisted learned map (verdicts + pins) for the selector. Best-
 * effort: an empty map means pure cold-start, which is the correct cold-start
 * behaviour. Never throws.
 */
export async function loadLearnedMap(): Promise<LearnedMap> {
  try {
    await migrateBrain();
    const [verdictRows, pinRows] = await Promise.all([
      sql.select<VerdictRow>(
        `SELECT bucket, deferability, confidence, sample_size, harm_rate FROM brain_learned_map`,
      ),
      sql.select<PinRow>(`SELECT bucket, pin FROM brain_pins`),
    ]);

    const verdicts: Record<string, LearnedVerdict> = {};
    for (const r of verdictRows) {
      verdicts[r.bucket] = {
        deferability: r.deferability as LearnedVerdict['deferability'],
        confidence: r.confidence,
        sampleSize: r.sample_size,
        harmRate: r.harm_rate,
      };
    }

    const pins: Record<string, Pin> = {};
    for (const r of pinRows) {
      if (r.pin === 'protect' || r.pin === 'ok-to-defer') pins[r.bucket] = r.pin;
    }

    return { verdicts, pins };
  } catch (err) {
    console.error('[brain] loadLearnedMap failed (non-fatal):', err);
    return { verdicts: {} };
  }
}

// ─── user pins (DECISION 4 — the override) ─────────────────────────────────

/**
 * Set / clear a user pin for a bucket — the correction that WINS over both the
 * learned verdict and the cold-start default. `pin = null` removes it.
 *
 * No settings UI ships this sprint, but this is the function a future
 * "always protect X" / "always ok to defer Y" toggle calls. Keys are the same
 * bucket strings the selector resolves: a coarse domain ('groceries') or a
 * fine `${domain}:${item}` ('groceries:milk'). Best-effort; never throws.
 */
export async function setPin(bucket: string, pin: Pin | null): Promise<void> {
  const key = (bucket ?? '').toString().trim().toLowerCase();
  if (!key) return;
  try {
    await migrateBrain();
    if (pin == null) {
      await sql.execute(`DELETE FROM brain_pins WHERE bucket = ?`, [key]);
      return;
    }
    await sql.execute(
      `INSERT INTO brain_pins (bucket, pin, set_at)
       VALUES (?, ?, ?)
       ON CONFLICT(bucket) DO UPDATE SET pin = excluded.pin, set_at = excluded.set_at`,
      [key, pin, Date.now()],
    );
  } catch (err) {
    console.error('[brain] setPin failed (non-fatal):', err);
  }
}

// ─── the resolver the selector consults ────────────────────────────────────

/**
 * Key a noticing candidate onto its coarse + fine bucket — exactly the keys
 * recomputeLearnedMap / setPin write. The fine bucket is minted only when the
 * candidate names an item (Sprint-3 `facts.items`), mirroring the conservative
 * fine-bucketing in tallyBuckets so a learned fine verdict actually matches.
 */
export function bucketKeysFor(candidate: NoticingCandidate): { coarse: string; fine: string | null } {
  const coarse = coarseBucketOf(candidate.category ?? null, candidate.module ?? null);
  const item = candidate.facts?.items?.[0];
  const fine = item ? `${coarse}:${item.toString().trim().toLowerCase()}` : null;
  return { coarse, fine };
}

/**
 * Build the {@link DeferabilityResolver} the Sprint-2 selector consults. Given a
 * loaded map, returns a pure function that for each candidate applies USER PIN >
 * learned (if confident) > cold-start, returning the numeric deferability the
 * scorer should use (or null = keep cold-start). This is the ONE seam plugged
 * into selectNoticings; nothing else in selection changes.
 */
export function makeDeferabilityResolver(map: LearnedMap): DeferabilityResolver {
  return (candidate) => {
    const { coarse, fine } = bucketKeysFor(candidate);
    const resolved = resolveDeferability(map, fine, coarse);
    // null when nothing learned/pinned applied → caller keeps cold-start.
    return verdictToDeferability(resolved.deferability);
  };
}
