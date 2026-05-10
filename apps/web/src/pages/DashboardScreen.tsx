import React from 'react';
import { FrostedCard } from '../components/FrostedCard';
import { BrainDumpInput } from '../components/BrainDumpInput';
import { BurhanTree } from '../components/BurhanTree';

// ─── types ───────────────────────────────────────────────────────────────────

export type DashboardScreenTarget = 'home' | 'garden' | 'module';

export interface DashboardScreenProps {
  onNavigate: (to: DashboardScreenTarget, moduleId?: string) => void;
  onBrainDump: (text: string) => void;
  stats?: {
    dueToday: number;
    billsSoon: number;
    tracked: string;
  };
}

// ─── module tile data ─────────────────────────────────────────────────────────

interface ModuleTile {
  id: string;
  label: string;
  emoji: string;
  sub: string;
}

const MODULES: ModuleTile[] = [
  { id: 'grocery',   label: 'grocery',   emoji: '🛒', sub: 'pantry · lists · recipes'  },
  { id: 'pets',      label: 'pets',      emoji: '🐾', sub: 'care · meds · vet'         },
  { id: 'finance',   label: 'finance',   emoji: '💳', sub: 'bills · goals · adhd tax'  },
  { id: 'habits',    label: 'habits',    emoji: '⟳',  sub: 'daily · resets at midnight' },
  { id: 'sleep',     label: 'sleep',     emoji: '◐',  sub: 'wind-down · sounds'        },
  { id: 'cycle',     label: 'cycle',     emoji: '○',  sub: 'tracking · patterns'       },
  { id: 'work',      label: 'work',      emoji: '▦',  sub: 'tasks · focus · deadlines' },
  { id: 'goals',     label: 'goals',     emoji: '◎',  sub: 'long-term · aspirations'   },
  { id: 'admin',     label: 'admin',     emoji: '◻',  sub: 'renewals · appointments'   },
  { id: 'astrology', label: 'astrology', emoji: '✦',  sub: 'chart · transits'          },
  { id: 'body',      label: 'body',      emoji: '◇',  sub: 'water · supplements'       },
  { id: 'dump',      label: 'dump',      emoji: '∿',  sub: 'thoughts · journal'        },
];

// ─── component ───────────────────────────────────────────────────────────────

export function DashboardScreen({ onNavigate, onBrainDump, stats }: DashboardScreenProps) {
  const now = new Date();
  const dateStr = now
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toLowerCase();

  const dueToday  = stats?.dueToday  ?? 0;
  const billsSoon = stats?.billsSoon ?? 0;
  const tracked   = stats?.tracked   ?? '0m';

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        minHeight: '100vh',
        background: 'var(--bone)',
        color: 'var(--ink)',
        overflowX: 'hidden',
      }}
    >
      {/* Sky video — inherited from parent viewport layer, rendered behind */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          background: 'linear-gradient(to bottom, #b8d4e8 0%, #d4eaf4 60%, #e8f0f4 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Dark gradient overlay (matches home) */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          width: '100%',
          height: '50%',
          background: 'linear-gradient(to top, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.1) 60%, transparent 100%)',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />

      {/* Scrollable content layer */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          maxWidth: 1200,
          margin: '0 auto',
          padding: '40px 24px 140px',
        }}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 32,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Back arrow */}
            <button
              type="button"
              aria-label="back to home"
              onClick={() => onNavigate('home')}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px 8px 4px 0',
                fontFamily: "'DM Mono', monospace",
                fontSize: 13,
                color: 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                letterSpacing: '0.04em',
                textShadow: '0 1px 6px rgba(0,0,0,0.4)',
              }}
            >
              ←
            </button>

            {/* VOID wordmark */}
            <span
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: 28,
                fontWeight: 400,
                color: '#F5F4F0',
                textShadow: '0 2px 12px rgba(0,0,0,0.4)',
                letterSpacing: '-0.01em',
                lineHeight: 1,
              }}
            >
              VOID
            </span>

            {/* Date */}
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.55)',
                textShadow: '0 1px 6px rgba(0,0,0,0.4)',
              }}
            >
              {dateStr}
            </span>
          </div>

          {/* Mini Burhan — tappable → garden */}
          <button
            type="button"
            aria-label="open garden · burhan the olive tree"
            onClick={() => onNavigate('garden')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              lineHeight: 0,
            }}
          >
            <BurhanTree height={66} tone="home" onClick={undefined} />
          </button>
        </header>

        {/* ── Stats bar ────────────────────────────────────────────────── */}
        <FrostedCard
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            marginBottom: 32,
          }}
        >
          {(
            [
              { label: 'due today', value: String(dueToday) },
              { label: 'bills soon', value: String(billsSoon) },
              { label: 'tracked',   value: tracked           },
            ] as const
          ).map((s, i) => (
            <div
              key={s.label}
              style={{
                padding: '18px 20px',
                borderRight: i < 2 ? '1px solid rgba(255,255,255,0.25)' : 'none',
              }}
            >
              <div
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  letterSpacing: '0.20em',
                  textTransform: 'uppercase',
                  color: 'rgba(20,19,15,0.5)',
                  marginBottom: 6,
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  fontFamily: "'DM Serif Display', serif",
                  fontSize: 22,
                  color: 'var(--ink)',
                  letterSpacing: '-0.01em',
                  lineHeight: 1,
                }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </FrostedCard>

        {/* ── Module grid ──────────────────────────────────────────────── */}
        <div
          role="list"
          aria-label="modules"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
          }}
        >
          {MODULES.map((mod) => (
            <ModuleTileCard
              key={mod.id}
              tile={mod}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>

      {/* ── BrainDumpInput ───────────────────────────────────────────── */}
      <BrainDumpInput onSubmit={onBrainDump} />
    </div>
  );
}

// ─── ModuleTileCard ───────────────────────────────────────────────────────────

interface ModuleTileCardProps {
  tile: ModuleTile;
  onNavigate: DashboardScreenProps['onNavigate'];
}

function ModuleTileCard({ tile, onNavigate }: ModuleTileCardProps) {
  const [pressed, setPressed] = React.useState(false);

  return (
    <div
      role="listitem"
      data-magic-tile={tile.id}
      style={{
        transition: 'transform 120ms ease, opacity 120ms ease',
        transform: pressed ? 'scale(0.97)' : 'scale(1)',
        opacity: pressed ? 0.85 : 1,
      }}
    >
      <FrostedCard
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
        }}
      >
        <button
          type="button"
          aria-label={`open ${tile.label}`}
          onClick={() => onNavigate('module', tile.id)}
          onMouseDown={() => setPressed(true)}
          onMouseUp={() => setPressed(false)}
          onMouseLeave={() => setPressed(false)}
          onTouchStart={() => setPressed(true)}
          onTouchEnd={() => setPressed(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          {/* Emoji */}
          <span
            aria-hidden="true"
            style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}
          >
            {tile.emoji}
          </span>

          {/* Labels */}
          <div>
            <div
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--ink)',
                lineHeight: 1.2,
              }}
            >
              {tile.label}
            </div>
            <div
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 9,
                letterSpacing: '0.12em',
                color: 'var(--ink-faint)',
                marginTop: 3,
                lineHeight: 1.2,
              }}
            >
              {tile.sub}
            </div>
          </div>
        </button>
      </FrostedCard>
    </div>
  );
}
