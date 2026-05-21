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
import { popUndo } from '../lib/grocery-undo-stack';
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
      // ── 0. Undo short-circuit ──────────────────────────────────────────────
      // Recognised undo triggers bypass AI routing entirely and pop the stack.
      // EN + TR + ES variants all land here. No AI fetch, no store write.
      const trimmed = text.trim().toLowerCase();
      const UNDO_TRIGGERS = [
        'undo',
        'geri al',
        'actually no',
        'wait no',
        'wait, no',
        'oops',
        'nvm',
        'never mind',
        'cancel that',
        'iptal',
        'cancela',
      ] as const;
      if ((UNDO_TRIGGERS as ReadonlyArray<string>).includes(trimmed)) {
        const entry = popUndo();
        if (entry) {
          entry.undo();
          emit('grocery:undone', { description: entry.description, mode: entry.mode, ts: Date.now() });
        } else {
          emit('grocery:undone', { description: '', mode: 'add' as const, ts: Date.now() });
        }
        return;
      }

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

      // Görev 2: applyRoute now delegates to the canonical dispatch core,
      // which emits research:row_written. Pass the active locale so the
      // emitted event carries the right wordlist tag for the scrubber.
      // The app UI ships en + es only (Locale type); tr is not reachable.
      const dispatchLocale: 'en' | 'es' | 'tr' = locale === 'es' ? 'es' : 'en';

      // Grocery routing UX moved to SortedToast (2026-05-21). When a dump
      // routes ONLY to grocery we suppress the generic chipFly + summary
      // toast pair entirely — the popup carries the confirmation. Mixed
      // dumps (e.g. grocery + sleep) still get chips for the non-grocery
      // modules so the user sees the multi-module fan-out.
      const groceryOnly =
        actions.length > 0 && actions.every((r) => r.module === 'grocery');

      // Emit the routing-pending signal as the FIRST act so PendingHair +
      // SortedToast can begin their pending state immediately. The backend
      // T2 producer will emit the matching `grocery:routed` once the AI
      // router (cache hit or Gemini) resolves. We send a synthetic
      // idempotency_key here so the dump-level scope still aligns.
      if (groceryOnly) {
        const idempotency_key =
          'gdump_' + Math.random().toString(36).slice(2);
        emit('grocery:routing:pending', {
          idempotency_key,
          raw: text,
          ts: Date.now(),
        });
      }

      actions.forEach((route, i) => {
        modulesHit.add(route.module);

        // chipFly suppression: skip grocery chips when the dump is grocery-only.
        // For mixed-target dumps the grocery chip still flies (the SortedToast
        // can still surface separately once routed:grocery resolves; the chip
        // here is the "module fan-out" signal, not the "item sorted" signal).
        const suppressChip = groceryOnly && route.module === 'grocery';

        if (fromRect && !suppressChip) {
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

        applyRoute(route, appStore, () => dispatchLocale);
      });

      if (chipPromises.length > 0) {
        await Promise.all(chipPromises);
      }

      // ── 4. Summary toast ──────────────────────────────────────────────────
      // Grocery-only dumps get the SortedToast (driven by the routing
      // events above) instead of the generic "routed → grocery" toast.
      if (!groceryOnly) {
        const moduleList = [...modulesHit].join(', ');
        toast.show(`routed · ${moduleList}`, { module: actions[0].module });
      }

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
