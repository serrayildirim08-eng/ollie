import React, { lazy, Suspense, useState } from 'react';
import { REGISTRY } from '@ollie/events';
import * as appEventsForToast from '@ollie/events';
import { cycle } from '@ollie/logic';
import { getString } from './i18n';
import { useStoreSlice, store } from './store';
import { FrostedCard } from './components/FrostedCard';
import { ModuleHelp } from './components/ModuleHelp';
import { SourcesLink } from './components/SourcesLink';
import { ToastHost } from './components/ToastHost';
import { MicButton } from './components/MicButton';
import { ToastProvider, useToast } from './components/ToastContext';
import { Burhan3D } from './components/Burhan3D';
import { BrainDumpInput } from './components/BrainDumpInput';
import { ChipFlyHost, chipFly } from './components/ChipFly';
import { OnboardingScreen } from './pages/OnboardingScreen';
import { AuthFlow } from './components/AuthFlow';
import { ConsentScreen } from './components/ConsentScreen';
import { ConsentStep } from './screens/onboarding/ConsentStep';
import {
  configureConsent,
  type ConsentState,
} from '@ollie/consent';
import { useApplyBrainDump } from './hooks/useApplyBrainDump';
import { trackSession } from './lib/retention';
import { emit as emitEvent } from '@ollie/events';
import { bootAccount } from './lib/account-boot';
import { sessionTracker } from './lib/session-tracker';
import { readUserHash } from './lib/user-hash';
import { getDeviceId, getAppVersion } from './lib/device';
import { createConsentSync } from './lib/consent-sync';

// ─── lazy page imports ────────────────────────────────────────────────────────

const HomeScreen      = lazy(() => import('./pages/HomeScreen').then(m => ({ default: m.HomeScreen })));
const DashboardScreen = lazy(() => import('./pages/DashboardScreen').then(m => ({ default: m.DashboardScreen })));
const GardenScreen    = lazy(() => import('./pages/GardenScreen').then(m => ({ default: m.GardenScreen })));
const ModuleScreen    = lazy(() => import('./pages/ModuleScreen').then(m => ({ default: m.ModuleScreen })));
const SettingsScreen  = lazy(() => import('./pages/SettingsScreen').then(m => ({ default: m.SettingsScreen })));

function PageLoading() {
  return <div style={{ minHeight: '100vh', background: 'var(--bone)' }} aria-busy="true" />;
}

type Screen = 'home' | 'dashboard' | 'garden' | 'module' | 'demo' | 'onboarding' | 'settings';

const eventCount = Object.keys(REGISTRY).length;

const DAY = 86_400_000;
const SAMPLE_STARTS = [0, 28, 56, 84, 112, 140].map((d) => ({
  ts: Date.now() - (140 - d) * DAY,
  action: 'started' as const,
}));
const samplePrediction = cycle.predictNextPeriod(cycle.detectBoundaries(SAMPLE_STARTS));

// Backend (Supabase) is optional in local/dogfood builds. If
// VITE_SUPABASE_URL isn't set, AuthFlow can't actually create an
// account — every signup hits the Vite dev server and 404s. Skip the
// gate in that case so the app falls through to onboarding-first
// behavior; sync + research stay no-ops until the env is wired.
const SUPABASE_CONFIGURED = Boolean(
  (import.meta as unknown as { env?: { VITE_SUPABASE_URL?: string } }).env?.VITE_SUPABASE_URL,
);

if (!SUPABASE_CONFIGURED && typeof console !== 'undefined') {
  // Loud once per page load — paired with the DevModeBanner UI so a
  // dev never silently runs without auth.
  console.warn('[ollie] VITE_SUPABASE_URL missing — auth disabled, sync inactive');
}

// Fix 5: when the auth gate is skipped, surface a tiny sage banner so
// Serra never confuses a missing-env build with a real authenticated
// session. Dismissible-per-session via sessionStorage.
const DEV_BANNER_DISMISS_KEY = 'ollie:dev-mode-banner:dismissed';

function DevModeBanner() {
  const [dismissed, setDismissed] = React.useState<boolean>(() => {
    try { return sessionStorage.getItem(DEV_BANNER_DISMISS_KEY) === '1'; } catch { return false; }
  });
  if (dismissed) return null;

  const onDismiss = () => {
    try { sessionStorage.setItem(DEV_BANNER_DISMISS_KEY, '1'); } catch { /* non-fatal */ }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-label="dev mode banner"
      style={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        zIndex: 10000,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 10px',
        background: 'rgba(123, 154, 134, 0.14)',
        color: '#5e7d6c',
        border: '1px solid rgba(123, 154, 134, 0.32)',
        borderRadius: 4,
        fontFamily: "'DM Mono', monospace",
        fontSize: 10,
        letterSpacing: '0.16em',
        textTransform: 'lowercase',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <span>dev mode · no auth</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="dismiss dev mode banner"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          letterSpacing: 'inherit',
          cursor: 'pointer',
          padding: '0 2px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

function AppInner() {
  // Auth gate: unauthenticated users see AuthFlow first.
  // bootAccount is idempotent — main.tsx also calls it.
  const accountRef = React.useRef(bootAccount());
  const [authed, setAuthed] = useState<boolean>(
    () => !SUPABASE_CONFIGURED || Boolean(accountRef.current.auth.state().session),
  );

  // First-launch detection: check onboarded flag before any other screen
  const onboardedRaw = store.get<boolean>('shared', 'onboarded', false);
  const [onboarded, setOnboarded] = useState<boolean>(Boolean(onboardedRaw));

  // Consent rewrite (Sprint 6): shared.consent.necessary is the master
  // gate that replaces the per-feature consent flags. It's one-way (off
  // → on, no way back without account deletion) and required to enter
  // the app. Fresh sign-ups land on ConsentScreen before onboarding;
  // returning users with consent.necessary === true skip it.
  const necessaryRaw = store.get<boolean>('shared', 'consent.necessary', false);
  const [consentGiven, setConsentGiven] = useState<boolean>(Boolean(necessaryRaw));

  // Sprint B' (pivot 2026-05-14): research opt-in gate. Reads the
  // canonical @ollie/consent state. Three signals:
  //   - null  → never prompted → must mount ConsentStep
  //   - true  → opted in → research-stream + ai-proxy /label active
  //   - false → opted out → research paths no-op
  //
  // Pre-pivot users (Sprint 6 returning) come in with set_at before
  // the pivot date; @ollie/consent's getConsent() migrates them to
  // research_optin: null so the UI re-prompts.
  const consentBootedRef = React.useRef(false);
  if (!consentBootedRef.current) {
    // Sprint B'' Item 4: the `sync` arg is the durable Supabase sink. Without
    // it, @ollie/consent only writes through to the local store and the
    // consent_audit row never lands. The sink reads VITE_AI_WORKER_URL at
    // call-time, so pre-auth writes (no user_hash yet) silently no-op and
    // production writes flow through ai-proxy /ingest-event → Supabase.
    configureConsent({ store, sync: createConsentSync() });
    consentBootedRef.current = true;
  }
  const consentPersisted = store.get<ConsentState | null>('consent', 'state', null);
  const initialResearchOptin: boolean | null =
    consentPersisted?.research_optin ?? null;
  const [researchOptin, setResearchOptin] = useState<boolean | null>(
    initialResearchOptin,
  );

  const [screen, setScreen] = useState<Screen>('home');
  const [selectedModule, setSelectedModule] = useState<string>('');
  const [visits, setVisits] = useStoreSlice<number>('shared', 'visit_count', 0);
  const toast = useToast();
  const demoTileRef = React.useRef<HTMLDivElement>(null);

  // Audit-fix #3: surface `void:toast` events through the existing
  // ToastHost. The reminder scheduler emits void:toast on every fire
  // and previously nothing was listening — the user saw nothing.
  React.useEffect(() => {
    const off = appEventsForToast.on('void:toast', (payload: unknown) => {
      const p = (payload ?? {}) as { message?: string; module?: string };
      if (p.message) toast.show(p.message, { module: p.module ?? 'reminder' });
    });
    return () => off();
  }, [toast]);

  // Retention markers — fires once per app mount. Emits
  // void:retention:installed on fresh install, session_started every
  // time, d1_returned the first time the user comes back ≥24h after
  // install, d7_returned at ≥7d. Local-only until backend lands.
  React.useEffect(() => {
    trackSession(store, emitEvent);
  }, []);

  // Session telemetry — emits session_events start row once auth +
  // consent are confirmed, and an end row on tab close / background.
  // Gated on consent.necessary via research.hasConsent() inside
  // sessionTracker.start(). readUserHash() is null until deriveUserHash()
  // is called at sign-in — pre-auth sessions are silently dropped.
  React.useEffect(() => {
    if (!authed || !consentGiven) return;
    const research = accountRef.current.research;
    const userHash = readUserHash() ?? '';
    const country = store.get<string>('shared', 'settings.country', 'INTL') ?? 'INTL';
    sessionTracker.start(research, {
      user_hash: userHash,
      country,
      device_id: getDeviceId(),
      app_version: getAppVersion(),
    });

    function handleEnd() {
      sessionTracker.end(research);
    }

    window.addEventListener('beforeunload', handleEnd);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') handleEnd();
    });

    return () => {
      window.removeEventListener('beforeunload', handleEnd);
      handleEnd();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, consentGiven]);

  // F5 (Sprint 5): global reduce-motion-today.
  // Cross-module router writes shared.reduce_motion_today when a
  // pacing breach fires. Apply globally as a CSS variable + data attr
  // so transitions tagged with the duration vars short-circuit to 0ms
  // for the day. No banner, just a quieter app surface.
  React.useEffect(() => {
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

  const apply = useApplyBrainDump();

  // Record every brain-dump in the session tracker so the end row
  // has accurate voice_used / text_used / brain_dumps_count.
  // Modality here is 'text' for keyboard input; MicButton path below
  // tracks as 'voice'.
  const homeDump = (text: string) => {
    sessionTracker.onBrainDump('text');
    void apply(text);
  };
  const dashDump = (text: string) => {
    sessionTracker.onBrainDump('text');
    void apply(text);
  };
  const moduleDump = (text: string) => {
    sessionTracker.onBrainDump('text');
    void apply(text);
  };
  const demoDump = (text: string) => {
    sessionTracker.onBrainDump('text');
    const rect = demoTileRef.current?.getBoundingClientRect();
    void apply(text, rect ?? undefined);
  };

  let content: React.ReactNode;

  // Auth gate runs BEFORE onboarding. A session is required to encrypt
  // anything (sync/backup/research). Sign-up + sign-in is Pattern A:
  // passphrase never leaves the device.
  if (!authed) {
    return (
      <>
        <AuthFlow
          auth={accountRef.current.auth}
          onAuthenticated={() => setAuthed(true)}
        />
        <ToastHost />
        <ChipFlyHost />
        {!SUPABASE_CONFIGURED && <DevModeBanner />}
      </>
    );
  }

  // Consent gate (Sprint 6): runs AFTER auth and BEFORE onboarding.
  // Fresh sign-ups land here with consent.necessary === false (default).
  // The screen is one-way: tapping "necessary opt-in" flips it true,
  // and that flip is what unlocks the rest of the app. Returning users
  // with consent.necessary === true bypass this entirely.
  if (!consentGiven) {
    return (
      <>
        <ConsentScreen
          onContinue={() => setConsentGiven(true)}
        />
        <ToastHost />
        <ChipFlyHost />
        {!SUPABASE_CONFIGURED && <DevModeBanner />}
      </>
    );
  }

  // Sprint B' (pivot 2026-05-14): research opt-in gate. Three doors:
  //   - Fresh post-pivot sign-up: ConsentScreen flipped necessary,
  //     research_optin is still null → mount ConsentStep with
  //     source: 'onboarding'.
  //   - Pre-pivot returning user: their state was migrated by
  //     @ollie/consent on first read to research_optin: null →
  //     mount ConsentStep with source: 'reprompt'.
  //   - Already-decided user: research_optin is true | false → skip.
  if (researchOptin === null) {
    const session = accountRef.current.auth.state().session;
    const userId = session?.user_id ?? 'local-dev';
    const source: 'onboarding' | 'reprompt' =
      Boolean(onboardedRaw) ? 'reprompt' : 'onboarding';
    return (
      <>
        <ConsentStep
          userId={userId}
          source={source}
          initial={{
            marketing: consentPersisted?.marketing ?? false,
            research_optin: false,
          }}
          onContinue={() => {
            const written = store.get<ConsentState | null>('consent', 'state', null);
            setResearchOptin(written?.research_optin ?? false);
          }}
        />
        <ToastHost />
        <ChipFlyHost />
        {!SUPABASE_CONFIGURED && <DevModeBanner />}
      </>
    );
  }

  // Show onboarding before any other screen on first launch
  if (!onboarded) {
    content = (
      <OnboardingScreen
        onComplete={() => {
          store.set('shared', 'onboarded', true);
          setOnboarded(true);
        }}
      />
    );
    return (
      <>
        {content}
        <ToastHost />
        <ChipFlyHost />
        {!SUPABASE_CONFIGURED && <DevModeBanner />}
      </>
    );
  }

  if (screen === 'home') {
    content = (
      <Suspense fallback={<PageLoading />}>
        <HomeScreen
          onNavigate={(to) => {
            if (to === 'dashboard') setScreen('dashboard');
            else if (to === 'garden') setScreen('garden');
            else if (to === 'settings') setScreen('settings');
          }}
          onBrainDump={homeDump}
        />
      </Suspense>
    );
  } else if (screen === 'settings') {
    content = (
      <Suspense fallback={<PageLoading />}>
        <SettingsScreen
          auth={accountRef.current.auth}
          onBack={() => setScreen('home')}
          onSignedOut={() => { setAuthed(false); setScreen('home'); }}
        />
      </Suspense>
    );
  } else if (screen === 'garden') {
    // Consent rewrite (Sprint 6): garden is now auth-gated only. Every
    // authed user has shared.consent.necessary === true by definition,
    // so the prior per-feature spending-research gate is gone.
    content = (
      <Suspense fallback={<PageLoading />}>
        <GardenScreen
          onNavigate={(to) => {
            if (to === 'home') setScreen('home');
          }}
        />
      </Suspense>
    );
  } else if (screen === 'dashboard') {
    content = (
      <Suspense fallback={<PageLoading />}>
        <DashboardScreen
          onNavigate={(to, moduleId) => {
            if (to === 'home') setScreen('home');
            else if (to === 'garden') setScreen('garden');
            else if (to === 'module' && moduleId) {
              setSelectedModule(moduleId);
              setScreen('module');
            }
          }}
          onBrainDump={dashDump}
        />
      </Suspense>
    );
  } else if (screen === 'module') {
    content = (
      <Suspense fallback={<PageLoading />}>
        <ModuleScreen
          moduleId={selectedModule}
          onNavigate={(to) => {
            if (to === 'dashboard') setScreen('dashboard');
            else if (to === 'home') setScreen('home');
            else if (to === 'garden') setScreen('garden');
          }}
          onBrainDump={moduleDump}
        />
      </Suspense>
    );
  } else {
    // demo screen
    content = (
      <main
        style={{
          minHeight: '100vh',
          background: 'var(--bone)',
          color: 'var(--ink)',
          fontFamily: 'var(--font-editor)',
          padding: '4rem 2rem',
        }}
      >
        <FrostedCard style={{ padding: '2rem', maxWidth: '560px' }}>
          <h1 style={{ fontSize: 'var(--t-h1)', fontWeight: 400, margin: 0 }}>
            {getString('en', 'onb.intro.title')}
          </h1>
          <p
            style={{
              color: 'var(--ink-soft)',
              fontSize: 'var(--t-body)',
              marginTop: '1rem',
              maxWidth: '40ch',
            }}
          >
            ollie · workspace scaffold · phase 3c
          </p>

          <p
            style={{
              color: 'var(--ink-faint)',
              fontSize: 'var(--t-caption)',
              marginTop: '2rem',
              fontFamily: 'var(--font-system)',
              letterSpacing: '0.04em',
              lineHeight: 1.7,
            }}
          >
            @ollie/events · {eventCount} events registered
            <br />
            @ollie/store · you've opened this page {visits} {visits === 1 ? 'time' : 'times'}
            <br />
            @ollie/logic · sample 6-cycle user · tier {samplePrediction.tier} · avg{' '}
            {samplePrediction.avgCycle}d · next around{' '}
            {samplePrediction.expectedStart?.toISOString().slice(0, 10) ?? '—'}
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setVisits(visits + 1)}
              style={{
                padding: '0.5rem 1rem',
                background: 'transparent',
                color: 'var(--ink)',
                border: '1px solid var(--rule)',
                borderRadius: '4px',
                fontFamily: 'var(--font-system)',
                fontSize: 'var(--t-caption)',
                cursor: 'pointer',
              }}
            >
              bump visit count
            </button>

            <button
              type="button"
              onClick={() => toast.show('logged → demo', { module: 'demo' })}
              style={{
                padding: '0.5rem 1rem',
                background: 'transparent',
                color: 'var(--ink)',
                border: '1px solid var(--rule)',
                borderRadius: '4px',
                fontFamily: 'var(--font-system)',
                fontSize: 'var(--t-caption)',
                cursor: 'pointer',
              }}
            >
              show toast
            </button>

            <button
              type="button"
              onClick={() => setScreen('home')}
              style={{
                padding: '0.5rem 1rem',
                background: 'transparent',
                color: 'var(--ink)',
                border: '1px solid var(--rule)',
                borderRadius: '4px',
                fontFamily: 'var(--font-system)',
                fontSize: 'var(--t-caption)',
                cursor: 'pointer',
              }}
            >
              ← home screen
            </button>
          </div>
        </FrostedCard>

        {/* ModuleHelp + SourcesLink demo */}
        <div
          style={{
            marginTop: '2rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontFamily: 'var(--font-system)',
                fontSize: 'var(--t-meta)',
                letterSpacing: 'var(--ls-caps-small)',
                textTransform: 'uppercase',
                color: 'var(--ink-faint)',
              }}
            >
              cycle module
            </span>
            <ModuleHelp moduleId="cycle" />
          </div>
          <SourcesLink
            sources={['https://www.acog.org/womens-health/faqs/abnormal-uterine-bleeding']}
          />
        </div>

        {/* Demo tile — target for chipFly. data-magic-tile lets the chip navigate to it. */}
        <div
          ref={demoTileRef}
          data-magic-tile="demo"
          style={{
            marginTop: '2rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-sm)',
            fontFamily: "'DM Mono', monospace",
            fontSize: 'var(--t-meta)',
            letterSpacing: 'var(--ls-caps-small)',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
            transition: 'background-color 300ms ease',
          }}
        >
          demo tile · chipFly target
        </div>

        <div style={{ marginTop: '3rem', display: 'flex', alignItems: 'flex-end', gap: '2rem', paddingBottom: '120px' }}>
          <Burhan3D height={220} width={220} />
          <Burhan3D height={320} width={320} />
        </div>

        <BrainDumpInput
          onSubmit={demoDump}
          placeholder="type something and press enter..."
        />
      </main>
    );
  }

  return (
    <>
      {content}
      {/* ToastHost + ChipFlyHost are top-level so chips/toasts work on every screen */}
      <ToastHost />
      <ChipFlyHost />
      {/* MicButton — push-to-talk, hidden when onboarding.
          Shows "heard · …" so user can tell a transcription miss from
          a routing miss before the apply pipeline runs. */}
      {onboarded && screen !== 'onboarding' && (
        <MicButton onTranscript={(text) => {
          sessionTracker.onBrainDump('voice');
          toast.show(`heard · ${text}`, { module: 'voice', ttl: 6000 });
          void apply(text);
        }} />
      )}
      {!SUPABASE_CONFIGURED && <DevModeBanner />}
    </>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
