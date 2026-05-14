/**
 * useApplyBrainDump
 *
 * Wraps the full brain-dump pipeline:
 *   1. Crisis guard (emits event + crisis toast, returns early).
 *   2. dissection.extract() keyword router → Array<Action>.
 *   3. chipFly() for each routed module (70 ms stagger).
 *   4. applyRoute() writes each action to the right store key.
 *   5. Summary toast: "routed → grocery, sleep".
 */

import { useCallback } from 'react';
import { detectCrisis } from '@ollie/logic/crisis';
import { extract } from '@ollie/logic/dissection';
import { emit } from '@ollie/events';
import * as appEvents from '@ollie/events';
import { getString, type Locale } from '../i18n';
import { store as appStore, useStoreSlice } from '../store';
import { chipFly } from '../components/ChipFly';
import { useToast } from '../components/ToastContext';
import { applyRoute } from './applyRoute';
import { parseReminder } from '@ollie/router';
// Audit-fix #3: import the shared scheduler instance from store.ts
// instead of creating a second instance. Two schedulers with their
// own timer maps couldn't cancel each other's schedules (audit H4).
import { reminderScheduler } from '../store';
import { postEnrichDump } from '../lib/enrich-bridge';
import { readUserHash } from '../lib/user-hash';
import { getAccount } from '../lib/account-boot';
import { getDeviceId, getAppVersion } from '../lib/device';

// Re-export so callers only need one import.
export { applyRoute } from './applyRoute';

// ─── Country → crisis hotline key ─────────────────────────────────────────────

const COUNTRY_TO_HOTLINE_KEY: Record<string, string> = {
  TR: 'crisis.hotline_TR',
  US: 'crisis.hotline_US',
  GB: 'crisis.hotline_GB',
  CA: 'crisis.hotline_CA',
  AU: 'crisis.hotline_AU',
  DE: 'crisis.hotline_DE',
  FR: 'crisis.hotline_FR',
  NL: 'crisis.hotline_NL',
  IT: 'crisis.hotline_IT',
  ES: 'crisis.hotline_ES',
  SE: 'crisis.hotline_SE',
};

// ─── hook ─────────────────────────────────────────────────────────────────────

export function useApplyBrainDump(): (text: string, fromRect?: DOMRect) => Promise<void> {
  const toast = useToast();
  const [settings] = useStoreSlice<{ locale?: string; country?: string }>('shared', 'settings', {});
  const locale = (settings?.locale ?? 'en') as Locale;
  // F3 (Sprint 5): no hardcoded TR fallback. If country is null/unset
  // we fall through to crisis.hotline_INTL below (global directory).
  // Onboarding now sets this via browser-locale detection + manual picker.
  const country = settings?.country ?? null;

  return useCallback(
    async (text: string, fromRect?: DOMRect): Promise<void> => {
      // ── 1. Crisis guard ────────────────────────────────────────────────────
      const { match, line } = detectCrisis(text);
      if (match) {
        emit('void:crisis:detected', { text, matchedLine: line, ts: Date.now() });
        const upper = (country || '').toUpperCase();
        const hotlineKey = upper && COUNTRY_TO_HOTLINE_KEY[upper]
          ? COUNTRY_TO_HOTLINE_KEY[upper]
          : 'crisis.hotline_INTL';
        const opener = getString(locale, 'crisis.opener_no_name');
        const hotline = getString(locale, hotlineKey);
        const close = getString(locale, 'crisis.close');
        toast.show(`${opener} ${hotline} ${close}`, { module: 'crisis', ttl: 30000 });
        return;
      }

      // ── 1b. Reminder intercept ────────────────────────────────────────────
      // If the text contains a time phrase, create a reminder. Both paths can
      // coexist: a reminder is added AND normal routing continues below.
      const reminderLocale = (settings?.locale ?? 'en') === 'tr' ? 'tr' : 'en';
      const parsed = parseReminder(text, Date.now(), reminderLocale);
      if (parsed) {
        reminderScheduler.add(parsed);
        toast.show(`reminder set · ${parsed.body}`, { module: parsed.module });
      }

      // ── 2. Route ───────────────────────────────────────────────────────────
      const result = extract(text);

      // AnswerRoute — not a list of actions, nothing to write.
      if (!Array.isArray(result)) return;

      const actions = result;
      if (actions.length === 0) return;

      // ── 3. Chips + store writes ────────────────────────────────────────────
      const modulesHit = new Set<string>();
      const chipPromises: Promise<void>[] = [];

      actions.forEach((route, i) => {
        modulesHit.add(route.module);

        if (fromRect) {
          // Stagger chips by 70 ms per route.
          chipPromises.push(
            new Promise<void>((resolve) => {
              setTimeout(() => {
                chipFly(route.module, fromRect, i);
                resolve();
              }, i * 70);
            }),
          );
        }

        applyRoute(route, appStore);
      });

      if (chipPromises.length > 0) {
        await Promise.all(chipPromises);
      }

      // ── 4. Summary toast ──────────────────────────────────────────────────
      const moduleList = [...modulesHit].join(', ');
      toast.show(`routed → ${moduleList}`, { module: actions[0].module });

      // ── 5. Server enrichment (fire-and-forget) ────────────────────────────
      // Gated by consent inside the research client; if consent is off this
      // is a no-op. user_hash is null until sign-in finishes; pre-sign-in
      // dumps stay local.
      const account = getAccount();
      const userHash = readUserHash();
      if (account?.research.hasConsent() && userHash) {
        const primaryModule = actions[0]?.module ?? null;
        postEnrichDump({
          user_hash: userHash,
          device_id: getDeviceId(),
          app_version: getAppVersion(),
          raw_text: text,
          modality: 'text',
          routing_module: primaryModule,
          country: country ?? 'INTL',
          locale,
        });
      }
    },
    [toast, locale, country],
  );
}
