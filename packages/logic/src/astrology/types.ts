// Minimal subset of the astronomy-engine API used by this module.
// Callers inject a real instance (window.Astronomy) or a test mock.
export interface AstronomyObserver {
  latitude: number;
  longitude: number;
  height: number;
}

export interface AstronomyAPI {
  Body: Record<string, unknown>;
  Observer: new (lat: number, lng: number, height: number) => AstronomyObserver;
  Equator: (body: unknown, date: Date, observer: AstronomyObserver | null, ofdate: boolean, aberration: boolean) => { ra: number; dec: number };
  Ecliptic: (equ: { ra: number; dec: number }) => { elon: number; elat: number };
  SiderealTime: (date: Date) => number; // returns GST in hours
}

// ─── Domain types ────────────────────────────────────────────────────────────

export type SignName =
  | 'aries' | 'taurus' | 'gemini' | 'cancer' | 'leo' | 'virgo'
  | 'libra' | 'scorpio' | 'sagittarius' | 'capricorn' | 'aquarius' | 'pisces';

export type BodyName =
  | 'sun' | 'moon' | 'mercury' | 'venus' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto';

export type AspectType = 'conjunction' | 'sextile' | 'square' | 'trine' | 'opposition';

export type OrbTable = Record<AspectType, number>;

export interface PlanetPosition {
  longitude: number;
  signName: SignName | null;
  signIndex: number | null;
  retrograde?: boolean;
  house?: number | null;
}

export interface AnglePoint {
  longitude: number;
  signName: SignName | null;
  signIndex: number | null;
}

export interface Aspect {
  p1: string;
  p2: string;
  type: AspectType;
  angle: number;
  orb: number;
}

export interface Transit {
  transitBody: string;
  natalBody: string;
  type: AspectType;
  angle: number;
  orb: number;
}

export type MoonPhaseName =
  | 'new_moon' | 'waxing_crescent' | 'first_quarter' | 'waxing_gibbous'
  | 'full_moon' | 'waning_gibbous' | 'last_quarter' | 'waning_crescent';

export interface MoonPhase {
  illumination: number;
  waxing: boolean;
  name: MoonPhaseName | null;
}

export interface NatalChart {
  birthData: BirthData;
  computedAt: string;
  ephemerisVersion: string;
  houseSystem: 'whole_sign';
  planets: Record<string, PlanetPosition>;
  ascendant: AnglePoint | null;
  mc: AnglePoint | null;
  confidence_flags: string[];
  aspects: Aspect[];
}

export interface TransitSnapshot {
  timestamp: string;
  planets: Record<string, PlanetPosition>;
  moonPhase: MoonPhase | null;
}

export interface BirthData {
  date: string;             // 'YYYY-MM-DD'
  time?: string;            // 'HH:MM' local
  tz_iana?: string;
  lat?: number;
  lng?: number;
  locationLabel?: string;
  precision?: string;
}

export interface ImmutableFieldCheck {
  changed: string[];
  isFirstSave: boolean;
}
