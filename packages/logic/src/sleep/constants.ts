/**
 * @ollie/logic · sleep constants
 *
 * Shared lookup tables. Pure data — no I/O, no DOM.
 */

export const QUALITY_MAP: Record<string, number> = {
  rough: 2, bad: 2, awful: 1, terrible: 1, horrible: 1,
  meh: 3, ok: 3, okay: 3, alright: 3, fine: 3,
  good: 4, great: 5, amazing: 5, restful: 5, perfect: 5,
};

export const DEFAULT_TOKENS: Record<string, string[]> = {
  caffeine: ['coffee', 'espresso', 'caffeine', 'latte', 'matcha', 'tea'],
  meds: ['adderall', 'vyvanse', 'ritalin', 'concerta', 'focalin'],
  screens: ['phone', 'scrolling', 'tiktok', 'instagram', 'screen', 'netflix', 'youtube'],
  alcohol: ['wine', 'beer', 'drink', 'alcohol', 'drunk'],
  exercise: ['gym', 'run', 'workout', 'exercise', 'lifted'],
};

export const CHRONO_BANDS: Array<{ band: string; max: number }> = [
  { band: 'extreme early', max: 120 },
  { band: 'moderately early', max: 195 },
  { band: 'slightly early', max: 240 },
  { band: 'intermediate', max: 315 },
  { band: 'slightly late', max: 360 },
  { band: 'moderately late', max: 435 },
  { band: 'extreme late', max: 1440 },
];

export const RUMINATIVE_LEXICON: string[] = [
  'kafamda dön', 'kafam doluyor', 'susmuyo', 'döngü', 'takıldım',
  'geçmiyor', 'ne yapsam', 'peki ya', 'ya hep', 'ne olursa',
  'kapanmıyor', 'uyuyamıyorum', 'kafam çalışıyor', 'gözüm açık',
  'spiraling', 'looping', "can't stop thinking", 'cant stop thinking',
  'what if', 'going over', 'replaying', "won't shut off", 'wont shut off',
  'mind racing', "can't sleep", 'cant sleep',
];

export const OVERWHELMED_LEXICON: string[] = [
  'overwhelmed', 'too much', 'cannot cope', "can't cope",
  'kaldıramıyorum', 'çok fazla', 'bunaldım', 'tükendim', 'yıkıldım',
  'çok yorgun', 'bitmek bilmiyor',
];

export const CAFFEINE_RE = /\b(coffee|kahve|espresso|cappuccino|latte|matcha|coke|cola|enerji icec|red\s*bull|monster|tea|çay|black\s*tea|yeşil\s*çay)\b/i;

export const STIMULANT_RE = /\b(vyvanse|adderall|ritalin|methylphenidate|dexedrine|dextroamphetamine|elvanse|concerta|focalin|stratter|atomoxetine|wellbutrin|bupropion|stimulant|stim|adhd\s+med|adhd\s+pill)\b/i;
