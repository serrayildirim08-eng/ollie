import { describe, it, expect } from 'vitest';
import {
  normLongitude,
  angularDistance,
  signOf,
  signIndexOf,
  degreeWithinSign,
  houseOf,
  detectAspects,
  activeTransits,
  moonPhaseName,
  isForbiddenCopy,
  detectImmutableFields,
  birthDateTime,
  eclipticLongitudeOf,
  computeAscendantMC,
  computeNatalChart,
  currentTransits,
} from '../src/astrology';
import type { AstronomyAPI, AstronomyObserver } from '../src/astrology';

// ─── Minimal mock for AstronomyAPI ───────────────────────────────────────────

function makeMockAstronomy(
  equFn?: (body: unknown, date: Date) => { ra: number; dec: number },
  siderealFn?: (date: Date) => number,
): AstronomyAPI {
  const defaultEqu = () => ({ ra: 0, dec: 0 });
  const defaultSidereal = () => 6; // GST hours
  return {
    Body: {
      Sun: 'Sun', Moon: 'Moon', Mercury: 'Mercury', Venus: 'Venus',
      Mars: 'Mars', Jupiter: 'Jupiter', Saturn: 'Saturn',
      Uranus: 'Uranus', Neptune: 'Neptune', Pluto: 'Pluto',
    },
    Observer: class implements AstronomyObserver {
      latitude: number; longitude: number; height: number;
      constructor(lat: number, lng: number, h: number) {
        this.latitude = lat; this.longitude = lng; this.height = h;
      }
    },
    Equator: equFn ?? defaultEqu,
    Ecliptic: ({ ra }: { ra: number; dec: number }) => ({ elon: ra * 15, elat: 0 }),
    SiderealTime: siderealFn ?? defaultSidereal,
  };
}

// ─── normLongitude ────────────────────────────────────────────────────────────

describe('normLongitude', () => {
  it('keeps 0–359 unchanged', () => {
    expect(normLongitude(270)).toBe(270);
  });
  it('wraps 360 → 0', () => {
    expect(normLongitude(360)).toBe(0);
  });
  it('wraps negative', () => {
    expect(normLongitude(-30)).toBe(330);
  });
});

// ─── angularDistance ──────────────────────────────────────────────────────────

describe('angularDistance', () => {
  it('returns 0 for same longitude', () => {
    expect(angularDistance(45, 45)).toBe(0);
  });
  it('returns 180 for opposition', () => {
    expect(angularDistance(0, 180)).toBe(180);
  });
  it('uses shortest arc', () => {
    expect(angularDistance(10, 350)).toBe(20);
  });
});

// ─── signOf / signIndexOf / degreeWithinSign ──────────────────────────────────

describe('signOf', () => {
  it('0° = aries', () => expect(signOf(0)).toBe('aries'));
  it('30° = taurus', () => expect(signOf(30)).toBe('taurus'));
  it('270° = capricorn', () => expect(signOf(270)).toBe('capricorn'));
  it('non-finite → null', () => expect(signOf(NaN)).toBeNull());
});

describe('signIndexOf', () => {
  it('returns 0 for aries', () => expect(signIndexOf(15)).toBe(0));
  it('returns 11 for pisces', () => expect(signIndexOf(350)).toBe(11));
});

describe('degreeWithinSign', () => {
  it('returns 15 for 45°', () => expect(degreeWithinSign(45)).toBe(15));
  it('returns 0 for 0°', () => expect(degreeWithinSign(0)).toBe(0));
});

// ─── houseOf ─────────────────────────────────────────────────────────────────

describe('houseOf', () => {
  it('returns house 1 when planet matches ascendant sign', () => {
    expect(houseOf(15, { ascendant: { longitude: 0, signName: 'aries', signIndex: 0 } })).toBe(1);
  });
  it('returns house 2 when one sign ahead', () => {
    expect(houseOf(45, { ascendant: { longitude: 0, signName: 'aries', signIndex: 0 } })).toBe(2);
  });
  it('returns null for null planet', () => {
    expect(houseOf(null, { ascendant: { longitude: 0, signName: 'aries', signIndex: 0 } })).toBeNull();
  });
});

// ─── detectAspects ────────────────────────────────────────────────────────────

describe('detectAspects', () => {
  it('detects conjunction', () => {
    const aspects = detectAspects({ sun: 10, moon: 15 });
    expect(aspects.some(a => a.type === 'conjunction' && a.p1 === 'sun' && a.p2 === 'moon')).toBe(true);
  });
  it('detects opposition', () => {
    const aspects = detectAspects({ sun: 0, moon: 180 });
    expect(aspects.some(a => a.type === 'opposition')).toBe(true);
  });
  it('detects trine within orb', () => {
    const aspects = detectAspects({ sun: 0, moon: 123 }); // 3° from 120
    expect(aspects.some(a => a.type === 'trine')).toBe(true);
  });
  it('no aspect for wide separation', () => {
    const aspects = detectAspects({ sun: 0, moon: 50 }); // none at 50°
    expect(aspects.length).toBe(0);
  });
  it('accepts object positions with .longitude', () => {
    const aspects = detectAspects({ sun: { longitude: 0 }, moon: { longitude: 90 } });
    expect(aspects.some(a => a.type === 'square')).toBe(true);
  });
});

// ─── activeTransits ───────────────────────────────────────────────────────────

describe('activeTransits', () => {
  it('returns empty for null input', () => {
    expect(activeTransits(null, null)).toEqual([]);
  });
  it('finds tight transit', () => {
    const natal = { planets: { sun: 10 } };
    const transits = { planets: { saturn: 10.5 } };
    const result = activeTransits(natal, transits, 1.0);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].type).toBe('conjunction');
  });
  it('misses transit outside orbTight', () => {
    const natal = { planets: { sun: 10 } };
    const transits = { planets: { saturn: 13 } };
    expect(activeTransits(natal, transits, 1.0)).toHaveLength(0);
  });
});

// ─── moonPhaseName ────────────────────────────────────────────────────────────

describe('moonPhaseName', () => {
  it('new_moon at 0', () => expect(moonPhaseName(0, true)).toBe('new_moon'));
  it('full_moon at 1', () => expect(moonPhaseName(1, true)).toBe('full_moon'));
  it('waxing_crescent', () => expect(moonPhaseName(0.2, true)).toBe('waxing_crescent'));
  it('waning_gibbous', () => expect(moonPhaseName(0.7, false)).toBe('waning_gibbous'));
});

// ─── isForbiddenCopy ──────────────────────────────────────────────────────────

describe('isForbiddenCopy', () => {
  it('flags "this is a disaster"', () => expect(isForbiddenCopy('this is a disaster')).toBe(true));
  it('flags "doomed to fail"', () => expect(isForbiddenCopy('doomed to fail')).toBe(true));
  it('passes clean text', () => expect(isForbiddenCopy('mercury moves into gemini')).toBe(false));
  it('returns false for non-string', () => expect(isForbiddenCopy(42 as unknown as string)).toBe(false));
});

// ─── detectImmutableFields ────────────────────────────────────────────────────

describe('detectImmutableFields', () => {
  it('isFirstSave when no old', () => {
    expect(detectImmutableFields({ date: '1990-01-01' }, null)).toEqual({ changed: [], isFirstSave: true });
  });
  it('detects changed date', () => {
    const r = detectImmutableFields({ date: '1991-01-01' }, { date: '1990-01-01' });
    expect(r.changed).toContain('date');
    expect(r.isFirstSave).toBe(false);
  });
  it('ignores tiny coordinate drift < 0.001', () => {
    const r = detectImmutableFields({ lat: 41.0001 }, { lat: 41.0 });
    expect(r.changed).not.toContain('lat');
  });
});

// ─── birthDateTime ────────────────────────────────────────────────────────────

describe('birthDateTime', () => {
  it('parses date+time correctly', () => {
    const d = birthDateTime({ date: '1990-06-15', time: '14:30' });
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(1990);
    expect(d!.getMonth()).toBe(5); // 0-indexed
    expect(d!.getDate()).toBe(15);
    expect(d!.getHours()).toBe(14);
  });
  it('defaults to noon when time is missing', () => {
    const d = birthDateTime({ date: '1990-06-15' });
    expect(d!.getHours()).toBe(12);
  });
  it('returns null for invalid date', () => {
    expect(birthDateTime({ date: 'nope' })).toBeNull();
  });
});

// ─── eclipticLongitudeOf (mock) ───────────────────────────────────────────────

describe('eclipticLongitudeOf', () => {
  it('returns normalised longitude from mock', () => {
    // ra=6h → elon = 6*15 = 90°
    const ast = makeMockAstronomy(() => ({ ra: 6, dec: 0 }));
    const lon = eclipticLongitudeOf('sun', new Date(), null, ast);
    expect(lon).toBe(90);
  });
  it('returns null for unknown body', () => {
    const ast = makeMockAstronomy();
    (ast.Body as Record<string, unknown>)['Sun'] = undefined;
    const lon = eclipticLongitudeOf('sun', new Date(), null, ast);
    expect(lon).toBeNull();
  });
});

// ─── computeAscendantMC (mock) ────────────────────────────────────────────────

describe('computeAscendantMC', () => {
  it('returns ascendant and mc as AnglePoints', () => {
    const ast = makeMockAstronomy(undefined, () => 0);
    const result = computeAscendantMC(new Date(), 41, 29, ast);
    expect(result.ascendant).not.toBeNull();
    expect(result.mc).not.toBeNull();
    expect(result.ascendant!.signName).not.toBeNull();
  });
});

// ─── computeNatalChart (mock) ─────────────────────────────────────────────────

describe('computeNatalChart', () => {
  it('returns a chart with planets and aspects', () => {
    // Mock: Sun=0°, all others=120° → trine to sun
    const ast = makeMockAstronomy(
      (body: unknown) => ({ ra: body === 'Sun' ? 0 : 8, dec: 0 }),
      () => 0,
    );
    const chart = computeNatalChart(
      { date: '1990-06-15', time: '14:30', lat: 41, lng: 29 },
      ast,
    );
    expect(chart).not.toBeNull();
    expect(Object.keys(chart!.planets).length).toBeGreaterThan(0);
    expect(chart!.houseSystem).toBe('whole_sign');
    expect(Array.isArray(chart!.aspects)).toBe(true);
  });
  it('adds birth_time_unknown flag when time missing', () => {
    const ast = makeMockAstronomy(undefined, () => 0);
    const chart = computeNatalChart({ date: '1990-06-15', lat: 41, lng: 29 }, ast);
    expect(chart!.confidence_flags).toContain('birth_time_unknown');
  });
  it('returns null for invalid birthData', () => {
    const ast = makeMockAstronomy(undefined, () => 0);
    expect(computeNatalChart({ date: 'invalid' }, ast)).toBeNull();
  });
  it('computedAt is deterministic (birth date, not now)', () => {
    const ast = makeMockAstronomy(undefined, () => 0);
    const chart1 = computeNatalChart({ date: '1990-06-15', time: '14:30', lat: 41, lng: 29 }, ast);
    const chart2 = computeNatalChart({ date: '1990-06-15', time: '14:30', lat: 41, lng: 29 }, ast);
    expect(chart1!.computedAt).toBe(chart2!.computedAt);
  });
});

// ─── currentTransits (mock) ───────────────────────────────────────────────────

describe('currentTransits', () => {
  it('returns planets and null moonPhase without SunCalc', () => {
    const ast = makeMockAstronomy(undefined, () => 0);
    const now = new Date('2024-03-20T12:00:00Z');
    const snap = currentTransits(now, ast);
    expect(snap.timestamp).toBe(now.toISOString());
    expect(Object.keys(snap.planets).length).toBeGreaterThan(0);
    expect(snap.moonPhase).toBeNull();
  });
  it('returns moonPhase when SunCalc injected', () => {
    const ast = makeMockAstronomy(undefined, () => 0);
    const now = new Date('2024-03-20T12:00:00Z');
    const sunCalc = { getMoonIllumination: () => ({ fraction: 0.99, phase: 0.02 }) };
    const snap = currentTransits(now, ast, sunCalc);
    expect(snap.moonPhase?.name).toBe('full_moon');
  });
});
