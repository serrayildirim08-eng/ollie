/**
 * apps/web · application router
 *
 * Migrated 2026-05-18 from a hand-rolled `useState<Screen>` machine in
 * App.tsx to react-router. This fixes three real bugs the state machine
 * shipped:
 *
 *   1. The browser / Android hardware back button did nothing — there was
 *      no history entry per screen. Every screen change is now a real
 *      history push, so Back works, and `@capacitor/app`'s `backButton`
 *      event is wired to `history.back()` (see `BackButtonBridge`).
 *   2. Deep links could not open a specific screen — the app always
 *      mounted at `home`. Each screen now has a stable URL.
 *   3. A page refresh always landed on `home`. The URL is the source of
 *      truth, so refresh restores the current screen.
 *
 * HASH routing (`createHashRouter`) is used deliberately: it works
 * identically under Electron's `file://` origin and on the web with no
 * server rewrite rules. Routes live after the `#`, e.g.
 * `index.html#/garden`, `index.html#/module/finance`.
 *
 * The auth / consent / research-opt-in / onboarding gates that used to
 * wrap the whole app are re-expressed here as a route GUARD layout
 * (`GatedLayout`) — same logic, same order, same one-way semantics —
 * without behavior change. The gate state lives in `AppServicesProvider`
 * so a sign-out from SettingsScreen flips the gate the layout reads.
 */

import React, { lazy, Suspense, useEffect, useState } from 'react';
import {
  createHashRouter,
  RouterProvider,
  Outlet,
  Navigate,
  useNavigate,
} from 'react-router-dom';

import { ToastHost } from './components/ToastHost';
import { ChipFlyHost } from './components/ChipFly';
import { Day30Prompt } from './components/Day30Prompt';
import {
  NotificationPrimer,
  hasSeenNotificationPrimer,
} from './components/NotificationPrimer';
import { AppLockGate } from './components/AppLockGate';
import {
  APP_LOCK_SLICE,
  APP_LOCK_LOCKED_KEY,
  isAppLockEnabled,
  unlockApp,
  markBackgrounded,
  relockIfIdle,
  seedColdBootLock,
} from './lib/app-lock';
import { store } from './store';
import { useAuth } from '@clerk/react';
import { AuthFlow } from './components/AuthFlow';
import { ConsentScreen } from './components/ConsentScreen';
import { ConsentStep } from './screens/onboarding/ConsentStep';
import { OnboardingScreen } from './pages/OnboardingScreen';
import { DevModeBanner } from './components/DevModeBanner';
import { AppServicesProvider, useAppServices } from './app-services';
import { CLERK_CONFIGURED } from './app-gates';

// ─── lazy page imports ────────────────────────────────────────────────────────

const SettingsScreen  = lazy(() => import('./pages/SettingsScreen').then(m => ({ default: m.SettingsScreen })));
const CrisisScreen    = lazy(() => import('./pages/CrisisScreen').then(m => ({ default: m.CrisisScreen })));

// The clean-slate v2 app — the assembled `v2-shell`. As of the 2026-05-19
// migration this IS the app: `GatedLayout` renders it once the four gates
// (auth · consent · research · onboarding) pass. It composes all 12
// `*-v2` modules behind one navigation host (capture deck · module rooms
// · Find · Safe). The old hand-built screens are no longer routed.
const ShellApp        = lazy(() => import('./modules/v2-shell').then(m => ({ default: m.ShellApp })));

// Dev-only preview of the clean-slate v2 money rebuild. Lazy + isolated:
// the chunk is only fetched when `/preview/money` is opened, and the route
// is mounted OUTSIDE GatedLayout so it never affects the main app flow.
const MoneyV2PreviewScreen = lazy(() =>
  import('./pages/MoneyV2PreviewScreen').then(m => ({ default: m.MoneyV2PreviewScreen })),
);

// Dev-only preview of the clean-slate v2 cycle rebuild. Lazy + isolated:
// the chunk is only fetched when `/preview/cycle` is opened, and the route
// is mounted OUTSIDE GatedLayout so it never affects the main app flow.
const CycleV2PreviewScreen = lazy(() =>
  import('./pages/CycleV2PreviewScreen').then(m => ({ default: m.CycleV2PreviewScreen })),
);

// Dev-only preview of the clean-slate v2 sleep rebuild. Lazy + isolated:
// the chunk is only fetched when `/preview/sleep` is opened, and the route
// is mounted OUTSIDE GatedLayout so it never affects the main app flow.
const SleepV2PreviewScreen = lazy(() =>
  import('./pages/SleepV2PreviewScreen').then(m => ({ default: m.SleepV2PreviewScreen })),
);

// Dev-only preview of the clean-slate v2 body rebuild. Lazy + isolated:
// the chunk is only fetched when `/preview/body` is opened, and the route
// is mounted OUTSIDE GatedLayout so it never affects the main app flow.
const BodyV2PreviewScreen = lazy(() =>
  import('./pages/BodyV2PreviewScreen').then(m => ({ default: m.BodyV2PreviewScreen })),
);

// Dev-only preview of the clean-slate v2 medication rebuild. Lazy +
// isolated: the chunk is only fetched when `/preview/medication` is opened,
// and the route is mounted OUTSIDE GatedLayout so it never affects the
// main app flow.
const MedicationV2PreviewScreen = lazy(() =>
  import('./pages/MedicationV2PreviewScreen').then(m => ({ default: m.MedicationV2PreviewScreen })),
);

// Dev-only preview of the clean-slate v2 habits rebuild. Lazy + isolated:
// the chunk is only fetched when `/preview/habits` is opened, and the route
// is mounted OUTSIDE GatedLayout so it never affects the main app flow.
const HabitsV2PreviewScreen = lazy(() =>
  import('./pages/HabitsV2PreviewScreen').then(m => ({ default: m.HabitsV2PreviewScreen })),
);

// Dev-only preview of the clean-slate v2 partner feature. Lazy + isolated:
// the chunk is only fetched when `/preview/partner` is opened, and the route
// is mounted OUTSIDE GatedLayout so it never affects the main app flow.
// partner-v2 is a NEW feature with no backend — it runs over an in-module
// local stub (see modules/partner-v2/selectors.ts for the honest-stub note).
const PartnerV2PreviewScreen = lazy(() =>
  import('./pages/PartnerV2PreviewScreen').then(m => ({ default: m.PartnerV2PreviewScreen })),
);

// Dev-only preview of the clean-slate v2 admin rebuild. Lazy + isolated:
// the chunk is only fetched when `/preview/admin` is opened, and the route
// is mounted OUTSIDE GatedLayout so it never affects the main app flow.
const AdminV2PreviewScreen = lazy(() =>
  import('./pages/AdminV2PreviewScreen').then(m => ({ default: m.AdminV2PreviewScreen })),
);

// Dev-only preview of the clean-slate v2 pets rebuild. Lazy + isolated:
// the chunk is only fetched when `/preview/pets` is opened, and the route
// is mounted OUTSIDE GatedLayout so it never affects the main app flow.
const PetsV2PreviewScreen = lazy(() =>
  import('./pages/PetsV2PreviewScreen').then(m => ({ default: m.PetsV2PreviewScreen })),
);

// Dev-only preview of the clean-slate v2 grocery rebuild. Lazy + isolated:
// the chunk is only fetched when `/preview/grocery` is opened, and the route
// is mounted OUTSIDE GatedLayout so it never affects the main app flow.
const GroceryV2PreviewScreen = lazy(() =>
  import('./pages/GroceryV2PreviewScreen').then(m => ({ default: m.GroceryV2PreviewScreen })),
);

// Dev-only preview of the clean-slate v2 work rebuild — the "matters"
// concept. Lazy + isolated: the chunk is only fetched when `/preview/work`
// is opened, and the route is mounted OUTSIDE GatedLayout so it never
// affects the main app flow. work-v2 reads the REAL matter backend — the
// matter container + dump→matter routing committed as 9ed51e5, via the live
// `work` store namespace (see modules/work-v2/useWorkStore.ts).
const WorkV2PreviewScreen = lazy(() =>
  import('./pages/WorkV2PreviewScreen').then(m => ({ default: m.WorkV2PreviewScreen })),
);

// Dev-only preview of the clean-slate v2 goals rebuild. Lazy + isolated:
// the chunk is only fetched when `/preview/goals` is opened, and the route
// is mounted OUTSIDE GatedLayout so it never affects the main app flow.
// goals-v2 reads + writes the SAME `goals.*` store the live module uses.
const GoalsV2PreviewScreen = lazy(() =>
  import('./pages/GoalsV2PreviewScreen').then(m => ({ default: m.GoalsV2PreviewScreen })),
);

// The ASSEMBLED clean-slate v2 app — the `v2-shell` navigation host that
// ties all 12 `*-v2` modules into ONE navigable app: the capture deck
// (Throw · Caught · Noticed), the 4-modules view, the module homepages,
// and the always-on Find / Safe. Lazy + isolated: the chunk is only
// fetched when `/preview/v2` is opened, and the route is mounted OUTSIDE
// GatedLayout so it never affects the main app flow. The shell composes
// the existing module apps — it rebuilds none of them — and the 12
// individual `/preview/{module}` routes keep working unchanged.
const V2ShellPreviewScreen = lazy(() =>
  import('./pages/V2ShellPreviewScreen').then(m => ({ default: m.V2ShellPreviewScreen })),
);

// The preview HUB — a tappable index of every `/preview/*` surface. This
// is the entry point that makes the v2 redesign reachable in the native
// iOS app, where there is no URL bar to type a hash route. Lazy +
// isolated: the chunk is only fetched when `/preview` is opened, and the
// route is mounted OUTSIDE GatedLayout so it never affects the main app
// flow. Serra reaches it from Settings → "preview the new design".
const PreviewHubScreen = lazy(() =>
  import('./pages/PreviewHubScreen').then(m => ({ default: m.PreviewHubScreen })),
);

function PageLoading() {
  return <div style={{ minHeight: '100dvh', background: 'var(--bone)' }} aria-busy="true" />;
}

// ─── Capacitor hardware back button ────────────────────────────────────────────

/**
 * Wires `@capacitor/app`'s `backButton` event to `history.back()`.
 *
 * On Android the hardware Back button used to do nothing — the old
 * `useState<Screen>` machine kept no history. With hash routing each
 * screen IS a history entry, so `window.history.back()` walks the user
 * back through screens; at the first entry Capacitor's default (exit
 * app) is left to fire by NOT calling `canGoBack ? back : exit` — we
 * simply step back, and Capacitor exits when there is nowhere to go.
 *
 * Web / desktop: `@capacitor/app` resolves but never emits `backButton`,
 * so this is a no-op there. The dynamic import keeps Capacitor optional.
 */
function BackButtonBridge() {
  useEffect(() => {
    let remove: (() => void) | undefined;
    let cancelled = false;
     
    const dynImport = new Function('s', 'return import(s)') as (
      s: string,
    ) => Promise<{ App?: unknown }>;
    dynImport('@capacitor/app')
      .then((mod) => {
        const App = mod?.App as
          | {
              addListener: (
                e: string,
                cb: (d: { canGoBack: boolean }) => void,
              ) => Promise<{ remove: () => void }>;
            }
          | undefined;
        if (!App?.addListener || cancelled) return;
        App.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack) {
            window.history.back();
          } else {
            // Nowhere to go inside the app — let Capacitor exit.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyApp = App as any;
            if (typeof anyApp.exitApp === 'function') anyApp.exitApp();
          }
        }).then((handle) => {
          if (cancelled) handle.remove();
          else remove = handle.remove;
        });
      })
      .catch(() => {
        /* Capacitor not present — web/desktop, no-op. */
      });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);
  return null;
}

// ─── gate layout ──────────────────────────────────────────────────────────────

/**
 * The gated app shell. Re-expresses, IN ORDER, the four gates that used
 * to wrap `AppInner`: auth → consent.necessary → research opt-in →
 * onboarding. Each failing gate renders its blocking screen instead of
 * `<Outlet/>`, exactly as the old early-`return`s did. The crisis route
 * is mounted OUTSIDE this layout so it stays reachable in any app state.
 */
function GatedLayout() {
  const { vault, gates } = useAppServices();
  const { userId } = useAuth();

  // Gate 1 — Clerk sign-in + passphrase-vault unlock. AuthFlow owns both
  // and calls markAuthed() once they have both passed.
  if (!gates.authed) {
    return (
      <>
        <AuthFlow vault={vault} onAuthenticated={gates.markAuthed} />
        <ToastHost />
        <ChipFlyHost />
        {!CLERK_CONFIGURED && <DevModeBanner />}
      </>
    );
  }

  // Gate 2 — consent.necessary (the master app-boot gate, one-way).
  if (!gates.consentGiven) {
    return (
      <>
        <ConsentScreen onContinue={gates.markConsentGiven} />
        <ToastHost />
        <ChipFlyHost />
        {!CLERK_CONFIGURED && <DevModeBanner />}
      </>
    );
  }

  // Gate 3 — research opt-in. `null` means never prompted.
  if (gates.researchOptin === null) {
    return (
      <>
        <ConsentStep
          userId={userId ?? 'local-dev'}
          source={gates.researchSource}
          initial={{ marketing: gates.marketing, research_optin: false }}
          onContinue={gates.markResearchDecided}
        />
        <ToastHost />
        <ChipFlyHost />
        {!CLERK_CONFIGURED && <DevModeBanner />}
      </>
    );
  }

  // Gate 4 — onboarding (first launch only).
  if (!gates.onboarded) {
    return (
      <>
        <OnboardingScreen onComplete={gates.markOnboarded} />
        <ToastHost />
        <ChipFlyHost />
        {!CLERK_CONFIGURED && <DevModeBanner />}
      </>
    );
  }

  // All gates passed — render the v2-shell (via the routed Outlet) plus
  // the always-on overlays. The shell owns its own capture surface (the
  // Throw deck), so there is no global mic button.
  return (
    <>
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
      <ToastHost />
      <ChipFlyHost />
      <Day30Prompt />
      <NotificationPrimerGate />
      <AppLockController />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </>
  );
}

/**
 * App-lock gate.
 *
 * The optional "soft lock" that covers the whole app UI with a biometric
 * (Face ID / fingerprint) re-entry screen. OFF by default — the user
 * opts in from Settings → security. See lib/app-lock.ts for the honest
 * framing: the user is already signed in, this is a privacy curtain, not
 * auth, and disabling it loses nothing.
 *
 * Mounted only inside the all-gates-passed branch of `GatedLayout`, so it
 * never fights the auth / consent / onboarding screens — those come first.
 *
 * WHEN IT LOCKS
 *   - cold boot: `seedColdBootLock()` on mount draws the curtain if the
 *     feature is enabled. `app_lock.locked` is persisted, so a tab killed
 *     while locked also boots locked.
 *   - resume after idle: when the page goes to the background (web
 *     `visibilitychange` → hidden, or Capacitor `App` appStateChange →
 *     inactive) the moment is timestamped; on the next foreground a gap
 *     past RELOCK_AFTER_MS re-locks via `relockIfIdle()`.
 *
 * The `locked` flag is the single source of truth; this component
 * subscribes to it so a lock from a background event re-renders the gate.
 */
function AppLockController() {
  const { vault } = useAppServices();

  // Seed cold-boot lock state ONCE, synchronously, before first paint —
  // so an enabled lock comes up covering the UI, not flashing it first.
  const [locked, setLocked] = useState<boolean>(() => seedColdBootLock());

  // Mirror the store flag: background events (below) flip `app_lock.locked`
  // directly, so subscribe and re-render when it changes from anywhere.
  useEffect(() => {
    const unsub = store.subscribeKey<boolean>(
      APP_LOCK_SLICE,
      APP_LOCK_LOCKED_KEY,
      (next) => setLocked(Boolean(next)),
    );
    return () => { try { unsub(); } catch { /* noop */ } };
  }, []);

  // Background / resume wiring. Web uses `visibilitychange`; Capacitor
  // emits `appStateChange` (isActive false/true). Both funnel to the same
  // two actions: timestamp on leave, `relockIfIdle` on return.
  useEffect(() => {
    if (typeof document === 'undefined') return;

    function onLeave() { markBackgrounded(); }
    function onReturn() { relockIfIdle(); }

    function onVisibility() {
      if (document.visibilityState === 'hidden') onLeave();
      else onReturn();
    }
    document.addEventListener('visibilitychange', onVisibility);

    // Capacitor native resume — dynamic import keeps Capacitor optional
    // (mirrors BackButtonBridge). No-op on web/desktop.
    let removeNative: (() => void) | undefined;
    let cancelled = false;
    const dynImport = new Function('s', 'return import(s)') as (
      s: string,
    ) => Promise<{ App?: unknown }>;
    dynImport('@capacitor/app')
      .then((mod) => {
        const App = mod?.App as
          | {
              addListener: (
                e: string,
                cb: (d: { isActive: boolean }) => void,
              ) => Promise<{ remove: () => void }>;
            }
          | undefined;
        if (!App?.addListener || cancelled) return;
        App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) onReturn();
          else onLeave();
        }).then((handle) => {
          if (cancelled) handle.remove();
          else removeNative = handle.remove;
        });
      })
      .catch(() => { /* Capacitor absent — web/desktop, no-op */ });

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      removeNative?.();
    };
  }, []);

  // The feature can be flipped off from Settings while the curtain is up;
  // honour that here so a just-disabled lock doesn't trap the user.
  if (!isAppLockEnabled()) return null;
  if (!locked) return null;

  return (
    <AppLockGate
      vault={vault}
      onUnlocked={() => {
        unlockApp();
        setLocked(false);
      }}
    />
  );
}

/**
 * Notification-permission priming gate.
 *
 * Renders the `NotificationPrimer` exactly ONCE — the first time the user
 * reaches the app proper, i.e. after all four gates (auth → consent →
 * research → onboarding) have passed. This is the deliberate moment to
 * ask: not at cold boot, not mid-onboarding.
 *
 * Mounting only inside the all-gates-passed branch of `GatedLayout`
 * already guarantees the "after onboarding" timing. The `shared.
 * notif_primer_seen` flag (written by NotificationPrimer on either
 * action) guarantees it never shows twice — across reloads, across the
 * onboarding-replay path, everything.
 *
 * `useState` initializer reads the flag once on mount so a later write
 * doesn't re-trigger the primer; `onDone` flips local state to unmount
 * the overlay.
 */
function NotificationPrimerGate() {
  const [show, setShow] = useState<boolean>(() => !hasSeenNotificationPrimer());
  if (!show) return null;
  return <NotificationPrimer onDone={() => setShow(false)} />;
}

// ─── route elements ───────────────────────────────────────────────────────────

/**
 * The app host — the clean-slate v2 shell. Once `GatedLayout`'s four gates
 * pass, this is the app: the assembled `v2-shell` that ties all 12 `*-v2`
 * modules into one navigable app. `onThrow` is wired to the real brain-dump
 * pipeline; `onSafe` opens the crisis surface; `onSettings` opens the
 * (still hand-built) settings screen, reached from the shell's modules
 * panel. The shell owns all in-app navigation internally.
 */
function ShellHostRoute() {
  const navigate = useNavigate();
  const { applyDump } = useAppServices();
  return (
    <ShellApp
      onThrow={(text) => applyDump(text, 'text')}
      onSafe={() => navigate('/crisis')}
      onSettings={() => navigate('/settings')}
    />
  );
}

function SettingsRoute() {
  const navigate = useNavigate();
  const { vault, gates } = useAppServices();
  return (
    <SettingsScreen
      vault={vault}
      onBack={() => navigate('/')}
      onSignedOut={() => {
        // Drop the session flag, then route to the app root; the auth
        // gate in GatedLayout catches the next render and shows AuthFlow.
        gates.markSignedOut();
        navigate('/');
      }}
      // The "preview the new design" row — kept as a harmless escape
      // hatch into the isolated `/preview/*` surfaces.
      onPreview={() => navigate('/preview')}
    />
  );
}

/**
 * Crisis route. Mounted at the TOP of the route tree, OUTSIDE GatedLayout,
 * so the calm crisis surface is reachable in any app state — pre-auth,
 * pre-consent, pre-onboarding — exactly as the old `crisisOpen` early
 * return guaranteed.
 */
function CrisisRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <CrisisScreen onClose={() => navigate(-1)} />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * money-v2 preview route. Mounted OUTSIDE GatedLayout, like `/crisis`, so
 * it is reachable directly as a DEV PREVIEW of the clean-slate v2 money
 * rebuild — without going through onboarding and without appearing in any
 * main-flow navigation. It is additive: the live finance module and the
 * app's current navigation are untouched. The full migration is a later
 * decision.
 */
function MoneyV2PreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <MoneyV2PreviewScreen
        onExit={() => navigate('/home')}
        onSafe={() => navigate('/crisis')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * cycle-v2 preview route. Mounted OUTSIDE GatedLayout, like `/crisis` and
 * `/preview/money`, so it is reachable directly as a DEV PREVIEW of the
 * clean-slate v2 cycle rebuild — without going through onboarding and
 * without appearing in any main-flow navigation. It is additive: the live
 * cycle module and the app's current navigation are untouched. The full
 * migration is a later decision.
 */
function CycleV2PreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <CycleV2PreviewScreen
        onExit={() => navigate('/home')}
        onSafe={() => navigate('/crisis')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * sleep-v2 preview route. Mounted OUTSIDE GatedLayout, like `/crisis`,
 * `/preview/money` and `/preview/cycle`, so it is reachable directly as a
 * DEV PREVIEW of the clean-slate v2 sleep rebuild — without going through
 * onboarding and without appearing in any main-flow navigation. It is
 * additive: the live sleep module and the app's current navigation are
 * untouched. The full migration is a later decision.
 */
function SleepV2PreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <SleepV2PreviewScreen
        onExit={() => navigate('/home')}
        onSafe={() => navigate('/crisis')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * body-v2 preview route. Mounted OUTSIDE GatedLayout, like `/crisis`,
 * `/preview/money`, `/preview/cycle` and `/preview/sleep`, so it is
 * reachable directly as a DEV PREVIEW of the clean-slate v2 body rebuild —
 * without going through onboarding and without appearing in any main-flow
 * navigation. It is additive: the live body module and the app's current
 * navigation are untouched. The full migration is a later decision.
 */
function BodyV2PreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <BodyV2PreviewScreen
        onExit={() => navigate('/home')}
        onSafe={() => navigate('/crisis')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * medication-v2 preview route. Mounted OUTSIDE GatedLayout, like `/crisis`,
 * `/preview/money`, `/preview/cycle`, `/preview/sleep` and `/preview/body`,
 * so it is reachable directly as a DEV PREVIEW of the clean-slate v2
 * medication rebuild — without going through onboarding and without
 * appearing in any main-flow navigation. It is additive: the live
 * medication module and the app's current navigation are untouched. The
 * full migration is a later decision.
 */
function MedicationV2PreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <MedicationV2PreviewScreen
        onExit={() => navigate('/home')}
        onSafe={() => navigate('/crisis')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * habits-v2 preview route. Mounted OUTSIDE GatedLayout, like `/crisis`,
 * `/preview/money`, `/preview/cycle`, `/preview/sleep`, `/preview/body` and
 * `/preview/medication`, so it is reachable directly as a DEV PREVIEW of the
 * clean-slate v2 habits rebuild — without going through onboarding and
 * without appearing in any main-flow navigation. It is additive: the live
 * habits module and the app's current navigation are untouched. The full
 * migration is a later decision.
 */
function HabitsV2PreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <HabitsV2PreviewScreen
        onExit={() => navigate('/home')}
        onSafe={() => navigate('/crisis')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * partner-v2 preview route. Mounted OUTSIDE GatedLayout, like `/crisis` and
 * the other six `/preview/*` routes, so it is reachable directly as a DEV
 * PREVIEW of the clean-slate v2 partner system — without going through
 * onboarding and without appearing in any main-flow navigation. It is
 * additive: nothing in the live app is touched. partner-v2 is a NEW feature
 * with no backend, so it runs over an in-module local stub. The full ship
 * is a later decision.
 */
function PartnerV2PreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <PartnerV2PreviewScreen
        onExit={() => navigate('/home')}
        onSafe={() => navigate('/crisis')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * admin-v2 preview route. Mounted OUTSIDE GatedLayout, like `/crisis` and
 * the other `/preview/*` routes, so it is reachable directly as a DEV
 * PREVIEW of the clean-slate v2 admin rebuild — without going through
 * onboarding and without appearing in any main-flow navigation. It is
 * additive: the live admin module and the app's current navigation are
 * untouched. The full migration is a later decision.
 */
function AdminV2PreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <AdminV2PreviewScreen
        onExit={() => navigate('/home')}
        onSafe={() => navigate('/crisis')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * pets-v2 preview route. Mounted OUTSIDE GatedLayout, like `/crisis` and
 * the other `/preview/*` routes, so it is reachable directly as a DEV
 * PREVIEW of the clean-slate v2 pets rebuild — without going through
 * onboarding and without appearing in any main-flow navigation. It is
 * additive: the live pets module and the app's current navigation are
 * untouched. The full migration is a later decision.
 */
function PetsV2PreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <PetsV2PreviewScreen
        onExit={() => navigate('/home')}
        onSafe={() => navigate('/crisis')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * grocery-v2 preview route. Mounted OUTSIDE GatedLayout, like `/crisis` and
 * the other `/preview/*` routes, so it is reachable directly as a DEV
 * PREVIEW of the clean-slate v2 grocery rebuild — without going through
 * onboarding and without appearing in any main-flow navigation. It is
 * additive: the live grocery module and the app's current navigation are
 * untouched. The full migration is a later decision.
 */
function GroceryV2PreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <GroceryV2PreviewScreen
        onExit={() => navigate('/home')}
        onSafe={() => navigate('/crisis')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * work-v2 preview route. Mounted OUTSIDE GatedLayout, like `/crisis` and
 * the other `/preview/*` routes, so it is reachable directly as a DEV
 * PREVIEW of the clean-slate v2 work rebuild — the "matters" concept —
 * without going through onboarding and without appearing in any main-flow
 * navigation. It is additive: the live work module and the app's current
 * navigation are untouched. work-v2 reads the real matter backend (matter
 * container + dump routing, 9ed51e5) over the live `work` store namespace.
 * The full migration is a later decision.
 */
function WorkV2PreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <WorkV2PreviewScreen
        onExit={() => navigate('/home')}
        onSafe={() => navigate('/crisis')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * goals-v2 preview route. Mounted OUTSIDE GatedLayout, like `/crisis` and
 * the other `/preview/*` routes, so it is reachable directly as a DEV
 * PREVIEW of the clean-slate v2 goals rebuild — without going through
 * onboarding and without appearing in any main-flow navigation. It is
 * additive: the live goals module and the app's current navigation are
 * untouched. goals-v2 reads + writes the same `goals.*` store the live
 * module uses. The full migration is a later decision.
 */
function GoalsV2PreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <GoalsV2PreviewScreen
        onExit={() => navigate('/home')}
        onSafe={() => navigate('/crisis')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * v2-shell preview route — the ASSEMBLED clean-slate v2 app. Mounted
 * OUTSIDE GatedLayout, like `/crisis` and the 12 single `/preview/*`
 * routes, so the whole new design is reachable directly at `/preview/v2`
 * without going through onboarding. The shell's Safe dot routes to the
 * real crisis surface; the capture deck is wired to the real brain-dump
 * pipeline via `useAppServices().applyDump` inside the screen. Additive:
 * the live app and the 12 individual `/preview/{module}` routes are
 * untouched.
 */
function V2ShellPreviewRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <V2ShellPreviewScreen onSafe={() => navigate('/crisis')} />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

/**
 * Preview HUB route. Mounted OUTSIDE GatedLayout, like `/crisis` and the
 * 13 `/preview/*` preview routes, so it is reachable directly. This is
 * the route that makes the v2 redesign reachable in the native iOS app:
 * Settings has a "preview the new design" row that navigates here, and
 * every preview surface is one tap from this hub. A row tap pushes a real
 * history entry, so the hardware Back button returns to the hub; the
 * hub's own back returns to Settings.
 */
function PreviewHubRoute() {
  const navigate = useNavigate();
  return (
    <Suspense fallback={<PageLoading />}>
      <PreviewHubScreen
        onOpen={(path) => navigate(path)}
        onExit={() => navigate('/settings')}
      />
      {!CLERK_CONFIGURED && <DevModeBanner />}
    </Suspense>
  );
}

// ─── router ───────────────────────────────────────────────────────────────────

/**
 * The route table. Exported so tests can mount it with `createMemoryRouter`
 * and assert every screen is reachable by URL (the deep-link contract)
 * without booting the full account chain.
 */
export const routes = [
  // Crisis sits above the gate layout — always reachable.
  { path: '/crisis', element: <CrisisRoute /> },
  // Dev-only v2 money preview — above the gate layout, reachable directly.
  { path: '/preview/money', element: <MoneyV2PreviewRoute /> },
  // Dev-only v2 cycle preview — above the gate layout, reachable directly.
  { path: '/preview/cycle', element: <CycleV2PreviewRoute /> },
  // Dev-only v2 sleep preview — above the gate layout, reachable directly.
  { path: '/preview/sleep', element: <SleepV2PreviewRoute /> },
  // Dev-only v2 body preview — above the gate layout, reachable directly.
  { path: '/preview/body', element: <BodyV2PreviewRoute /> },
  // Dev-only v2 medication preview — above the gate layout, reachable directly.
  { path: '/preview/medication', element: <MedicationV2PreviewRoute /> },
  // Dev-only v2 habits preview — above the gate layout, reachable directly.
  { path: '/preview/habits', element: <HabitsV2PreviewRoute /> },
  // Dev-only v2 partner preview — above the gate layout, reachable directly.
  { path: '/preview/partner', element: <PartnerV2PreviewRoute /> },
  // Dev-only v2 admin preview — above the gate layout, reachable directly.
  { path: '/preview/admin', element: <AdminV2PreviewRoute /> },
  // Dev-only v2 pets preview — above the gate layout, reachable directly.
  { path: '/preview/pets', element: <PetsV2PreviewRoute /> },
  // Dev-only v2 grocery preview — above the gate layout, reachable directly.
  { path: '/preview/grocery', element: <GroceryV2PreviewRoute /> },
  // Dev-only v2 work preview — above the gate layout, reachable directly.
  { path: '/preview/work', element: <WorkV2PreviewRoute /> },
  // Dev-only v2 goals preview — above the gate layout, reachable directly.
  { path: '/preview/goals', element: <GoalsV2PreviewRoute /> },
  // The assembled clean-slate v2 app (the v2-shell) — above the gate
  // layout, reachable directly. The COMPLETE navigable v2 experience.
  { path: '/preview/v2', element: <V2ShellPreviewRoute /> },
  // The preview HUB — a tappable index of every preview surface above.
  // Above the gate layout, reachable directly; this is the entry point
  // for the native iOS app (no URL bar) via Settings.
  { path: '/preview', element: <PreviewHubRoute /> },
  {
    path: '/',
    element: <GatedLayout />,
    children: [
      // The app root IS the v2-shell — it owns all in-app navigation.
      { index: true, element: <ShellHostRoute /> },
      // Settings is still the hand-built screen, reached from the shell's
      // modules panel; kept as a real route so deep links + Back work.
      { path: 'settings', element: <SettingsRoute /> },
      // Every old screen route (home · dashboard · garden · module ·
      // insights · voice · gallery · onboarding) collapses into the
      // shell — any stale deep link or in-app navigate lands at the root.
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];

const router = createHashRouter(routes);

/**
 * Root export. `AppServicesProvider` must wrap `RouterProvider` so route
 * elements can `useAppServices()`. `BackButtonBridge` is rendered as a
 * sibling outside the router (it only touches `window.history`).
 */
export function AppRouter() {
  return (
    <AppServicesProvider>
      <BackButtonBridge />
      <RouterProvider router={router} />
    </AppServicesProvider>
  );
}
