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
import { getString, type Locale } from '../i18n';
import { store as appStore, useStoreSlice } from '../store';
import { chipFly } from '../components/ChipFly';
import { useToast } from '../components/ToastContext';
import { applyRoute } from './applyRoute';

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
  const country = settings?.country ?? 'TR';

  return useCallback(
    async (text: string, fromRect?: DOMRect): Promise<void> => {
      // ── 1. Crisis guard ────────────────────────────────────────────────────
      const { match, line } = detectCrisis(text);
      if (match) {
        emit('void:crisis:detected', { text, matchedLine: line, ts: Date.now() });
        const hotlineKey =
          COUNTRY_TO_HOTLINE_KEY[(country || '').toUpperCase()] ?? 'crisis.hotline_INTL';
        const opener = getString(locale, 'crisis.opener_no_name');
        const hotline = getString(locale, hotlineKey);
        const close = getString(locale, 'crisis.close');
        toast.show(`${opener} ${hotline} ${close}`, { module: 'crisis', ttl: 30000 });
        return;
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
    },
    [toast, locale, country],
  );
}
