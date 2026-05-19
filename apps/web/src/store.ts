/**
 * apps/web · store singleton + bound React hook
 *
 * The @ollie/store package exposes a `createStore(adapter)` factory and a
 * generic React hook that takes a store argument. This file builds the
 * app's single store + cross-tab sync + a project-local hook bound to it.
 *
 * Components import `useStoreSlice` from this file, NOT from @ollie/store
 * directly, so that swapping the underlying store (e.g., for tests or a
 * future remote-sync adapter) is a one-file change.
 *
 * Astrology orchestrator (bottom of file):
 *   - Listens for changes to astrology.birth; recomputes astrology.chart.
 *   - Runs a daily tick to refresh astrology.currentTransits.
 */

import {
  browserAdapter,
  createStore,
  installCrossTabSync,
  runMigrations,
} from '@ollie/store';
import { useStoreSlice as baseUseStoreSlice } from '@ollie/store/react';
// BirthData used in disabled astrology orchestrator block below (ASTROLOGY_ENABLED = false).
import type { BirthData } from '@ollie/logic/astrology';
import { createOrchestrator, initPatternDetectedSubscriber } from '@ollie/orchestrator';
import { scheduleServerJob } from '@ollie/notifications/server-schedule';
import {
  applySuppression,
  type ActiveFocus,
  type SleepSettingsLike,
} from '@ollie/notifications/suppression';
import { getAccount, getAuthJwt, getAuthUserId } from './lib/account-boot';

runMigrations(browserAdapter);

export const store = createStore(browserAdapter);
installCrossTabSync(store, browserAdapter);

export function useStoreSlice<T>(
  mod: string,
  key: string,
  defaultValue: T,
): [T, (value: T) => void] {
  return baseUseStoreSlice<T>(store, mod, key, defaultValue);
}

// ─── Astrology orchestrator (disabled) ───────────────────────────────────────
// Deferred to backlog per audits/DECISIONS_2026-05-14.md Decision 2.
// Set ASTROLOGY_ENABLED = true to reactivate when the module ships.
const ASTROLOGY_ENABLED = false; // deferred to backlog per audits/DECISIONS_2026-05-14.md

if (ASTROLOGY_ENABLED) {
  async function bootAstrology(): Promise<void> {
    const [{ computeNatalChart, currentTransits }, { astronomyAPI }] =
      await Promise.all([
        import('@ollie/logic/astrology'),
        import('./lib/astronomy'),
      ]);

    function recomputeChart(birth: BirthData | null | undefined): void {
      if (!birth?.date) {
        store.set('astrology', 'chart', null);
        return;
      }
      try {
        const chart = computeNatalChart(birth, astronomyAPI);
        store.set('astrology', 'chart', chart);
      } catch (err) {
        console.warn('[astrology orchestrator] computeNatalChart failed:', err);
        store.set('astrology', 'chart', null);
      }
    }

    function recomputeTransits(): void {
      try {
        const snapshot = currentTransits(new Date(), astronomyAPI);
        store.set('astrology', 'currentTransits', snapshot);
      } catch (err) {
        console.warn('[astrology orchestrator] currentTransits failed:', err);
      }
    }

    // Run once for the existing birth data that triggered the boot.
    recomputeChart(store.get<BirthData | null>('astrology', 'birth', null));
    recomputeTransits();

    // Subscribe to future birth changes.
    store.subscribeKey<BirthData | null>('astrology', 'birth', recomputeChart);

    // Daily transit tick (every 24 h).
    const TRANSIT_INTERVAL_MS = 24 * 60 * 60 * 1000;
    setInterval(() => {
      recomputeTransits();
      recomputeChart(store.get<BirthData | null>('astrology', 'birth', null));
    }, TRANSIT_INTERVAL_MS);
  }

  // Boot if birth data already exists on load; otherwise wait for it to appear.
  const hasBirthOnLoad = Boolean(store.get<BirthData | null>('astrology', 'birth', null)?.date);
  if (hasBirthOnLoad) {
    void bootAstrology();
  } else {
    // One-shot subscription: boot as soon as birth data is set, then unsub.
    const unsubBirth = store.subscribeKey<BirthData | null>(
      'astrology',
      'birth',
      (birth) => {
        if (birth?.date) {
          unsubBirth();
          void bootAstrology();
        }
      },
    );
  }
}

// ─── Root orchestrator boot ───────────────────────────────────────────────────
// Starts cycle, pets, body, grocery, sleep, finance, patterns, habits, work,
// goals, admin, dump, burhan, medication. Astrology runs via the inline
// orchestrator above; createOrchestrator does not duplicate it.
//
// scheduleNotification is injected here so APNs server-side jobs fire for all
// notification subscribers — body, finance, habits, and the work/goals cue
// subsystem (scanCues). The wrapper reads getAccount() lazily — deps
// (api, authJwt, userId) are only available after bootAccount() runs, which
// happens in main.tsx just before first render. Calls before auth is ready are
// a no-op because scheduleServerJob short-circuits on missing deps.
function scheduleNotificationWrapper(spec: import('@ollie/notifications').NotificationSpec, fireAt: number): void {
  const account = getAccount();
  if (!account) return;
  // Phase 1 (Clerk migration): server-side APNs jobs need a Supabase-
  // accepted JWT, which we no longer mint. Cues still compute locally;
  // the server push path re-enables in Phase 3.
  const authJwt = getAuthJwt();
  const userId = getAuthUserId();
  if (!authJwt || !userId) return;

  // Notification suppression — quiet hours + focus-session. This wrapper is
  // the single client-side funnel for every orchestrator cue, so both rules
  // are applied here against the live store. Rules only ever DEFER (push the
  // fire time later); they never drop a cue. See @ollie/notifications/suppression.
  const sleepSettings = store.get<SleepSettingsLike | null>('sleep', 'settings', null);
  const activeFocus = store.get<ActiveFocus | null>('work', 'active_focus', null);
  const suppressed = applySuppression({
    fireAt,
    category: spec.category,
    now: Date.now(),
    sleepSettings,
    activeFocus,
  });
  if (suppressed.deferred) {
    console.log(
      '[scheduleNotification] suppression deferred',
      spec.dedupe_key,
      suppressed.reasons.join('+'),
      '→',
      new Date(suppressed.fireAt).toISOString(),
    );
  }

  void scheduleServerJob(
    { api: account.api, authJwt, userId },
    spec,
    suppressed.fireAt,
  );
}

createOrchestrator(store, { scheduleNotification: scheduleNotificationWrapper }).init();
initPatternDetectedSubscriber({ scheduleNotification: scheduleNotificationWrapper });

import { createReminderScheduler, createCrossModuleRouter } from '@ollie/router';
import * as appEvents from '@ollie/events';

// Single canonical reminder scheduler. Audit-fix #3: previously two
// instances existed (one here, one inside useApplyBrainDump). They
// didn't share timers, so cancels from one couldn't see schedules
// from the other. Export this one so any caller imports the same
// scheduler and observe each other's adds/cancels.
export const reminderScheduler = createReminderScheduler(store, appEvents);
reminderScheduler.init();
createCrossModuleRouter(store, appEvents).init();

// Audit-fix #3: bridge `void:reminder:scheduled` events from anywhere
// in the app onto the scheduler. Before this, code that emitted the
// event (e.g. the "remind me to cancel" button in FinanceModule) had
// nothing listening — the reminder vanished. Now it lands as a real
// scheduled reminder with a fire-time + toast on fire.
appEvents.on('void:reminder:scheduled', (payload: unknown) => {
  const p = (payload ?? {}) as { id?: string; fireAt?: number; message?: string; module?: string; source?: string };
  if (!p.id || typeof p.fireAt !== 'number') return;
  reminderScheduler.add({
    id: p.id,
    datetime: p.fireAt,
    body: p.message ?? '',
    module: p.module ?? 'unknown',
    action: p.source ?? 'unknown',
    status: 'scheduled',
  });
});

// ─── Garden resource ledger ───────────────────────────────────────────────────
// The "earn" half of the garden game loop: every burhan life-event credits
// the garden with water + (occasionally) seed. Append-only + idempotent —
// see apps/web/src/lib/garden-ledger.ts. Safe to boot pre-auth: it only
// reads/writes the local store.
import { bootGardenLedger } from './lib/garden-ledger';
bootGardenLedger(store);
