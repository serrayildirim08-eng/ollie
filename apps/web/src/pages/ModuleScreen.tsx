import React, { lazy, Suspense, useEffect, useRef } from 'react';
import { FrostedCard } from '../components/FrostedCard';
import { BrainDumpInput } from '../components/BrainDumpInput';
import { ModuleHelp } from '../components/ModuleHelp';
import { getString } from '../i18n';
import { useStoreSlice, store } from '../store';
import { sessionTracker } from '../lib/session-tracker';
import { getAccount } from '../lib/account-boot';
import { readUserHash } from '../lib/user-hash';
import { getAppVersion } from '../lib/device';

// ─── lazy module imports ──────────────────────────────────────────────────────

const PetsModule      = lazy(() => import('../modules/pets/PetsModule').then(m => ({ default: m.PetsModule })));
const CycleModule     = lazy(() => import('../modules/cycle/CycleModule').then(m => ({ default: m.CycleModule })));
const GroceryModule   = lazy(() => import('../modules/grocery/GroceryModule').then(m => ({ default: m.GroceryModule })));
const FinanceModule   = lazy(() => import('../modules/finance/FinanceModule').then(m => ({ default: m.FinanceModule })));
const HabitsModule    = lazy(() => import('../modules/habits/HabitsModule').then(m => ({ default: m.HabitsModule })));
const SleepModule     = lazy(() => import('../modules/sleep/SleepModule').then(m => ({ default: m.SleepModule })));
const WorkModule      = lazy(() => import('../modules/work/WorkModule').then(m => ({ default: m.WorkModule })));
const BodyModule      = lazy(() => import('../modules/body/BodyModule').then(m => ({ default: m.BodyModule })));
const GoalsModule     = lazy(() => import('../modules/goals/GoalsModule').then(m => ({ default: m.GoalsModule })));
const AdminModule     = lazy(() => import('../modules/admin/AdminModule').then(m => ({ default: m.AdminModule })));
const DumpModule      = lazy(() => import('../modules/dump/DumpModule').then(m => ({ default: m.DumpModule })));
// AstrologyModule removed — deferred to backlog per audits/DECISIONS_2026-05-14.md Decision 2
const MedicationModule = lazy(() => import('../modules/medication/MedicationModule').then(m => ({ default: m.MedicationModule })));

// ─── telemetry whitelist ──────────────────────────────────────────────────────
// Only the canonical 12 modules emit module_events rows. Anything else
// (demo, redirect-through screens, placeholder routes) is dropped so the
// table doesn't accumulate noise that breaks downstream cohort queries.
const TRACKED_MODULES: ReadonlySet<string> = new Set([
  'grocery',
  'pets',
  'finance',
  'habits',
  'sleep',
  'cycle',
  'work',
  'goals',
  'admin',
  'body',
  'dump',
  'medication',
]);

// ─── fallback ─────────────────────────────────────────────────────────────────

function ModuleLoading() {
  return (
    <div
      style={{ minHeight: '100vh', background: 'var(--bone)' }}
      aria-busy="true"
      aria-label="loading module"
    />
  );
}

// ─── types ────────────────────────────────────────────────────────────────────

export interface ModuleScreenProps {
  moduleId: string;
  onNavigate: (to: 'home' | 'dashboard' | 'garden') => void;
  onBrainDump: (text: string) => void;
  children?: React.ReactNode;
}

// ─── per-module exceptions ────────────────────────────────────────────────────

function getBgConfig(moduleId: string): {
  bg: string;
  text: string;
  muted: string;
  showSkyVideo: boolean;
  dark: boolean;
} {
  if (moduleId === 'finance') {
    return {
      bg: '#0E0C14',
      text: 'rgba(255,255,255,0.85)',
      muted: 'rgba(255,255,255,0.4)',
      showSkyVideo: false,
      dark: true,
    };
  }
  if (moduleId === 'grocery') {
    return {
      bg: '#F5F0E8',
      text: '#14130F',
      muted: 'rgba(20,19,15,0.5)',
      showSkyVideo: false,
      dark: false,
    };
  }
  if (moduleId === 'pets') {
    return {
      bg: '#F2EEE4',
      text: '#14130F',
      muted: 'rgba(20,19,15,0.5)',
      showSkyVideo: false,
      dark: false,
    };
  }
  if (moduleId === 'cycle') {
    return {
      bg: '#E8DED0',
      text: '#1E1E1E',
      muted: '#8A8377',
      showSkyVideo: false,
      dark: false,
    };
  }
  // All other modules: sky video behind, translucent text
  return {
    bg: 'transparent',
    text: '#F5F4F0',
    muted: 'rgba(255,255,255,0.6)',
    showSkyVideo: true,
    dark: false,
  };
}

// ─── component ────────────────────────────────────────────────────────────────

export function ModuleScreen({
  moduleId,
  onNavigate,
  onBrainDump,
  children,
}: ModuleScreenProps) {
  const cfg = getBgConfig(moduleId);
  // Consent rewrite (Sprint 6): the per-feature consent gates for
  // cycle + astrology entry are gone. The new master gate (shared.
  // consent.necessary) is enforced at App.tsx top level — any user
  // reaching here has already given necessary consent.
  // Cycle visibility is now a pure preference, driven by the cycle-
  // tracking answer in onboarding (settings.cycle_tracking).
  const [cycleTracking] = useStoreSlice<string | null>('shared', 'settings.cycle_tracking', null);

  // Module telemetry — emits module_events open row on mount (and when
  // moduleId changes), and a close row on unmount / moduleId change.
  // Gated by research.hasConsent() — ConsentScreen sets necessary=true
  // before any user can reach this component; the check is defence-in-depth.
  // Only the 12 canonical modules track; non-canonical screens (demo,
  // placeholder routes) are dropped silently so module_events stays clean.
  const openedAtRef = useRef<number | null>(null);
  const actionsCountRef = useRef<number>(0);
  useEffect(() => {
    if (!TRACKED_MODULES.has(moduleId)) return;
    const account = getAccount();
    if (!account?.research.hasConsent()) return;
    const userHash = readUserHash();
    if (!userHash) return; // pre-sign-in — drop
    const country = store.get<string>('shared', 'settings.country', 'INTL') ?? 'INTL';
    const now = Date.now();
    openedAtRef.current = now;
    actionsCountRef.current = 0;
    const openedAt = new Date(now).toISOString();
    const sessionId = sessionTracker.getSessionId();

    account.research.trackTable('module_events', {
      user_hash: userHash,
      session_id: sessionId ?? '',
      module: moduleId,
      opened_at: openedAt,
      country,
      app_version: getAppVersion(),
    });

    // Register with session tracker so modules_opened is populated on end row.
    sessionTracker.onModuleOpened(moduleId);

    return () => {
      const closedAt = Date.now();
      const dur = openedAtRef.current !== null
        ? Math.round((closedAt - openedAtRef.current) / 1000)
        : 0;
      // Second INSERT — analytics coalesces with the open row by
      // (session_id, module, opened_at). closed_at being non-null is
      // the discriminator.
      account.research.trackTable('module_events', {
        session_id: sessionId ?? '',
        module: moduleId,
        closed_at: new Date(closedAt).toISOString(),
        duration_seconds: dur,
        actions_count: actionsCountRef.current,
        country,
      });
      openedAtRef.current = null;
    };
  // Re-run when moduleId changes (navigate between modules without unmount).
   
  }, [moduleId]);
  const cycleAllowed = cycleTracking === 'yes';

  // Sleep: full-screen takeover — owns its own paper/ink layout
  if (moduleId === 'sleep') {
    return (
      <>
        <Suspense fallback={<ModuleLoading />}>
          <SleepModule onBack={() => onNavigate('dashboard')} />
        </Suspense>
        <BrainDumpInput onSubmit={onBrainDump} />
      </>
    );
  }

  // Habits: full-screen takeover — owns its own paper/ink layout
  if (moduleId === 'habits') {
    return (
      <>
        <Suspense fallback={<ModuleLoading />}>
          <HabitsModule onBack={() => onNavigate('dashboard')} />
        </Suspense>
        <BrainDumpInput onSubmit={onBrainDump} />
      </>
    );
  }

  // Cycle: full-screen takeover with its own ceramic header — bypass wrapper.
  // Visibility follows the onboarding cycle-tracking preference. If the
  // user said "no / not anymore / postpartum", the module hides itself.
  if (moduleId === 'cycle') {
    if (!cycleAllowed) {
      onNavigate('dashboard');
      return null;
    }
    return (
      <>
        <Suspense fallback={<ModuleLoading />}>
          <CycleModule onBack={() => onNavigate('dashboard')} />
        </Suspense>
        <BrainDumpInput onSubmit={onBrainDump} />
      </>
    );
  }

  // Work: full-screen takeover — paper/ink layout, no sky video
  if (moduleId === 'work') {
    return (
      <>
        <Suspense fallback={<ModuleLoading />}>
          <WorkModule onBack={() => onNavigate('dashboard')} />
        </Suspense>
        <BrainDumpInput onSubmit={onBrainDump} />
      </>
    );
  }

  // Body: full-screen takeover — paper/ink layout, no sky video
  if (moduleId === 'body') {
    return (
      <>
        <Suspense fallback={<ModuleLoading />}>
          <BodyModule onBack={() => onNavigate('dashboard')} />
        </Suspense>
        <BrainDumpInput onSubmit={onBrainDump} />
      </>
    );
  }

  // Admin: full-screen takeover — paper/ink layout, no sky video
  if (moduleId === 'admin') {
    return (
      <>
        <Suspense fallback={<ModuleLoading />}>
          <AdminModule onBack={() => onNavigate('dashboard')} />
        </Suspense>
        <BrainDumpInput onSubmit={onBrainDump} />
      </>
    );
  }

  // Dump: full-screen takeover — paper/ink layout, no sky video
  if (moduleId === 'dump') {
    return (
      <>
        <Suspense fallback={<ModuleLoading />}>
          <DumpModule onBack={() => onNavigate('dashboard')} />
        </Suspense>
        <BrainDumpInput onSubmit={onBrainDump} />
      </>
    );
  }

  // Astrology deferred to backlog — redirect to dashboard.
  // See audits/DECISIONS_2026-05-14.md Decision 2.
  if (moduleId === 'astrology') {
    console.warn('[ModuleScreen] astrology deferred to backlog');
    onNavigate('dashboard');
    return null;
  }

  // Medication: dedicated module (E1) — cream bg
  if (moduleId === 'medication') {
    return (
      <>
        <Suspense fallback={<ModuleLoading />}>
          <MedicationModule />
        </Suspense>
        <BrainDumpInput onSubmit={onBrainDump} />
      </>
    );
  }

  // Goals: full-screen takeover — paper/ink layout, no sky video
  if (moduleId === 'goals') {
    return (
      <>
        <Suspense fallback={<ModuleLoading />}>
          <GoalsModule onBack={() => onNavigate('dashboard')} />
        </Suspense>
        <BrainDumpInput onSubmit={onBrainDump} />
      </>
    );
  }

  // Grocery: full-screen takeover — owns its own warm-cream layout + header
  if (moduleId === 'grocery') {
    return (
      <>
        <div style={{ position: 'relative', width: '100vw', minHeight: '100vh', background: '#F5F0E8' }}>
          {/* Back arrow */}
          <button
            type="button"
            aria-label="back to dashboard"
            onClick={() => onNavigate('dashboard')}
            style={{
              position: 'fixed',
              top: 'calc(24px + env(safe-area-inset-top))',
              left: 32,
              zIndex: 10,
              background: 'transparent',
              border: 'none',
              fontFamily: "'DM Mono', monospace",
              fontSize: 13,
              color: 'rgba(20,19,15,0.5)',
              cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            ←
          </button>
          <Suspense fallback={<ModuleLoading />}>
            <GroceryModule />
          </Suspense>
        </div>
        <BrainDumpInput onSubmit={onBrainDump} />
      </>
    );
  }

  // i18n title / sub — fall back to moduleId / empty string
  const titleKey = `module.tiles.${moduleId}.label`;
  const subKey = `module.tiles.${moduleId}.sub`;
  const title = getString('en', titleKey) !== titleKey ? getString('en', titleKey) : moduleId;
  const sub = getString('en', subKey) !== subKey ? getString('en', subKey) : '';

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        minHeight: '100vh',
        background: cfg.bg || undefined,
        color: cfg.text,
        overflowX: 'hidden',
      }}
    >
      {/* Sky video layer — only for standard modules */}
      {cfg.showSkyVideo && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 0,
            background:
              'linear-gradient(to bottom, #b8d4e8 0%, #d4eaf4 60%, #e8f0f4 100%)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Gradient overlay — matches home/dashboard, only for sky modules */}
      {cfg.showSkyVideo && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            width: '100%',
            height: '50%',
            background:
              'linear-gradient(to top, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.1) 60%, transparent 100%)',
            zIndex: 1,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Finance decorative orbs */}
      {moduleId === 'finance' && (
        <>
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              top: '-10%',
              right: '-5%',
              width: 400,
              height: 400,
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgba(100,60,180,0.15), transparent)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: 'fixed',
              bottom: '-15%',
              left: '-10%',
              width: 500,
              height: 500,
              borderRadius: '50%',
              background:
                'radial-gradient(circle, rgba(60,100,180,0.1), transparent)',
              pointerEvents: 'none',
              zIndex: 0,
            }}
          />
        </>
      )}

      {/* Scrollable content — top/bottom padding includes the iPhone
          safe areas so the module header clears the notch and content
          clears the home indicator. */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          maxWidth: 1200,
          margin: '0 auto',
          padding:
            'calc(40px + env(safe-area-inset-top)) 24px calc(120px + env(safe-area-inset-bottom))',
        }}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: 40,
          }}
        >
          {/* Back arrow + title */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <button
              type="button"
              aria-label="back to dashboard"
              onClick={() => onNavigate('dashboard')}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px 8px 4px 0',
                fontFamily: "'DM Mono', monospace",
                fontSize: 13,
                color: cfg.muted,
                cursor: 'pointer',
                letterSpacing: '0.04em',
                textShadow: cfg.showSkyVideo ? '0 1px 6px rgba(0,0,0,0.4)' : 'none',
                marginTop: 4,
              }}
            >
              ←
            </button>

            <div>
              <h1
                style={{
                  fontFamily: "'DM Serif Display', serif",
                  fontSize: 32,
                  fontWeight: 400,
                  color: cfg.text,
                  margin: 0,
                  lineHeight: 1.1,
                  textShadow: cfg.showSkyVideo
                    ? '0 2px 24px rgba(0,0,0,0.5)'
                    : 'none',
                  letterSpacing: '-0.01em',
                }}
              >
                {title}
              </h1>

              {sub && (
                <div
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: cfg.muted,
                    marginTop: 6,
                    lineHeight: 1.4,
                  }}
                >
                  {sub}
                </div>
              )}
            </div>
          </div>

          {/* ModuleHelp icon — top-right */}
          <div style={{ paddingTop: 4 }}>
            <ModuleHelp moduleId={moduleId} />
          </div>
        </header>

        {/* ── Content ──────────────────────────────────────────────────── */}
        <Suspense fallback={<ModuleLoading />}>
          {moduleId === 'pets'
            ? <PetsModule />
            : moduleId === 'finance'
            ? <FinanceModule />
            : (children ?? <PlaceholderContent moduleId={moduleId} dark={cfg.dark} showSkyVideo={cfg.showSkyVideo} />)}
        </Suspense>
      </div>

      {/* ── BrainDumpInput ───────────────────────────────────────────── */}
      <BrainDumpInput onSubmit={onBrainDump} />
    </div>
  );
}

// ─── placeholder card — rendered until real module content is wired ───────────

interface PlaceholderContentProps {
  moduleId: string;
  dark: boolean;
  showSkyVideo: boolean;
}

function PlaceholderContent({ moduleId, dark, showSkyVideo }: PlaceholderContentProps) {
  const borderColor = dark
    ? 'rgba(255,255,255,0.08)'
    : showSkyVideo
    ? 'rgba(255,255,255,0.25)'
    : 'rgba(20,19,15,0.10)';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 20,
      }}
    >
      <FrostedCard
        style={{
          padding: '40px 32px',
          background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.6)',
          border: `1px solid ${borderColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: dark
              ? 'rgba(255,255,255,0.35)'
              : showSkyVideo
              ? 'rgba(255,255,255,0.6)'
              : 'rgba(20,19,15,0.4)',
          }}
        >
          module: {moduleId}
        </span>
      </FrostedCard>
    </div>
  );
}
