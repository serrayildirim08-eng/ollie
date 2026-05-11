import React, { lazy, Suspense, useState } from 'react';
import { REGISTRY } from '@ollie/events';
import { cycle } from '@ollie/logic';
import { getString } from './i18n';
import { useStoreSlice, store } from './store';
import { FrostedCard } from './components/FrostedCard';
import { ModuleHelp } from './components/ModuleHelp';
import { SourcesLink } from './components/SourcesLink';
import { ToastHost } from './components/ToastHost';
import { ToastProvider, useToast } from './components/ToastContext';
import { Burhan3D } from './components/Burhan3D';
import { BrainDumpInput } from './components/BrainDumpInput';
import { ChipFlyHost, chipFly } from './components/ChipFly';
import { OnboardingScreen } from './pages/OnboardingScreen';
import { useApplyBrainDump } from './hooks/useApplyBrainDump';

// ─── lazy page imports ────────────────────────────────────────────────────────

const HomeScreen      = lazy(() => import('./pages/HomeScreen').then(m => ({ default: m.HomeScreen })));
const DashboardScreen = lazy(() => import('./pages/DashboardScreen').then(m => ({ default: m.DashboardScreen })));
const GardenScreen    = lazy(() => import('./pages/GardenScreen').then(m => ({ default: m.GardenScreen })));
const ModuleScreen    = lazy(() => import('./pages/ModuleScreen').then(m => ({ default: m.ModuleScreen })));

function PageLoading() {
  return <div style={{ minHeight: '100vh', background: 'var(--bone)' }} aria-busy="true" />;
}

type Screen = 'home' | 'dashboard' | 'garden' | 'module' | 'demo' | 'onboarding';

const eventCount = Object.keys(REGISTRY).length;

const DAY = 86_400_000;
const SAMPLE_STARTS = [0, 28, 56, 84, 112, 140].map((d) => ({
  ts: Date.now() - (140 - d) * DAY,
  action: 'started' as const,
}));
const samplePrediction = cycle.predictNextPeriod(cycle.detectBoundaries(SAMPLE_STARTS));

function AppInner() {
  // First-launch detection: check onboarded flag before any other screen
  const onboardedRaw = store.get<boolean>('shared', 'onboarded', false);
  const [onboarded, setOnboarded] = useState<boolean>(Boolean(onboardedRaw));

  const [screen, setScreen] = useState<Screen>('home');
  const [selectedModule, setSelectedModule] = useState<string>('');
  const [visits, setVisits] = useStoreSlice<number>('shared', 'visit_count', 0);
  const toast = useToast();
  const demoTileRef = React.useRef<HTMLDivElement>(null);

  const apply = useApplyBrainDump();

  const homeDump = (text: string) => { void apply(text); };
  const dashDump = (text: string) => { void apply(text); };
  const moduleDump = (text: string) => { void apply(text); };
  const demoDump = (text: string) => {
    const rect = demoTileRef.current?.getBoundingClientRect();
    void apply(text, rect ?? undefined);
  };

  let content: React.ReactNode;

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
          }}
          onBrainDump={homeDump}
        />
      </Suspense>
    );
  } else if (screen === 'garden') {
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
