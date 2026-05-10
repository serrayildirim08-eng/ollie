import type { Aspect, AspectType, OrbTable, Transit } from './types';
import { ASPECT_ANGLES, TRADITIONAL_ORBS } from './signs-and-bodies';

// ─── Math helpers ─────────────────────────────────────────────────────────────

export function normLongitude(d: number): number {
  let x = d % 360;
  if (x < 0) x += 360;
  return x;
}

export function angularDistance(a: number, b: number): number {
  const diff = Math.abs(normLongitude(a) - normLongitude(b));
  return Math.min(diff, 360 - diff);
}

// ─── Aspect detection ─────────────────────────────────────────────────────────

type PositionMap = Record<string, number | { longitude: number }>;

function extractLon(v: number | { longitude: number }): number | null {
  const lon = typeof v === 'number' ? v : v.longitude;
  return lon == null ? null : lon;
}

export function detectAspects(
  positions: PositionMap,
  orbs?: OrbTable,
): Aspect[] {
  const o = orbs ?? TRADITIONAL_ORBS;
  const bodies = Object.keys(positions ?? {});
  const out: Aspect[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      const la = extractLon(positions[a]);
      const lb = extractLon(positions[b]);
      if (la == null || lb == null) continue;
      const sep = angularDistance(la, lb);
      for (const type of Object.keys(ASPECT_ANGLES) as AspectType[]) {
        const diff = Math.abs(sep - ASPECT_ANGLES[type]);
        if (diff <= o[type]) {
          out.push({ p1: a, p2: b, type, angle: ASPECT_ANGLES[type], orb: Number(diff.toFixed(2)) });
          break;
        }
      }
    }
  }
  return out;
}

export function activeTransits(
  natal: { planets: PositionMap } | null | undefined,
  transits: { planets: PositionMap } | null | undefined,
  orbTight?: number | null,
): Transit[] {
  const t = orbTight != null ? orbTight : 1.0;
  if (!natal?.planets || !transits?.planets) return [];
  const out: Transit[] = [];
  for (const tb of Object.keys(transits.planets)) {
    const tL = extractLon(transits.planets[tb]);
    if (tL == null) continue;
    for (const nb of Object.keys(natal.planets)) {
      const nL = extractLon(natal.planets[nb]);
      if (nL == null) continue;
      const sep = angularDistance(tL, nL);
      for (const type of Object.keys(ASPECT_ANGLES) as AspectType[]) {
        const diff = Math.abs(sep - ASPECT_ANGLES[type]);
        if (diff <= t) {
          out.push({ transitBody: tb, natalBody: nb, type, angle: ASPECT_ANGLES[type], orb: Number(diff.toFixed(2)) });
          break;
        }
      }
    }
  }
  return out;
}
