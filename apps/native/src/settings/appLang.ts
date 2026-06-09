/**
 * apps/native · settings/appLang.ts  —  the app-language setting
 *
 * Sprint 3 · DECISION 3 — noticing copy ships trilingual (EN + ES + TR) and is
 * produced in the user's CHOSEN APP language, NOT the dump language. There was
 * no app-language setting yet, so this adds a minimal one: a single stored
 * locale under `settings.appLang`, default 'en', selectable 'en' | 'es' | 'tr'.
 *
 * Stored in the @ollie/store (persists + reactive) so the brain copy layer and
 * any future localised surface read one source of truth. The actual resolution
 * + validation lives in the pure @ollie/logic/brain (`resolveLang`) so a junk
 * stored value can never break a read.
 */

import { useEffect, useState } from 'react';
import { resolveLang, type AppLang } from '@ollie/logic/brain';
import { store } from '../store';

export type { AppLang };

const NS = 'settings';
const KEY = 'appLang';

/** Read the current app language (validated, defaults to 'en'). Non-reactive. */
export function getAppLang(): AppLang {
  try {
    return resolveLang(store.get(NS, KEY, 'en'));
  } catch {
    return 'en';
  }
}

/** Set the app language. Validated before write so only en/es/tr land. */
export function setAppLang(lang: AppLang): void {
  store.set(NS, KEY, resolveLang(lang));
}

/**
 * Reactive app-language hook. Re-renders when the stored setting changes.
 * Mirrors usePatterns' subscribeKey pattern.
 */
export function useAppLang(): AppLang {
  const [lang, setLang] = useState<AppLang>(() => getAppLang());
  useEffect(() => {
    const refresh = (): void => setLang(getAppLang());
    const unsub = store.subscribeKey(NS, KEY, refresh);
    refresh();
    return unsub;
  }, []);
  return lang;
}
