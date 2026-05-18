import type {
  AnglePoint, AstronomyAPI, BirthData, ImmutableFieldCheck,
  MoonPhaseName, NatalChart,
} from './types';
import { BODIES, BODY_MAP, FORBIDDEN_COPY_SUBSTRINGS } from './signs-and-bodies';
import { detectAspects, normLongitude } from './aspects';
import { signIndexOf, signOf, houseOf } from './houses';

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function moonPhaseName(illum: number, waxing: boolean): MoonPhaseName | null {
  if (typeof illum !== 'number') return null;
  const i = Math.max(0, Math.min(1, illum));
  if (i < 0.03) return 'new_moon';
  if (i > 0.97) return 'full_moon';
  if (i < 0.47) return waxing ? 'waxing_crescent' : 'waning_crescent';
  if (i < 0.53) return waxing ? 'first_quarter' : 'last_quarter';
  return waxing ? 'waxing_gibbous' : 'waning_gibbous';
}

export function isForbiddenCopy(text: string): boolean {
  if (typeof text !== 'string') return false;
  const l = text.toLowerCase();
  return FORBIDDEN_COPY_SUBSTRINGS.some((s: string) => l.includes(s));
}

export function detectImmutableFields(
  neu: Partial<BirthData> | null | undefined,
  old: Partial<BirthData> | null | undefined,
): ImmutableFieldCheck {
  if (!old) return { changed: [], isFirstSave: true };
  const fields = ['date','time','tz_iana','lat','lng','locationLabel'] as const;
  const changed = fields.filter(f => {
    const a = neu?.[f];
    const b = old?.[f];
    if (f === 'lat' || f === 'lng') return Math.abs(((a as number) || 0) - ((b as number) || 0)) > 0.001;
    return a !== b;
  });
  return { changed, isFirstSave: false };
}

// ─── Ephemeris helpers (astronomy-injected) ───────────────────────────────────

export function eclipticLongitudeOf(
  bodyName: string,
  date: Date,
  observer: ReturnType<AstronomyAPI['Observer']['prototype']['constructor']> | null,
  astronomy: AstronomyAPI,
): number | null {
  try {
    const body = astronomy.Body[BODY_MAP[bodyName as keyof typeof BODY_MAP]];
    if (body === undefined) return null;
    const equ = astronomy.Equator(body, date, observer, true, true);
    const ecl = astronomy.Ecliptic(equ);
    return normLongitude(ecl.elon);
  } catch {
    return null;
  }
}

export function computeAscendantMC(
  date: Date,
  lat: number,
  lng: number,
  astronomy: AstronomyAPI,
): { ascendant: AnglePoint | null; mc: AnglePoint | null } {
  try {
    const gst = astronomy.SiderealTime(date);
    const lstHours = ((gst + lng / 15) % 24 + 24) % 24;
    const lstRad = lstHours * 15 * Math.PI / 180;
    const latRad = lat * Math.PI / 180;
    const obliqRad = 23.4392911 * Math.PI / 180;
    const mcRad = Math.atan2(Math.sin(lstRad), Math.cos(lstRad) * Math.cos(obliqRad));
    const mcDeg = normLongitude(mcRad * 180 / Math.PI);
    const ascRad = Math.atan2(
      Math.cos(lstRad),
      -(Math.sin(lstRad) * Math.cos(obliqRad) + Math.tan(latRad) * Math.sin(obliqRad)),
    );
    let ascDeg = normLongitude(ascRad * 180 / Math.PI);
    if ((ascDeg - mcDeg + 360) % 360 < 60) ascDeg = (ascDeg + 180) % 360;
    return {
      ascendant: { longitude: ascDeg, signName: signOf(ascDeg), signIndex: signIndexOf(ascDeg) },
      mc: { longitude: mcDeg, signName: signOf(mcDeg), signIndex: signIndexOf(mcDeg) },
    };
  } catch {
    return { ascendant: null, mc: null };
  }
}

// ─── birthDateTime — no wall-clock reads ─────────────────────────────────────

export function birthDateTime(bd: BirthData | null | undefined): Date | null {
  if (!bd?.date) return null;
  const [Y, M, D] = String(bd.date).split('-').map(n => parseInt(n, 10));
  const time = bd.time ?? '12:00';
  const [h, m] = time.split(':').map(n => parseInt(n, 10));
  if (!isFinite(Y) || !isFinite(M) || !isFinite(D)) return null;
  return new Date(Y, M - 1, D, isFinite(h) ? h : 12, isFinite(m) ? m : 0);
}

// ─── computeNatalChart ────────────────────────────────────────────────────────

export function computeNatalChart(
  birthData: BirthData,
  astronomy: AstronomyAPI,
): NatalChart | null {
  const date = birthDateTime(birthData);
  if (!date) return null;
  const lat = typeof birthData.lat === 'number' ? birthData.lat : 0;
  const lng = typeof birthData.lng === 'number' ? birthData.lng : 0;
  let observer: ReturnType<AstronomyAPI['Observer']['prototype']['constructor']> | null;
  try { observer = new astronomy.Observer(lat, lng, 0); } catch { observer = null; }

  const planets: NatalChart['planets'] = {};
  for (const name of BODIES) {
    const lon = eclipticLongitudeOf(name, date, observer, astronomy);
    if (lon == null) continue;
    planets[name] = { longitude: lon, signName: signOf(lon), signIndex: signIndexOf(lon), retrograde: false };
  }
  const am = computeAscendantMC(date, lat, lng, astronomy);
  if (am.ascendant) {
    for (const name of Object.keys(planets)) {
      planets[name].house = houseOf(planets[name].longitude, { ascendant: am.ascendant });
    }
  }
  const confidence_flags: string[] = [];
  if (birthData.precision === 'unknown' || !birthData.time) confidence_flags.push('birth_time_unknown');

  return {
    birthData,
    computedAt: date.toISOString(),   // deterministic: uses birth date, not Date.now()
    ephemerisVersion: 'astronomy-engine@2.1.19',
    houseSystem: 'whole_sign',
    planets,
    ascendant: am.ascendant,
    mc: am.mc,
    confidence_flags,
    aspects: detectAspects(
      Object.fromEntries(Object.entries(planets).map(([k, v]) => [k, v.longitude])),
    ),
  };
}
