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
  useParams,
} from 'react-router-dom';

import { useToast } from './components/ToastContext';
import { ToastHost } from './components/ToastHost';
import { ChipFlyHost } from './components/ChipFly';
import { MicButton } from './components/MicButton';
import { Day30Prompt } from './components/Day30Prompt';
import {
  NotificationPrimer,
  hasSeenNotificationPrimer,
} from './components/NotificationPrimer';
import { AuthFlow } from './components/AuthFlow';
import { ConsentScreen } from './components/ConsentScreen';
import { ConsentStep } from './screens/onboarding/ConsentStep';
import { OnboardingScreen } from './pages/OnboardingScreen';
import { DevModeBanner } from './components/DevModeBanner';
import { AppServicesProvider, useAppServices } from './app-services';
import { SUPABASE_CONFIGURED } from './app-gates';

// ─── lazy page imports ────────────────────────────────────────────────────────

const HomeScreen      = lazy(() => import('./pages/HomeScreen').then(m => ({ default: m.HomeScreen })));
const DashboardScreen = lazy(() => import('./pages/DashboardScreen').then(m => ({ default: m.DashboardScreen })));
const GardenScreen    = lazy(() => import('./pages/GardenScreen').then(m => ({ default: m.GardenScreen })));
const ModuleScreen    = lazy(() => import('./pages/ModuleScreen').then(m => ({ default: m.ModuleScreen })));
const SettingsScreen  = lazy(() => import('./pages/SettingsScreen').then(m => ({ default: m.SettingsScreen })));
const InsightsScreen  = lazy(() => import('./pages/InsightsScreen').then(m => ({ default: m.InsightsScreen })));
const VoiceScreen     = lazy(() => import('./pages/VoiceScreen').then(m => ({ default: m.VoiceScreen })));
const GalleryScreen   = lazy(() => import('./pages/GalleryScreen').then(m => ({ default: m.GalleryScreen })));
const CrisisScreen    = lazy(() => import('./pages/CrisisScreen').then(m => ({ default: m.CrisisScreen })));

function PageLoading() {
  return <div style={{ minHeight: '100vh', background: 'var(--bone)' }} aria-busy="true" />;
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
  const { auth, accountRef, gates } = useAppServices();

  // Gate 1 — auth. A session is required before anything is encrypted.
  if (!gates.authed) {
    return (
      <>
        <AuthFlow auth={auth} onAuthenticated={gates.markAuthed} />
        <ToastHost />
        <ChipFlyHost />
        {!SUPABASE_CONFIGURED && <DevModeBanner />}
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
        {!SUPABASE_CONFIGURED && <DevModeBanner />}
      </>
    );
  }

  // Gate 3 — research opt-in. `null` means never prompted.
  if (gates.researchOptin === null) {
    const session = accountRef.current.auth.state().session;
    return (
      <>
        <ConsentStep
          userId={session?.user_id ?? 'local-dev'}
          source={gates.researchSource}
          initial={{ marketing: gates.marketing, research_optin: false }}
          onContinue={gates.markResearchDecided}
        />
        <ToastHost />
        <ChipFlyHost />
        {!SUPABASE_CONFIGURED && <DevModeBanner />}
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
        {!SUPABASE_CONFIGURED && <DevModeBanner />}
      </>
    );
  }

  // All gates passed — render the routed screen plus the always-on
  // hosts. MicButton is hidden on the dedicated voice route (that screen
  // has its own capture control); the old code keyed this off `screen`.
  return (
    <>
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
      <ToastHost />
      <ChipFlyHost />
      <Day30Prompt />
      <NotificationPrimerGate />
      <RoutedMicButton />
      {!SUPABASE_CONFIGURED && <DevModeBanner />}
    </>
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

/**
 * MicButton, hidden on the voice route. Reads the location hash directly
 * — equivalent to the old `screen !== 'voice'` check.
 */
function RoutedMicButton() {
  const { applyDump } = useAppServices();
  const toast = useToast();
  const onVoiceRoute =
    typeof window !== 'undefined' && window.location.hash.startsWith('#/voice');
  if (onVoiceRoute) return null;
  return (
    <MicButton
      onTranscript={(text) => {
        toast.show(`heard · ${text}`, { module: 'voice', ttl: 6000 });
        applyDump(text, 'voice');
      }}
    />
  );
}

// ─── route elements ───────────────────────────────────────────────────────────

function HomeRoute() {
  const navigate = useNavigate();
  const { applyDump } = useAppServices();
  return (
    <HomeScreen
      onNavigate={(to) => navigate(`/${to}`)}
      onBrainDump={(text) => applyDump(text, 'text')}
      onCrisis={() => navigate('/crisis')}
    />
  );
}

function DashboardRoute() {
  const navigate = useNavigate();
  const { applyDump } = useAppServices();
  return (
    <DashboardScreen
      onNavigate={(to, moduleId) => {
        if (to === 'module' && moduleId) navigate(`/module/${moduleId}`);
        else navigate(`/${to}`);
      }}
      onBrainDump={(text) => applyDump(text, 'text')}
    />
  );
}

function GardenRoute() {
  const navigate = useNavigate();
  return <GardenScreen onNavigate={(to) => navigate(`/${to}`)} />;
}

function ModuleRoute() {
  const navigate = useNavigate();
  const { applyDump } = useAppServices();
  const { id } = useParams<{ id: string }>();
  return (
    <ModuleScreen
      moduleId={id ?? ''}
      onNavigate={(to) => navigate(`/${to}`)}
      onBrainDump={(text) => applyDump(text, 'text')}
    />
  );
}

function SettingsRoute() {
  const navigate = useNavigate();
  const { auth, gates } = useAppServices();
  return (
    <SettingsScreen
      auth={auth}
      onBack={() => navigate('/home')}
      onSignedOut={() => {
        // Drop the session flag, then route home; the auth gate in
        // GatedLayout catches the next render and shows AuthFlow.
        gates.markSignedOut();
        navigate('/home');
      }}
    />
  );
}

function InsightsRoute() {
  const navigate = useNavigate();
  return <InsightsScreen onNavigate={() => navigate('/home')} />;
}

function VoiceRoute() {
  const navigate = useNavigate();
  const { applyDump } = useAppServices();
  return (
    <VoiceScreen
      onNavigate={() => navigate('/home')}
      onApply={(text) => applyDump(text, 'voice')}
    />
  );
}

function GalleryRoute() {
  const navigate = useNavigate();
  return <GalleryScreen onNavigate={() => navigate('/home')} />;
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
      {!SUPABASE_CONFIGURED && <DevModeBanner />}
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
  {
    path: '/',
    element: <GatedLayout />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      { path: 'home', element: <HomeRoute /> },
      { path: 'dashboard', element: <DashboardRoute /> },
      { path: 'garden', element: <GardenRoute /> },
      { path: 'module/:id', element: <ModuleRoute /> },
      { path: 'settings', element: <SettingsRoute /> },
      { path: 'insights', element: <InsightsRoute /> },
      { path: 'voice', element: <VoiceRoute /> },
      { path: 'gallery', element: <GalleryRoute /> },
      // The old machine had an 'onboarding' screen; onboarding is a gate,
      // so this path just lands at home (the gate intercepts if needed).
      { path: 'onboarding', element: <Navigate to="/home" replace /> },
      // Unknown deep link → home, not a blank screen.
      { path: '*', element: <Navigate to="/home" replace /> },
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
