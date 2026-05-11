/**
 * Typed adapter: wraps astronomy-engine@2.1.19 to satisfy the AstronomyAPI
 * interface defined in @ollie/logic/astrology. Injected into computeNatalChart
 * and currentTransits — never used directly by UI components.
 *
 * Why the Ecliptic wrapper exists: the logic interface declares
 *   Ecliptic(equ: {ra, dec}) => {elon, elat}
 * but the real astronomy-engine Ecliptic(vec: Vector) needs a Vector with a
 * time component (.t). When our Equator wrapper returns the real
 * EquatorialCoordinates (which carries .vec), we can recover the Vector here.
 */

import * as Astronomy from 'astronomy-engine';
import type { AstronomyAPI, AstronomyObserver } from '@ollie/logic/astrology';

// ─── Equator return carries .vec so Ecliptic can use it ──────────────────────
// The AstronomyAPI interface says Equator returns {ra, dec}; the real return
// is EquatorialCoordinates which also has .vec. We keep the extra field by
// widening the return type locally — callers in @ollie/logic only read ra/dec,
// but our Ecliptic wrapper reads .vec.

type EquWithVec = { ra: number; dec: number; vec: Astronomy.Vector };

function equatorWrapper(
  body: unknown,
  date: Date,
  observer: AstronomyObserver | null,
  ofdate: boolean,
  aberration: boolean,
): EquWithVec {
  const realObserver = observer
    ? new Astronomy.Observer(observer.latitude, observer.longitude, observer.height)
    : new Astronomy.Observer(0, 0, 0);
  const result = Astronomy.Equator(
    body as Astronomy.Body,
    date,
    realObserver,
    ofdate,
    aberration,
  );
  return { ra: result.ra, dec: result.dec, vec: result.vec };
}

function eclipticWrapper(equ: { ra: number; dec: number }): { elon: number; elat: number } {
  // equ is actually EquWithVec at runtime (returned by equatorWrapper above).
  const vec = (equ as EquWithVec).vec;
  if (!vec) {
    // Fallback: approximate via spherical → cartesian conversion (no time-dependent
    // nutation, so this is less precise; should only happen in tests/mocks).
    const raRad  = equ.ra  * (Math.PI / 180) * 15; // ra is in hours; convert to radians
    const decRad = equ.dec * (Math.PI / 180);
    const obl    = 23.4392911 * (Math.PI / 180);
    const x = Math.cos(decRad) * Math.cos(raRad);
    const y = Math.cos(decRad) * Math.sin(raRad);
    const z = Math.sin(decRad);
    const eLon = Math.atan2(y * Math.cos(obl) + z * Math.sin(obl), x) * (180 / Math.PI);
    return { elon: ((eLon % 360) + 360) % 360, elat: 0 };
  }
  const ecl = Astronomy.Ecliptic(vec);
  return { elon: ecl.elon, elat: ecl.elat };
}

// ─── Exported adapter ────────────────────────────────────────────────────────

export const astronomyAPI: AstronomyAPI = {
  Body: Astronomy.Body as unknown as Record<string, unknown>,
  Observer: Astronomy.Observer as unknown as new (
    lat: number,
    lng: number,
    height: number,
  ) => AstronomyObserver,
  Equator: equatorWrapper as AstronomyAPI['Equator'],
  Ecliptic: eclipticWrapper,
  SiderealTime: (date: Date) => Astronomy.SiderealTime(date),
};
