/**
 * apps/web · shared app services + gates context
 *
 * Created during the react-router migration (2026-05-18). The old
 * `AppInner` held the account handles, the brain-dump pipeline, the four
 * app gates and a set of cross-cutting effects as component state, and
 * threaded callbacks down through page props. Routes are mounted by the
 * router, not hand-rendered, so all of that now travels through React
 * context instead.
 *
 * Nothing here changed behavior — the effects (toast bridge, retention,
 * reduce-motion, session telemetry), the gates and the brain-dump
 * dispatch are the same code that ran in `AppInner`, relocated so every
 * route element can reach them.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type { AuthClient } from '@ollie/auth';
import * as appEvents from '@ollie/events';
import { emit as emitEvent } from '@ollie/events';
import { useApplyBrainDump } from './hooks/useApplyBrainDump';
import { sessionTracker } from './lib/session-tracker';
import { bootAccount } from './lib/account-boot';
import { trackSession, makeRetentionBridge } from './lib/retention';
import { readUserHash } from './lib/user-hash';
import { getDeviceId, getAppVersion } from './lib/device';
import { store } from './store';
import { useToast } from './components/ToastContext';
import { useAppGates, type AppGates } from './app-gates';

type AccountHandles = ReturnType<typeof bootAccount>;

/** Brain-dump input modality, used for session-tracker accounting. */
export type DumpModality = 'text' | 'voice';

export interface AppServices {
  /** The account boot handles (auth / research / sync). */
  accountRef: React.MutableRefObject<AccountHandles>;
  /** Convenience alias — the auth client (always non-null post-boot). */
  auth: AuthClient;
  /** The four app gates (auth / consent / research / onboarding). */
  gates: AppGates;
  /**
   * Run the brain-dump pipeline on `text`. Records the modality in the
   * session tracker (text vs. voice) exactly as the old per-screen
   * `homeDump` / `dashDump` / voice handlers did.
   */
  applyDump: (text: string, modality: DumpModality) => void;
}

const Ctx = createContext<AppServices | null>(null);

export function AppServicesProvider({ children }: { children: React.ReactNode }) {
  // bootAccount is idempotent — main.tsx also calls it.
  const accountRef = useRef<AccountHandles>(bootAccount());
  const apply = useApplyBrainDump();
  const toast = useToast();
  const gates = useAppGates(accountRef.current.auth);
  const { authed, consentGiven } = gates;

  // ── Effect 1 · void:toast bridge ──────────────────────────────────────────
  // Surface `void:toast` events through ToastHost. The reminder scheduler
  // emits void:toast on every fire; without this listener the user sees
  // nothing. (Audit-fix #3, relocated verbatim from AppInner.)
  useEffect(() => {
    const off = appEvents.on('void:toast', (payload: unknown) => {
      const p = (payload ?? {}) as { message?: string; module?: string };
      if (p.message) toast.show(p.message, { module: p.module ?? 'reminder' });
    });
    return () => off();
  }, [toast]);

  // ── Effect 2 · session telemetry + retention ──────────────────────────────
  // Emits a session start row once auth + consent are confirmed, and an
  // end row on tab close / background. Retention markers fan
  // void:retention:* to retention_events via the bridge. Both gated on
  // consent.necessary; user_hash is null until sign-in. Relocated
  // verbatim from AppInner (same deps, same once-per-mount guard).
  const retentionRanRef = useRef(false);
  useEffect(() => {
    if (!authed || !consentGiven) return;
    const research = accountRef.current.research;
    const userHash = readUserHash() ?? '';
    const country = store.get<string>('shared', 'settings.country', 'INTL') ?? 'INTL';

    if (!retentionRanRef.current) {
      retentionRanRef.current = true;
      trackSession(
        store,
        makeRetentionBridge(emitEvent, research, () => ({
          user_hash: readUserHash() ?? '',
          device_id: getDeviceId(),
          country,
          locale: typeof navigator !== 'undefined' ? navigator.language : 'en',
          app_version: getAppVersion(),
        })),
      );
    }

    sessionTracker.start(research, {
      user_hash: userHash,
      country,
      device_id: getDeviceId(),
      app_version: getAppVersion(),
    });

    function handleEnd() {
      sessionTracker.end(research);
    }

    // Audit-fix #10: `visibilitychange` was previously registered with an
    // inline anonymous function and never removed, leaking a listener on
    // every effect re-run / StrictMode double-invoke. Use a named handler
    // and remove it (and `beforeunload`) in cleanup.
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') handleEnd();
    }

    window.addEventListener('beforeunload', handleEnd);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleEnd);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      handleEnd();
    };
  }, [authed, consentGiven]);

  // ── Effect 3 · global reduce-motion-today ─────────────────────────────────
  // Cross-module router writes shared.reduce_motion_today on a pacing
  // breach. Apply globally as a CSS var + data attr so duration-tagged
  // transitions short-circuit to 0ms for the day. Relocated verbatim.
  useEffect(() => {
    function applyReduceMotion(): void {
      if (typeof document === 'undefined') return;
      const value = store.get<unknown[]>('shared', 'reduce_motion_today', []) ?? [];
      const active = Array.isArray(value) ? value.length > 0 : !!value;
      const root = document.documentElement;
      if (active) {
        root.dataset.reduceMotion = 'today';
        root.style.setProperty('--reduce-motion-active', '1');
        root.style.setProperty('--d-flight', '0ms');
        root.style.setProperty('--d-slide', '0ms');
        root.style.setProperty('--d-flick', '0ms');
        root.style.setProperty('--d-settle', '0ms');
      } else {
        delete root.dataset.reduceMotion;
        root.style.removeProperty('--reduce-motion-active');
        root.style.removeProperty('--d-flight');
        root.style.removeProperty('--d-slide');
        root.style.removeProperty('--d-flick');
        root.style.removeProperty('--d-settle');
      }
    }
    applyReduceMotion();
    const unsub = store.subscribeKey('shared', 'reduce_motion_today', applyReduceMotion);
    return () => { try { unsub(); } catch { /* noop */ } };
  }, []);

  const value = useMemo<AppServices>(
    () => ({
      accountRef,
      auth: accountRef.current.auth,
      gates,
      applyDump: (text: string, modality: DumpModality) => {
        sessionTracker.onBrainDump(modality);
        void apply(text);
      },
    }),
    [apply, gates],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppServices(): AppServices {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useAppServices must be used within <AppServicesProvider>');
  }
  return ctx;
}
