import type { AspectType, BodyName, OrbTable, SignName } from './types';

export const SIGNS: SignName[] = [
  'aries','taurus','gemini','cancer','leo','virgo',
  'libra','scorpio','sagittarius','capricorn','aquarius','pisces',
];

export const BODIES: BodyName[] = [
  'sun','moon','mercury','venus','mars',
  'jupiter','saturn','uranus','neptune','pluto',
];

export const TRADITIONAL_ORBS: OrbTable = {
  conjunction: 8, opposition: 8, trine: 8, square: 7, sextile: 6,
};

export const MODERN_ORBS: OrbTable = {
  conjunction: 10, opposition: 10, trine: 10, square: 8, sextile: 6,
};

export const ASPECT_ANGLES: Record<AspectType, number> = {
  conjunction: 0, sextile: 60, square: 90, trine: 120, opposition: 180,
};

export const FORBIDDEN_COPY_SUBSTRINGS: string[] = [
  'worst','disaster','ruin','will fail','bad luck','doomed',
  'unloved','unlikeable','you will lose','terrible','catastroph',
  'you will ','this week you ','expect to','is going to',
  'you are a ','makes you ','this causes','is diagnosed as',
];

// Maps lower-case body name to astronomy-engine Body key
export const BODY_MAP: Record<BodyName, string> = {
  sun: 'Sun', moon: 'Moon', mercury: 'Mercury', venus: 'Venus',
  mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn',
  uranus: 'Uranus', neptune: 'Neptune', pluto: 'Pluto',
};
