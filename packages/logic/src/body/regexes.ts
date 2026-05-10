/**
 * @ollie/logic · body regexes
 *
 * All symptom/behaviour RegExp patterns used by body detectors.
 * Exported as plain constants — no state, no side effects.
 */

export const HEADACHE_RE = /\b(headache|migraine|head hurts|head is killing|head pounding|head throbbing|migren|baş ağrı|başım ağrı|başım atıyor|dolor de cabeza|me duele la cabeza|migraña|jaqueca)\b/i;

export const TUKEN_RE = /\b(yorgun|bitkin|tükendim|enerjim\s+yok|exhausted|drained|crash|crashing|wired|foggy|dağıldım|battı(?:m)?|patladım)\b/i;

export const BACK_RE = /\b(back\s+pain|backache|sırt\s+ağrı|bel\s+ağrı|lumbago|dolor\s+de\s+espalda|me\s+duele\s+la\s+espalda|lumbalgia)\b/i;

export const STOMACH_RE = /\b(stomach\s+ache|stomachache|tummy|midem|mide\s+ağrı|karnım\s+ağrı|nausea\s+stomach|gastric|dolor\s+de\s+estómago|me\s+duele\s+el\s+estómago|dolor\s+de\s+barriga)\b/i;

export const JAW_RE = /\b(jaw\s+pain|jaw\s+clench|tmj|grind(?:ing)?\s+teeth|çene\s+ağrı|çene\s+sıkma|diş\s+gıcırd|dolor\s+de\s+mandíbula|aprieto\s+la\s+mandíbula|rechino\s+los\s+dientes|bruxismo)\b/i;

export const NECK_RE = /\b(neck\s+pain|stiff\s+neck|neck\s+tension|boyun\s+ağrı|enseden|tutulma|dolor\s+de\s+cuello|cuello\s+tens[oa]|cervicalgia)\b/i;

export const NAUSEA_RE = /\b(nausea|nauseous|queasy|wanna\s+throw\s+up|midem\s+bulan|mide\s+bulantı|kustum|náusea|tengo\s+ganas\s+de\s+vomitar|me\s+da\s+arcadas)\b/i;

export const VASOMOTOR_RE = /(hot\s+flash(?:es)?|night\s+sweat(?:s)?|sıcak\s+basma(?:sı)?|gece\s+terlemes(?:i|in)|terleme\s+kriz|ateş\s+bas(?:tı|ıyor)|vasomotor)/i;

export const FOOD_RE = /\b(snack|food|hungry|açım|açlık|yedim|atıştır|cookie|chips|chocolate|cracker|sandwich|kek|kurabiye|biskuvi|bisküvi|tatlı|nibble|breakfast|lunch|dinner|kahvaltı|öğle|akşam yemeği|brunch|meal)\b/i;

export const CAFFEINE_RE = /\b(coffee|kahve|espresso|cappuccino|latte|matcha|coke|cola|red\s*bull|monster|enerji\s+iceceg|tea\s+(?:black|green)|black\s+tea|yeşil\s+çay)\b/i;

export const MOVEMENT_RE = /\b(walk(?:ed|ing)?|yürüdüm|yürüyüş|gym|spor|workout|antren|exercise|egzersiz|yoga|pilates|stretch|esne|run(?:ning)?|koştum|koşu|swim|yüzme|bike|bisiklet|cardio|kardio|hike|tırman|dance|dans)\b/i;

export const STRESS_RE = /\b(stres|stress|anxious|kaygı|kaygılı|overwhelm(?:ed)?|panic|panik|crash(?:ing)?|wired)\b/i;

export const SIDE_EFFECT_RE = /\b(yorgun|bitkin|tükendim|exhausted|drained|nausea|nauseous|midem\s+bulan|mide\s+bulantı|kustum|baş\s+ağrı|headache|migraine|migren|dizz|ateş|fever|stomach|midem|mide\s+ağrı|karnım\s+ağrı)\b/i;

/** All body symptom regexes in one array (used for cross-module coupling). */
export const SYMPTOM_REGEXES: RegExp[] = [
  HEADACHE_RE,
  STOMACH_RE,
  NAUSEA_RE,
  JAW_RE,
  NECK_RE,
  BACK_RE,
];
