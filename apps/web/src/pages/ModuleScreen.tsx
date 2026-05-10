import React from 'react';
import { FrostedCard } from '../components/FrostedCard';
import { BrainDumpInput } from '../components/BrainDumpInput';
import { ModuleHelp } from '../components/ModuleHelp';
import { getString } from '../i18n';
import { PetsModule } from '../modules/pets/PetsModule';
import { CycleModule } from '../modules/cycle/CycleModule';
import { GroceryModule } from '../modules/grocery/GroceryModule';
import { FinanceModule } from '../modules/finance/FinanceModule';

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

  // Cycle: full-screen takeover with its own ceramic header — bypass wrapper
  if (moduleId === 'cycle') {
    return (
      <>
        <CycleModule onBack={() => onNavigate('dashboard')} />
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
              top: 24,
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
          <GroceryModule />
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

      {/* Scrollable content */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          maxWidth: 1200,
          margin: '0 auto',
          padding: '40px 24px 120px',
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
        {moduleId === 'pets'
          ? <PetsModule />
          : moduleId === 'finance'
          ? <FinanceModule />
          : (children ?? <PlaceholderContent moduleId={moduleId} dark={cfg.dark} showSkyVideo={cfg.showSkyVideo} />)}
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
