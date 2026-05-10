/**
 * @ollie/logic · grocery · known-store learning
 *
 * Pure function — no I/O, no wall-clock reads.
 */

import type { KnownStore, GeoCoords } from './types';

const EARTH_R = 6_371_000;
const TO_RAD = Math.PI / 180;

function haversine(a: GeoCoords, b: GeoCoords): number {
  const dLat = (b.lat - a.lat) * TO_RAD;
  const dLng = (b.lng - a.lng) * TO_RAD;
  const lat1 = a.lat * TO_RAD;
  const lat2 = b.lat * TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/**
 * Record a GPS visit and update the list of known stores.
 * Returns a new array (does not mutate the input).
 */
export function learnKnownStore(
  coords: GeoCoords | null,
  knownStores: KnownStore[],
  nowTs: number,
): KnownStore[] {
  const list = Array.isArray(knownStores) ? knownStores.slice() : [];
  if (!coords || typeof coords.lat !== 'number' || typeof coords.lng !== 'number') return list;

  let matchedIdx = -1;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
    if (haversine(coords, s) <= 80) { matchedIdx = i; break; }
  }

  if (matchedIdx >= 0) {
    const s = list[matchedIdx];
    list[matchedIdx] = { ...s, visitCount: (s.visitCount ?? 1) + 1, lastSeenTs: nowTs };
  } else {
    list.push({ lat: coords.lat, lng: coords.lng, visitCount: 1, lastSeenTs: nowTs });
  }
  return list;
}
