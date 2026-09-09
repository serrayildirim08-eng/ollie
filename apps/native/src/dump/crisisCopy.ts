/**
 * Crisis banner copy — trilingual (EN/ES/TR), keyed to the user's APP language
 * (not the dump language), matching Ollie's noticing-copy rule.
 *
 * Product decision 2026-06-15: Ollie does NOT route to a crisis line / hotline.
 * It is not a crisis service. When a crisis phrase is detected it shows ONE
 * soft, human message that gently steps back and suggests a trusted person —
 * no severity tiers, no hotline referral. The input is never stored (the worker
 * short-circuits before any persistence; see workers/ai-proxy/src/router/dump.ts).
 *
 * Pure + standalone (no React) so the selection logic is unit-testable without
 * rendering the whole DumpScreen tree.
 */

import type { AppLang } from '../settings/appLang';

interface LangCopy {
  kicker: string;
  body: string;
  dismiss: string;
}

export const CRISIS_COPY: Record<AppLang, LangCopy> = {
  en: {
    kicker: 'a note',
    body: "I'm sorry you're carrying this. I'm not the right kind of help for it — but if there's someone you trust nearby, talking to them might help.",
    dismiss: 'dismiss',
  },
  es: {
    kicker: 'una nota',
    body: 'Siento que estés pasando por esto. No soy la ayuda adecuada para esto, pero si hay alguien de confianza cerca, hablar con esa persona podría ayudar.',
    dismiss: 'cerrar',
  },
  tr: {
    kicker: 'bir not',
    body: 'Bunu okuduğuma üzüldüm. Bu konuda doğru yardımcı ben değilim — ama yanında güvendiğin biri varsa, onunla konuşmak iyi gelebilir.',
    dismiss: 'kapat',
  },
};

/**
 * Resolve the banner strings for a given app language. One soft message
 * regardless of crisis tier. Falls back to English for an unknown language
 * (never silently blank).
 */
export function crisisBannerCopy(
  lang: AppLang,
): { kicker: string; body: string; dismiss: string } {
  const c = CRISIS_COPY[lang] ?? CRISIS_COPY.en;
  return { kicker: c.kicker, body: c.body, dismiss: c.dismiss };
}
