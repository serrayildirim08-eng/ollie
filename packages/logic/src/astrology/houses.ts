import type { AnglePoint, SignName } from './types';
import { normLongitude } from './aspects';
import { SIGNS } from './signs-and-bodies';

export function signOf(lon: number): SignName | null {
  if (typeof lon !== 'number' || !isFinite(lon)) return null;
  return SIGNS[Math.floor(normLongitude(lon) / 30) % 12];
}

export function signIndexOf(lon: number): number | null {
  if (typeof lon !== 'number' || !isFinite(lon)) return null;
  return Math.floor(normLongitude(lon) / 30);
}

export function degreeWithinSign(lon: number): number | null {
  if (typeof lon !== 'number' || !isFinite(lon)) return null;
  return normLongitude(lon) % 30;
}

export function houseOf(
  lon: number | null | undefined,
  chart: { ascendant: AnglePoint | null } | null | undefined,
): number | null {
  if (lon == null || !chart?.ascendant) return null;
  const ascS = signIndexOf(chart.ascendant.longitude);
  const pS = signIndexOf(lon);
  if (ascS == null || pS == null) return null;
  return ((pS - ascS + 12) % 12) + 1;
}
