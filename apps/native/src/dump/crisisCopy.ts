/**
 * Crisis banner copy — trilingual (EN/ES/TR), keyed to the user's APP language
 * (not the dump language), matching Ollie's noticing-copy rule. Two tones by
 * severity: `heavy` for tier ≤ 3 (distress / ideation), `urgent` for tier 4
 * (method-seeking). Wording is calm, direct, and safety-oriented — it never
 * diagnoses, it points to help.
 *
 * Pure + standalone (no React) so the selection logic is unit-testable without
 * rendering the whole DumpScreen tree. [NEEDS: native TR/ES safety-copy review.]
 */

import type { AppLang } from '../settings/appLang';
import type { CrisisSignal } from '../router/schema';

interface LangCopy {
  kicker: string;
  heavy: string;
  urgent: string;
  dismiss: string;
}

export const CRISIS_COPY: Record<AppLang, LangCopy> = {
  en: {
    kicker: 'notice',
    heavy:
      "Something in what you wrote sounded heavy. If it's urgent, a crisis line in your country can help right now.",
    urgent:
      "What you wrote sounds serious. If you might act on this, please reach a crisis line right now — you don't have to face it alone.",
    dismiss: 'dismiss',
  },
  es: {
    kicker: 'aviso',
    heavy:
      'Algo de lo que escribiste sonó difícil. Si es urgente, una línea de crisis en tu país puede ayudarte ahora mismo.',
    urgent:
      'Lo que escribiste suena serio. Si podrías actuar sobre esto, por favor contacta una línea de crisis ahora — no tienes que enfrentarlo solo.',
    dismiss: 'cerrar',
  },
  tr: {
    kicker: 'bir not',
    heavy:
      'Yazdıklarında ağır bir şey sezdim. Acilse, ülkendeki bir kriz hattı şu an yardımcı olabilir.',
    urgent:
      'Yazdıkların ciddi görünüyor. Harekete geçmeyi düşünüyorsan, lütfen şimdi bir kriz hattına ulaş — bununla tek başına uğraşmak zorunda değilsin.',
    dismiss: 'kapat',
  },
};

/**
 * Resolve the banner strings for a given app language + crisis tier.
 * Falls back to English for an unknown language, and to the `heavy` tone for
 * any tier below 4 (never silently blank).
 */
export function crisisBannerCopy(
  lang: AppLang,
  tier: CrisisSignal['tier'],
): { kicker: string; body: string; dismiss: string } {
  const c = CRISIS_COPY[lang] ?? CRISIS_COPY.en;
  return { kicker: c.kicker, body: tier >= 4 ? c.urgent : c.heavy, dismiss: c.dismiss };
}
