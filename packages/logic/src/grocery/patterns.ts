/**
 * @ollie/logic · grocery · pattern detectors
 *
 * Pure functions — no I/O, no wall-clock reads.
 * `now` is always an explicit millisecond timestamp passed by the caller.
 */

import type {
  GroceryHistory,
  GroceryOpts,
  DuplicateSignal,
  ExpirationDriftSignal,
  StockoutCascadeSignal,
  StaleListSignal,
  ShoppingCadenceSignal,
  GroceryPattern,
  PantryItem,
  ShoppingItem,
} from './types';
import { ALIAS_TABLE } from './data';

const DAY_MS = 86_400_000;

function resolveNow(history: GroceryHistory | null, opts: GroceryOpts): number {
  if (history && typeof history.now === 'number') return history.now;
  if (typeof opts.now === 'number') return opts.now;
  return 0;
}

function resolvePantry(history: GroceryHistory | null): PantryItem[] {
  return Array.isArray(history?.pantry) ? history!.pantry : [];
}

function resolveItems(history: GroceryHistory | null): ShoppingItem[] {
  return Array.isArray(history?.items) ? history!.items : [];
}

function shelfLife(item: PantryItem): number {
  if (typeof item.shelfLifeDays === 'number') return item.shelfLifeDays;
  const key = ((item.normalizedName ?? item.name) ?? '').toLowerCase();
  return ALIAS_TABLE[key]?.shelfLifeDays ?? 14;
}

// ─── detectDuplicate ─────────────────────────────────────────────────────

export function detectDuplicate(
  history: GroceryHistory | null,
  opts: GroceryOpts = {},
): DuplicateSignal | null {
  const now = resolveNow(history, opts);
  const pantry = resolvePantry(history);
  const newName = opts.newCanonical ?? (history as GroceryHistory & { newCanonical?: string } | null)?.newCanonical;
  if (!newName || pantry.length === 0) return null;
  const target = String(newName).toLowerCase().trim();

  for (const p of pantry) {
    if (!p) continue;
    const pname = ((p.normalizedName ?? p.name) ?? '').toLowerCase().trim();
    if (pname !== target) continue;
    if (typeof p.boughtTs !== 'number') continue;
    const shelf = shelfLife(p);
    const daysSince = (now - p.boughtTs) / DAY_MS;
    if (daysSince > shelf) continue;
    return {
      pattern: 'grocery-duplicate-buy',
      confidence: daysSince < shelf * 0.5 ? 'high' : 'medium',
      sample_n: 1,
      name: target,
      days_since_purchase: Math.round(daysSince * 10) / 10,
      copy: `you got ${target} ${Math.max(1, Math.round(daysSince))} day${Math.round(daysSince) === 1 ? '' : 's'} ago. heads up.`,
      source: 'Altgassen et al. 2014, Br J Clin Psychol',
    };
  }
  return null;
}

// ─── detectExpirationDrift ───────────────────────────────────────────────

export function detectExpirationDrift(
  history: GroceryHistory | null,
  opts: GroceryOpts = {},
): ExpirationDriftSignal | null {
  const now = resolveNow(history, opts);
  const pantry = resolvePantry(history);
  if (pantry.length === 0) return null;
  const windowDays = typeof opts.windowDays === 'number' ? opts.windowDays : 3;
  const drifting: Array<{ name: string; days: number }> = [];

  for (const p of pantry) {
    if (!p || typeof p.boughtTs !== 'number') continue;
    const shelf = shelfLife(p);
    const expiresAt = p.boughtTs + shelf * DAY_MS;
    const daysToExpiry = (expiresAt - now) / DAY_MS;
    if (daysToExpiry <= windowDays && daysToExpiry > -7) {
      drifting.push({ name: (p.normalizedName ?? p.name ?? ''), days: Math.round(daysToExpiry * 10) / 10 });
    }
  }

  if (drifting.length === 0) return null;
  return {
    pattern: 'grocery-expiration-drift',
    confidence: drifting.length >= 2 ? 'high' : 'medium',
    sample_n: drifting.length,
    items: drifting,
    copy: drifting.length === 1
      ? `${drifting[0].name} turns soon. one breakfast away. or compost.`
      : `${drifting.length} items turn this week. ${drifting.slice(0, 3).map(d => d.name).join(', ')}.`,
    source: 'Barkley & Murphy 2010, Arch Clin Neuropsychol',
  };
}

// ─── detectStockoutCascade ───────────────────────────────────────────────

export function detectStockoutCascade(
  history: GroceryHistory | null,
  opts: GroceryOpts = {},
): StockoutCascadeSignal | null {
  const now = resolveNow(history, opts);
  const pantry = resolvePantry(history);
  const items = resolveItems(history);
  const windowDays = typeof opts.windowDays === 'number' ? opts.windowDays : 60;
  const minRebuys = typeof opts.minRebuys === 'number' ? opts.minRebuys : 3;
  const cutoff = now - windowDays * DAY_MS;

  const counts: Record<string, number> = {};
  const allBought = [
    ...pantry,
    ...items.filter(i => i?.checked === true && typeof i.boughtTs === 'number'),
  ];
  for (const p of allBought) {
    if (!p || typeof p.boughtTs !== 'number') continue;
    if (p.boughtTs < cutoff || p.boughtTs > now) continue;
    const k = ((p.normalizedName ?? p.name) ?? '').toLowerCase().trim();
    if (!k) continue;
    counts[k] = (counts[k] ?? 0) + 1;
  }

  const cascading = Object.entries(counts)
    .filter(([, v]) => v >= minRebuys)
    .map(([name, count]) => ({ name, count }));
  if (cascading.length === 0) return null;
  cascading.sort((a, b) => b.count - a.count);
  const top = cascading[0];
  return {
    pattern: 'grocery-stockout-cascade',
    confidence: top.count >= 4 ? 'high' : 'medium',
    sample_n: top.count,
    items: cascading,
    name: top.name,
    copy: `you keep buying ${top.name}. ${top.count} times in ${windowDays} days. promote to staple?`,
    source: 'Wood & Neal 2007, Psychol Rev',
  };
}

// ─── detectStaleListItems ────────────────────────────────────────────────

export function detectStaleListItems(
  history: GroceryHistory | null,
  opts: GroceryOpts = {},
): StaleListSignal | null {
  const now = resolveNow(history, opts);
  const minDays = opts.minDays ?? 14;
  const minCount = opts.minCount ?? 3;
  const items = resolveItems(history);
  const cutoff = now - minDays * DAY_MS;

  const stale = items.filter(
    it => it && it.checked !== true && typeof it.ts === 'number' && it.ts <= cutoff,
  );
  if (stale.length < minCount) return null;
  const sample = stale.slice(0, 5).map(it => String(it.name ?? it.text ?? 'item'));
  return {
    pattern: 'stale-shopping-list',
    confidence: stale.length >= 6 ? 'high' : 'medium',
    sample_n: stale.length,
    stale_count: stale.length,
    sample_names: sample,
    copy: `${stale.length} items have been on the list ≥${minDays} days. wishlist drift. clear what you don't actually want.`,
  };
}

// ─── detectShoppingCadence ───────────────────────────────────────────────

export function detectShoppingCadence(
  history: GroceryHistory | null,
  opts: GroceryOpts = {},
): ShoppingCadenceSignal | null {
  const now = resolveNow(history, opts);
  const minEvents = opts.minEvents ?? 6;
  const windowDays = typeof opts.windowDays === 'number' ? opts.windowDays : 90;
  const windowStart = now - windowDays * DAY_MS;
  const items = resolveItems(history);

  const events = items
    .filter(it => it && typeof it.boughtTs === 'number' && it.boughtTs >= windowStart && it.boughtTs <= now)
    .map(it => it.boughtTs as number)
    .sort((a, b) => a - b);
  if (events.length < minEvents) return null;

  const tripDays = new Set(
    events.map(t => {
      const d = new Date(t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }),
  );
  const trips = Array.from(tripDays).sort();
  if (trips.length < 3) return null;

  const tripTs = trips.map(k => Date.parse(k + 'T12:00:00'));
  const gaps: number[] = [];
  for (let i = 1; i < tripTs.length; i++) gaps.push((tripTs[i] - tripTs[i - 1]) / DAY_MS);
  const avg = gaps.reduce((s, x) => s + x, 0) / gaps.length;
  const avgRounded = Math.round(avg * 10) / 10;

  return {
    pattern: 'shopping-cadence',
    confidence: trips.length >= 6 ? 'high' : 'medium',
    sample_n: trips.length,
    trips_count: trips.length,
    avg_gap_days: avgRounded,
    copy: `~${avgRounded} days between grocery trips on average. ${trips.length} trips in ${windowDays} days.`,
  };
}

// ─── detectPatterns (batch) ──────────────────────────────────────────────

export function detectPatterns(
  history: GroceryHistory | null,
  opts: GroceryOpts = {},
): GroceryPattern[] {
  const out: GroceryPattern[] = [];
  try { const a = detectExpirationDrift(history, opts); if (a) out.push(a); } catch (_) { /* pass */ }
  try { const b = detectStockoutCascade(history, opts); if (b) out.push(b); } catch (_) { /* pass */ }
  try { const c = detectStaleListItems(history, opts); if (c) out.push(c); } catch (_) { /* pass */ }
  try { const d = detectShoppingCadence(history, opts); if (d) out.push(d); } catch (_) { /* pass */ }
  return out;
}
