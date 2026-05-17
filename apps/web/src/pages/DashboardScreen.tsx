import React, { useMemo, useState } from 'react';
import { FrostedCard } from '../components/FrostedCard';
import { BrainDumpInput } from '../components/BrainDumpInput';
import { Burhan3D } from '../components/Burhan3D';
import { useStoreSlice } from '../store';
import { lastN, type BurhanState } from '@ollie/logic/burhan';

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

// ─── cluster definition ───────────────────────────────────────────────────────

interface SubModule {
  id: string;
  label: string;
}

interface Cluster {
  id: string;
  label: string;
  subModules: SubModule[];
  /** cluster-specific frosted tint — overrides FrostedCard default bg */
  tint: string;
  /** text color for cluster label (dark tint needs light text) */
  labelColor: string;
}

const CLUSTERS: Cluster[] = [
  {
    id: 'money',
    label: 'money',
    subModules: [{ id: 'finance', label: 'finance' }],
    tint: 'rgba(14, 12, 20, 0.85)',
    labelColor: 'rgba(245,244,240,0.9)',
  },
  {
    id: 'body',
    label: 'body',
    subModules: [
      { id: 'cycle',      label: 'cycle'      },
      { id: 'sleep',      label: 'sleep'      },
      { id: 'body',       label: 'body'       },
      { id: 'medication', label: 'medication' },
      { id: 'habits',     label: 'habits'     },
    ],
    tint: 'rgba(245, 244, 240, 0.85)',
    labelColor: 'rgba(17,17,17,0.85)',
  },
  {
    id: 'home',
    label: 'home',
    subModules: [
      { id: 'admin',   label: 'admin'   },
      { id: 'pets',    label: 'pets'    },
      { id: 'grocery', label: 'grocery' },
    ],
    tint: 'rgba(245, 240, 232, 0.85)',
    labelColor: 'rgba(17,17,17,0.85)',
  },
  {
    id: 'work',
    label: 'work',
    subModules: [
      { id: 'work',  label: 'work'  },
      { id: 'goals', label: 'goals' },
    ],
    tint: 'rgba(255, 255, 255, 0.6)',
    labelColor: 'rgba(17,17,17,0.85)',
  },
];

// ─── pending count per sub-module ────────────────────────────────────────────
// Each hook reads the canonical "things waiting" slice for its module.
// Rendered inside <ClusterTile> via usePendingCounts.

function usePendingCounts(): Record<string, number> {
  const [financeRecords] = useStoreSlice<unknown[]>('finance', 'records', []);
  const [cycleItems]     = useStoreSlice<unknown[]>('cycle', 'items', []);
  const [sleepRecords]   = useStoreSlice<unknown[]>('sleep', 'records', []);
  const [bodyEpisodes]   = useStoreSlice<unknown[]>('body', 'episodes', []);
  const [habits]         = useStoreSlice<unknown[]>('shared', 'habits_v2', []);
  const [adminTasks]     = useStoreSlice<unknown[]>('admin', 'tasks', []);
  const [pets]           = useStoreSlice<unknown[]>('pets', 'pets', []);
  const [groceryItems]   = useStoreSlice<unknown[]>('grocery', 'items', []);
  const [workTasks]      = useStoreSlice<unknown[]>('work', 'tasks', []);
  const [goals]          = useStoreSlice<unknown[]>('goals', 'items', []);

  return useMemo(
    () => ({
      finance: (financeRecords ?? []).length,
      cycle:   (cycleItems     ?? []).length,
      sleep:   (sleepRecords   ?? []).length,
      body:    (bodyEpisodes   ?? []).length,
      habits:  (habits         ?? []).length,
      admin:   (adminTasks     ?? []).length,
      pets:    (pets           ?? []).length,
      grocery: (groceryItems   ?? []).length,
      work:    (workTasks      ?? []).length,
      goals:   (goals          ?? []).length,
    }),
    [
      financeRecords, cycleItems, sleepRecords, bodyEpisodes, habits,
      adminTasks, pets, groceryItems, workTasks, goals,
    ],
  );
}

// ─── component ───────────────────────────────────────────────────────────────

export function DashboardScreen({ onNavigate, onBrainDump, stats }: DashboardScreenProps) {
  const now = new Date();
  const dateStr = now
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toLowerCase();

  const [hasPets] = useStoreSlice<boolean>('shared', 'settings.has_pets', true);
  // Consent rewrite (Sprint 6): cycle sub-tile visibility now follows
  // the onboarding cycle-tracking preference instead of the removed
  // consent.cycle flag. "yes" surfaces it; any other answer hides it.
  const [cycleTracking] = useStoreSlice<string | null>('shared', 'settings.cycle_tracking', null);
  const cycleConsent = cycleTracking === 'yes';
  const [burhanState] = useStoreSlice<BurhanState>('burhan', 'state', { events: [] });
  const recentBurhanEvents = useMemo(() => lastN(burhanState, 12), [burhanState]);
  const pendingCounts = usePendingCounts();

  // Credibility audit NH2: stats bar was previously always 0 / 0 / 0m
  // because no caller passed the `stats` prop. Derive from store.
  const [upcomingBills] = useStoreSlice<Array<{ daysUntil?: number }>>('finance', 'upcoming', []);
  const [adminTasksForStats] = useStoreSlice<Array<{ due?: number; state?: string }>>('admin', 'tasks', []);
  const [focusLog] = useStoreSlice<Array<{ at?: number; duration_min?: number }>>('work', 'focus_log', []);
  const dueToday = stats?.dueToday ?? (() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = todayStart.getTime() + 86_400_000;
    return (adminTasksForStats ?? []).filter((t) => t?.state !== 'done' && t?.state !== 'closed' && typeof t.due === 'number' && t.due >= todayStart.getTime() && t.due < todayEnd).length;
  })();
  const billsSoon = stats?.billsSoon ?? (upcomingBills ?? []).filter((b) => (b?.daysUntil ?? 999) <= 7).length;
  const tracked = stats?.tracked ?? (() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const mins = (focusLog ?? [])
      .filter((s) => typeof s.at === 'number' && s.at >= todayStart.getTime())
      .reduce((acc, s) => acc + (s.duration_min ?? 0), 0);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  })();

  // Filter pets out of home cluster if has_pets is false.
  // Filter cycle out of body cluster if user did not opt into cycle
  // tracking during onboarding (Sprint 6 consent rewrite).
  const clusters = useMemo<Cluster[]>(
    () =>
      CLUSTERS.map((c) => {
        if (c.id === 'home' && !hasPets) {
          return { ...c, subModules: c.subModules.filter((s) => s.id !== 'pets') };
        }
        if (c.id === 'body' && !cycleConsent) {
          return { ...c, subModules: c.subModules.filter((s) => s.id !== 'cycle') };
        }
        return c;
      }),
    [hasPets, cycleConsent],
  );

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
      {/* Sky gradient — sits behind everything */}
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

      {/* Dark gradient overlay */}
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

      {/* Scrollable content — top/bottom padding includes the iPhone
          safe areas so the header clears the notch and the cluster grid
          clears the home indicator. */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          maxWidth: 1200,
          margin: '0 auto',
          padding:
            'calc(40px + env(safe-area-inset-top)) 24px calc(160px + env(safe-area-inset-bottom))',
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
            <Burhan3D height={66} width={66} lifeEvents={recentBurhanEvents} />
          </button>
        </header>

        {/* ── Stats bar ────────────────────────────────────────────────── */}
        {/* 3 columns is too tight on a ~390px iPhone — the "tracked" value
            ("1h 30m") crowds its 9px label. Below 480px the grid collapses
            to 2-up: the third stat ("tracked") spans the full width on its
            own row. Desktop keeps the 3-column row untouched. */}
        <style>{`
          @media (max-width: 480px) {
            .ollie-stats-bar { grid-template-columns: 1fr 1fr !important; }
            .ollie-stats-bar > .ollie-stat-cell:nth-child(2) { border-right: none !important; }
            .ollie-stats-bar > .ollie-stat-cell:nth-child(3) {
              grid-column: 1 / -1;
              border-right: none !important;
              border-top: 1px solid rgba(255,255,255,0.25);
            }
          }
        `}</style>
        <FrostedCard
          className="ollie-stats-bar"
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
              className="ollie-stat-cell"
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

        {/* ── Brain dump — inline, above cluster grid ───────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <InlineBrainDump onSubmit={onBrainDump} />
        </div>

        {/* ── 4-cluster grid ───────────────────────────────────────────── */}
        <div
          role="list"
          aria-label="clusters"
          className="cluster-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 16,
          }}
        >
          {clusters.map((cluster) => (
            <ClusterTile
              key={cluster.id}
              cluster={cluster}
              pendingCounts={pendingCounts}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── InlineBrainDump ──────────────────────────────────────────────────────────
// Top-anchored variant — not fixed-bottom, sits in document flow.

interface InlineBrainDumpProps {
  onSubmit: (text: string) => void;
}

function InlineBrainDump({ onSubmit }: InlineBrainDumpProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleSubmit() {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    setValue('');
    try {
      await onSubmit(text);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div role="search" aria-label="brain dump">
      <FrostedCard
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '6px 8px 6px 20px',
          borderRadius: '16px',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          data-brain-dump="true"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { void handleSubmit(); } }}
          placeholder="what's on your mind..."
          disabled={busy}
          aria-label="type a note and press enter"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontFamily: "'DM Sans', sans-serif",
            fontStyle: 'italic',
            fontSize: 'var(--t-body)',
            color: 'var(--ink)',
            lineHeight: 'var(--lh-body)',
          }}
        />
        <button
          type="button"
          onClick={() => { void handleSubmit(); }}
          disabled={busy || !value.trim()}
          aria-label="submit"
          style={{
            flexShrink: 0,
            background: 'transparent',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-pill)',
            padding: '6px 14px',
            fontFamily: "'DM Mono', monospace",
            fontSize: 'var(--t-meta)',
            letterSpacing: 'var(--ls-caps-small)',
            textTransform: 'uppercase',
            color: value.trim() ? 'var(--ink-soft)' : 'var(--ink-ghost)',
            cursor: value.trim() ? 'pointer' : 'default',
            transition: 'color var(--d-tap) var(--e-calm-out)',
          }}
        >
          {busy ? '...' : 'enter'}
        </button>
      </FrostedCard>
    </div>
  );
}

// ─── ClusterTile ──────────────────────────────────────────────────────────────

interface ClusterTileProps {
  cluster: Cluster;
  pendingCounts: Record<string, number>;
  onNavigate: DashboardScreenProps['onNavigate'];
}

function ClusterTile({ cluster, pendingCounts, onNavigate }: ClusterTileProps) {
  const [expanded, setExpanded] = useState(false);

  // Total pending across all sub-modules in this cluster
  const totalPending = useMemo(
    () => cluster.subModules.reduce((acc, s) => acc + (pendingCounts[s.id] ?? 0), 0),
    [cluster.subModules, pendingCounts],
  );

  const pendingLabel = totalPending > 0 ? `${totalPending} items` : '—';

  return (
    <div
      role="listitem"
      style={{
        transition: 'transform 120ms ease',
      }}
    >
      {/* Use background override to apply per-cluster tint */}
      <div
        style={{
          background: cluster.tint,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.25)',
          borderRadius: '20px',
          boxShadow: 'var(--sh-md)',
          overflow: 'hidden',
        }}
      >
        {/* Collapsed header — always visible */}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`cluster-${cluster.id}-subs`}
          onClick={() => setExpanded((prev) => !prev)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            boxSizing: 'border-box',
            background: 'transparent',
            border: 'none',
            padding: '24px 24px 20px',
            cursor: 'pointer',
            textAlign: 'left',
            gap: 6,
          }}
        >
          <span
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: 24,
              fontWeight: 400,
              color: cluster.labelColor,
              letterSpacing: '-0.01em',
              lineHeight: 1,
            }}
          >
            {cluster.label}
          </span>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            {/* Sub-module names */}
            <span
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 12,
                color:
                  cluster.id === 'money'
                    ? 'rgba(245,244,240,0.5)'
                    : 'rgba(17,17,17,0.45)',
                lineHeight: 1.4,
              }}
            >
              {cluster.subModules.map((s) => s.label).join(' · ')}
            </span>

            {/* Pending badge */}
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 9,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color:
                  cluster.id === 'money'
                    ? 'rgba(245,244,240,0.45)'
                    : 'rgba(17,17,17,0.4)',
                flexShrink: 0,
                marginLeft: 12,
              }}
            >
              {pendingLabel}
            </span>
          </div>
        </button>

        {/* Expanded sub-module buttons */}
        <div
          id={`cluster-${cluster.id}-subs`}
          role="group"
          aria-label={`${cluster.label} sub-modules`}
          style={{
            maxHeight: expanded ? `${cluster.subModules.length * 56 + 16}px` : '0px',
            overflow: 'hidden',
            transition: 'max-height 250ms cubic-bezier(0.4,0,0.2,1)',
          }}
        >
          <div
            style={{
              borderTop: '1px solid rgba(255,255,255,0.18)',
              padding: '8px 0 12px',
            }}
          >
            {cluster.subModules.map((sub) => {
              const count = pendingCounts[sub.id] ?? 0;
              return (
                <button
                  key={sub.id}
                  type="button"
                  aria-label={`open ${sub.label}`}
                  onClick={() => onNavigate('module', sub.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    boxSizing: 'border-box',
                    background: 'transparent',
                    border: 'none',
                    padding: '12px 24px',
                    cursor: 'pointer',
                    minHeight: 44,
                    textAlign: 'left',
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 11,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color:
                        cluster.id === 'money'
                          ? 'rgba(245,244,240,0.75)'
                          : 'rgba(17,17,17,0.7)',
                    }}
                  >
                    {sub.label}
                  </span>
                  {count > 0 && (
                    <span
                      style={{
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 9,
                        letterSpacing: '0.12em',
                        color:
                          cluster.id === 'money'
                            ? 'rgba(245,244,240,0.4)'
                            : 'rgba(17,17,17,0.35)',
                      }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
