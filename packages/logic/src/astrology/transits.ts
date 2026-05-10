import type { AstronomyAPI, MoonPhase, TransitSnapshot } from './types';
import { BODIES } from './signs-and-bodies';
import { eclipticLongitudeOf, moonPhaseName } from './chart';
import { signIndexOf, signOf } from './houses';

// SunCalc is optional and browser-only; inject it the same way as astronomy.
export interface SunCalcAPI {
  getMoonIllumination: (date: Date) => { fraction: number; phase: number };
}

export function currentTransits(
  now: Date,
  astronomy: AstronomyAPI,
  sunCalc?: SunCalcAPI | null,
): TransitSnapshot {
  const planets: TransitSnapshot['planets'] = {};
  for (const name of BODIES) {
    const lon = eclipticLongitudeOf(name, now, null, astronomy);
    if (lon == null) continue;
    planets[name] = { longitude: lon, signName: signOf(lon), signIndex: signIndexOf(lon) };
  }

  let moonPhase: MoonPhase | null = null;
  if (sunCalc?.getMoonIllumination) {
    try {
      const ill = sunCalc.getMoonIllumination(now);
      moonPhase = {
        illumination: ill.fraction,
        waxing: ill.phase < 0.5,
        name: moonPhaseName(ill.fraction, ill.phase < 0.5),
      };
    } catch {
      // non-fatal
    }
  }

  return { timestamp: now.toISOString(), planets, moonPhase };
}
