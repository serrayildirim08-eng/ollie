/**
 * v2-shell · DesktopShell — the wide-viewport navigation host ("thin spine")
 *
 * The SAME React/TS web app (`apps/web`) is loaded by both an iPhone
 * Capacitor shell and an Electron desktop shell. `ShellApp` renders the
 * phone single-column layout — a 4-panel horizontal swipe deck + a push
 * stack + Find/Safe corner overlays. In a wide desktop window that reads
 * as a tiny phone column floating in dead space.
 *
 * `DesktopShell` is the wide-viewport ALTERNATIVE, picked by `router.tsx`'s
 * `ShellHostRoute` at `window.innerWidth >= 900`. It has the exact same
 * props interface as `ShellApp` (`ShellAppProps`), so the two are
 * interchangeable behind one width switch.
 *
 * THE MODEL — "the thin spine" (design/desktop-2026-05-19/DIRECTION.md):
 *
 *   - a whisper-thin left SPINE — fluid `clamp(60px,4.6vw,92px)` — holding
 *     only a small `o` mark + 5 minimal glyphs (throw · modules · noticed ·
 *     find · safe). NO text labels; the active glyph is amber.
 *   - a single-focus centered CANVAS on warm `paper`, generous empty
 *     margins. One focus at a time, selected from the spine.
 *   - `⌘K` opens the Find command palette.
 *
 * It REUSES, never rebuilds: the capture wiring (`handleThrow`,
 * `classifyThrow`), the 12 real `*-v2` module apps (the exact `switch`
 * mounting block from `ShellApp`), `NoticedScreen`, and `FindScreen`.
 *
 * Desktop has NO push stack, NO edge-swipe, NO corner dots — the spine IS
 * the navigation; selecting a spine glyph swaps the canvas.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { v2 } from '../money-v2/v2';
import type { ModuleKey, SubmoduleKey } from './types';
import { classifyThrow, type CaughtThought } from './capture-routing';
import { NoticedScreen, type NoticedPattern } from './screens/NoticedScreen';
import { FindScreen } from './screens/FindScreen';
import type { ShellAppProps } from './ShellApp';

// the 12 real `*-v2` module apps — composed, never rebuilt
import { MoneyApp } from '../money-v2';
import { CycleApp } from '../cycle-v2/CycleApp';
import { SleepApp } from '../sleep-v2/SleepApp';
import { BodyApp } from '../body-v2/BodyApp';
import { MedicationApp } from '../medication-v2/MedicationApp';
import { HabitsApp } from '../habits-v2/HabitsApp';
import { AdminApp } from '../admin-v2/AdminApp';
import { PetsApp } from '../pets-v2/PetsApp';
import { GroceryApp } from '../grocery-v2/GroceryApp';
import { WorkApp } from '../work-v2/WorkApp';
import { GoalsApp } from '../goals-v2/GoalsApp';
import { PartnerApp } from '../partner-v2/PartnerApp';

const box = { boxSizing: 'border-box' as const };

/** the four spine destinations (safe is an action, not a canvas state) */
type SpineDest = 'throw' | 'modules' | 'noticed' | 'find';

/**
 * what the canvas is currently showing. `modules` is the airy grid; an
 * open module shows the real `*-v2` app. `find` is an overlay, not a
 * canvas state — it is tracked separately.
 */
type CanvasState =
  | { kind: 'throw' }
  | { kind: 'modules' }
  | { kind: 'module'; submodule: SubmoduleKey }
  | { kind: 'noticed' };

// ─── the modules grid, grouped by room (02-modules.html) ──────────────────────

interface ModuleEntry {
  key: SubmoduleKey;
  name: string;
  hint: string;
}
interface RoomGroup {
  room: string;
  modules: ModuleEntry[];
}

/**
 * The twelve modules in their rooms, verbatim from `02-modules.html`. The
 * hint copy is the mockup's static sample — module faces own their own
 * live data; this grid is just the calm chooser.
 */
const ROOMS: RoomGroup[] = [
  {
    room: 'body',
    modules: [
      { key: 'cycle', name: 'cycle', hint: '5 days to your period' },
      { key: 'sleep', name: 'sleep', hint: 'a little behind this week' },
      { key: 'body', name: 'body', hint: 'nothing logged today' },
      { key: 'medication', name: 'medication', hint: 'evening dose at 9' },
      { key: 'habits', name: 'habits', hint: 'two gentle routines' },
    ],
  },
  {
    room: 'home',
    modules: [
      { key: 'admin', name: 'admin', hint: 'passport renewal waiting' },
      { key: 'pets', name: 'pets', hint: "mira's chews running low" },
      { key: 'grocery', name: 'grocery', hint: 'oat milk, coffee' },
    ],
  },
  {
    room: 'work',
    modules: [
      { key: 'work', name: 'work', hint: 'three matters open' },
      { key: 'goals', name: 'goals', hint: 'q3 pitch, no rush' },
      { key: 'partner', name: 'partner', hint: 'nothing shared lately' },
    ],
  },
  {
    room: 'money',
    modules: [{ key: 'money', name: 'money', hint: '$1,840 spent this month' }],
  },
];

// ─── the spine glyphs — copied from 01-throw-home.html ────────────────────────

/** the five spine glyphs as SVG path content, keyed by destination + safe */
function glyphSvg(dest: SpineDest | 'safe', active: boolean): JSX.Element {
  const stroke = active ? v2.accent : v2.mute;
  const fill = active ? v2.accent : v2.mute;
  switch (dest) {
    case 'throw':
      // a filled circle
      return (
        <svg width={18} height={18} viewBox="0 0 18 18" fill="none" aria-hidden>
          {active ? (
            <circle cx="9" cy="9" r="5" fill={fill} />
          ) : (
            <circle cx="9" cy="9" r="5" stroke={stroke} strokeWidth={1.5} />
          )}
        </svg>
      );
    case 'modules':
      // four dots
      return (
        <svg width={18} height={18} viewBox="0 0 18 18" fill="none" aria-hidden>
          {active ? (
            <>
              <circle cx="5" cy="5" r="2.4" fill={fill} />
              <circle cx="13" cy="5" r="2.4" fill={fill} />
              <circle cx="5" cy="13" r="2.4" fill={fill} />
              <circle cx="13" cy="13" r="2.4" fill={fill} />
            </>
          ) : (
            <g stroke={stroke} strokeWidth={1.5}>
              <circle cx="5" cy="5" r="2.4" />
              <circle cx="13" cy="5" r="2.4" />
              <circle cx="5" cy="13" r="2.4" />
              <circle cx="13" cy="13" r="2.4" />
            </g>
          )}
        </svg>
      );
    case 'noticed':
      // a wave path
      return (
        <svg width={18} height={18} viewBox="0 0 18 18" fill="none" aria-hidden>
          <path
            d="M2 12c2.5-6 4.5-6 7-3s4.5 3 7-3"
            stroke={stroke}
            strokeWidth={active ? 1.8 : 1.5}
            strokeLinecap="round"
          />
        </svg>
      );
    case 'find':
      // a magnifier
      return (
        <svg width={18} height={18} viewBox="0 0 18 18" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="5" stroke={stroke} strokeWidth={active ? 1.8 : 1.5} />
          <path d="M15 15l-3.5-3.5" stroke={stroke} strokeWidth={active ? 1.8 : 1.5} strokeLinecap="round" />
        </svg>
      );
    case 'safe':
    default:
      // a shield
      return (
        <svg width={18} height={18} viewBox="0 0 18 18" fill="none" aria-hidden>
          <path d="M9 2l5 2v5c0 4-5 7-5 7s-5-3-5-7V4z" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
      );
  }
}

/**
 * the patterns shown on Noticed. Returns [] today — wiring the full
 * cross-module detector pipeline is a documented follow-up (mirrors
 * ShellApp's `useNoticedPatterns`). Noticed shows the calm empty state.
 */
function useNoticedPatterns(): NoticedPattern[] {
  return useMemo<NoticedPattern[]>(() => [], []);
}

export function DesktopShell({ onThrow, onSafe, onSettings, now, initialDeck = 'throw' }: ShellAppProps) {
  const clock = now ?? Date.now();

  // ── the canvas — one focus at a time ─────────────────────────────────────
  const [canvas, setCanvas] = useState<CanvasState>(() => {
    // `initialDeck` lets tests deep-link the first canvas state. `caught`
    // has no desktop equivalent (no standing panel) — it folds into throw.
    if (initialDeck === 'modules') return { kind: 'modules' };
    if (initialDeck === 'noticed') return { kind: 'noticed' };
    return { kind: 'throw' };
  });

  // ── the Find command palette — a ⌘K overlay over the canvas ──────────────
  const [findOpen, setFindOpen] = useState(false);

  // ── caught thoughts this session — Find searches this corpus ─────────────
  const [caught, setCaught] = useState<CaughtThought[]>([]);

  // ── the throw field ──────────────────────────────────────────────────────
  const [draft, setDraft] = useState('');

  const patterns = useNoticedPatterns();

  // ── capture wiring — reused from ShellApp's handleThrow ──────────────────
  const handleThrow = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      // the REAL brain-dump write
      onThrow?.(t);
      // a read-only classify so the caught corpus names the drawer it hit
      setCaught((c) => [classifyThrow(t, clock), ...c]);
    },
    [onThrow, clock],
  );

  const submitDraft = useCallback(() => {
    const t = draft.trim();
    if (!t) return;
    handleThrow(t);
    setDraft('');
  }, [draft, handleThrow]);

  // ── overlay wiring ────────────────────────────────────────────────────────
  const closeFind = useCallback(() => setFindOpen(false), []);

  const openSafe = useCallback(() => {
    onSafe?.();
  }, [onSafe]);

  // a submodule jump from Find closes the palette first
  const jumpToSubmodule = useCallback((submodule: SubmoduleKey) => {
    setFindOpen(false);
    setCanvas({ kind: 'module', submodule });
  }, []);

  // ── ⌘K opens Find, Esc closes it ──────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setFindOpen((open) => !open);
        return;
      }
      if (e.key === 'Escape') setFindOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── spine selection ───────────────────────────────────────────────────────
  const selectDest = useCallback(
    (dest: SpineDest) => {
      if (dest === 'find') {
        setFindOpen(true);
        return;
      }
      setFindOpen(false);
      if (dest === 'throw') setCanvas({ kind: 'throw' });
      else if (dest === 'modules') setCanvas({ kind: 'modules' });
      else setCanvas({ kind: 'noticed' });
    },
    [],
  );

  // which spine glyph reads as active
  const activeDest: SpineDest | null = findOpen
    ? 'find'
    : canvas.kind === 'throw'
      ? 'throw'
      : canvas.kind === 'noticed'
        ? 'noticed'
        : 'modules'; // both `modules` grid and an open module live under it

  // ── the real `*-v2` module app — the exact switch from ShellApp ──────────
  function renderModule(sub: SubmoduleKey): JSX.Element {
    const onExit = () => setCanvas({ kind: 'modules' });
    const common = { now: clock, onExit, onSafe: openSafe };
    switch (sub) {
      case 'money':
        return <MoneyApp {...common} />;
      case 'cycle':
        return <CycleApp {...common} />;
      case 'sleep':
        return <SleepApp {...common} />;
      case 'body':
        return <BodyApp {...common} />;
      case 'medication':
        return <MedicationApp {...common} />;
      case 'habits':
        return <HabitsApp {...common} />;
      case 'admin':
        return <AdminApp {...common} />;
      case 'pets':
        return <PetsApp {...common} />;
      case 'grocery':
        return <GroceryApp {...common} />;
      case 'work':
        return <WorkApp {...common} />;
      case 'goals':
        return <GoalsApp {...common} />;
      case 'partner':
      default:
        return <PartnerApp {...common} />;
    }
  }

  // ── the canvas body ───────────────────────────────────────────────────────
  function renderCanvas(): JSX.Element {
    if (canvas.kind === 'throw') return <ThrowCanvas value={draft} onChange={setDraft} onSubmit={submitDraft} />;
    if (canvas.kind === 'modules') {
      return (
        <ModulesGrid
          onOpen={(key: SubmoduleKey) => setCanvas({ kind: 'module', submodule: key })}
          onSettings={onSettings}
        />
      );
    }
    if (canvas.kind === 'noticed') {
      // NoticedScreen centres itself; give it the full canvas
      return (
        <div style={{ ...box, width: '100%', height: '100%' }}>
          <NoticedScreen patterns={patterns} />
        </div>
      );
    }
    // an open module — the real `*-v2` app. The now desktop-aware `<Screen>`
    // primitive every module page mounts inside manages its own editorial
    // measure + warm margins, so the canvas just gives it the full width
    // and a scroll container; it no longer clamps to a ~460px phone column.
    return (
      <div
        data-testid="desktop-module"
        style={{
          ...box,
          width: '100%',
          height: '100%',
          position: 'relative',
          background: v2.paper,
          overflowY: 'auto',
        }}
      >
        {renderModule(canvas.submodule)}
      </div>
    );
  }

  return (
    <div
      data-testid="v2-desktop-shell"
      style={{
        ...box,
        display: 'flex',
        width: '100%',
        height: '100dvh',
        minHeight: '100dvh',
        background: v2.paper,
        fontFamily: v2.sans,
        color: v2.ink,
        overflow: 'hidden',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* ─── THE THIN SPINE ─── */}
      <aside
        data-testid="desktop-spine"
        style={{
          ...box,
          width: 'clamp(60px, 4.6vw, 92px)',
          height: '100%',
          background: v2.tile,
          borderRight: `1px solid ${v2.line}`,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: 'clamp(26px,2.2vw,40px) 0 clamp(22px,1.8vw,34px)',
          // the spine stays above the Find scrim
          position: 'relative',
          zIndex: 300,
        }}
      >
        {/* the wordmark */}
        <div style={{ fontSize: 'clamp(20px,1.7vw,30px)', fontWeight: 400, color: v2.ink, lineHeight: 1 }}>o</div>

        {/* the four canvas glyphs */}
        <nav
          aria-label="navigation"
          style={{
            ...box,
            marginTop: 'clamp(74px,6vw,108px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'clamp(34px,2.8vw,50px)',
          }}
        >
          {(['throw', 'modules', 'noticed', 'find'] as SpineDest[]).map((dest) => (
            <SpineGlyph
              key={dest}
              dest={dest}
              active={activeDest === dest}
              onClick={() => selectDest(dest)}
            />
          ))}
        </nav>

        {/* the foot — safe + the ⌘K hint */}
        <div
          style={{
            ...box,
            marginTop: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'clamp(18px,1.5vw,28px)',
          }}
        >
          <SpineGlyph dest="safe" active={false} onClick={openSafe} />
          <div
            style={{
              fontFamily: v2.mono,
              fontSize: 'clamp(9px,0.75vw,13px)',
              color: v2.mute,
              letterSpacing: '.04em',
            }}
          >
            ⌘K
          </div>
        </div>
      </aside>

      {/* ─── THE CANVAS ─── */}
      {/*
        An open module is a full desktop page — its `<Screen>` primitive
        owns its own editorial measure + warm margins, so the canvas drops
        its own generous padding and lets the module fill edge-to-edge.
        The throw / modules / noticed canvases stay centred with padding.
      */}
      <main
        style={{
          ...box,
          flex: 1,
          height: '100%',
          background: v2.paper,
          display: 'flex',
          alignItems: canvas.kind === 'module' ? 'stretch' : 'center',
          justifyContent: 'center',
          padding: canvas.kind === 'module' ? 0 : 'clamp(40px,5vw,110px)',
          // dim + blur behind the Find palette
          filter: findOpen ? 'blur(2px)' : 'none',
        }}
        aria-hidden={findOpen}
      >
        {renderCanvas()}
      </main>

      {/* ─── ⌘K FIND COMMAND PALETTE ─── */}
      {findOpen && (
        <div
          data-testid="desktop-find-scrim"
          onMouseDown={(e) => {
            // a click on the scrim itself (not the palette) closes Find
            if (e.target === e.currentTarget) closeFind();
          }}
          style={{
            ...box,
            position: 'absolute',
            top: 0,
            left: 'clamp(60px, 4.6vw, 92px)',
            right: 0,
            bottom: 0,
            background: 'rgba(42,38,34,.26)',
            zIndex: 200,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: 'clamp(120px,11vw,220px)',
          }}
        >
          <div
            style={{
              ...box,
              width: 'clamp(560px, 42vw, 760px)',
              maxWidth: 'calc(100% - 48px)',
              maxHeight: '70vh',
              background: v2.card,
              borderRadius: 12,
              boxShadow: '0 16px 38px rgba(42,38,34,.10)',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {/* FindScreen renders absolute inset:0 — give it a sized box */}
            <div style={{ ...box, position: 'relative', height: 'min(70vh, 540px)' }}>
              <FindScreen onClose={closeFind} caught={caught} onOpenSubmodule={jumpToSubmodule} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── the spine glyph button ───────────────────────────────────────────────────

function SpineGlyph({
  dest,
  active,
  onClick,
}: {
  dest: SpineDest | 'safe';
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={dest === 'find' ? 'find  ⌘K' : dest}
      aria-label={dest}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      style={{
        ...box,
        width: 'clamp(24px,2vw,34px)',
        height: 'clamp(24px,2vw,34px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {glyphSvg(dest, active)}
    </button>
  );
}

// ─── the throw canvas (01-throw-home.html) ────────────────────────────────────

function ThrowCanvas({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div
      style={{
        ...box,
        width: 'clamp(600px, 46vw, 900px)',
        maxWidth: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <h1
        style={{
          fontSize: 'clamp(34px,3.2vw,60px)',
          fontWeight: 300,
          letterSpacing: '-.02em',
          color: v2.ink,
          marginBottom: 'clamp(40px,3.4vw,64px)',
        }}
      >
        what&apos;s in your head?
      </h1>

      <form
        style={{ ...box, width: '100%' }}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <label htmlFor="desktop-throw-field" style={{ ...box, width: '100%' }}>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            throw a thought
          </span>
          <textarea
            id="desktop-throw-field"
            data-testid="desktop-throw-field"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="dentist called back, need to reschedule for after the 14th"
            rows={4}
            onKeyDown={(e) => {
              // Enter (no shift) commits — a thought is one line, usually
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            style={{
              ...box,
              width: '100%',
              minHeight: 'clamp(152px,14vw,232px)',
              resize: 'none',
              background: v2.card,
              border: `1px solid ${v2.line}`,
              borderRadius: 0,
              padding: 'clamp(30px,2.4vw,44px) clamp(32px,2.6vw,48px)',
              fontFamily: v2.sans,
              fontSize: 'clamp(18px,1.35vw,26px)',
              lineHeight: 1.6,
              fontWeight: 300,
              letterSpacing: '-.005em',
              color: v2.ink,
              outline: 'none',
            }}
          />
        </label>
      </form>

      <div
        style={{
          fontFamily: v2.mono,
          fontSize: 'clamp(11px,0.9vw,15px)',
          color: v2.mute,
          letterSpacing: '.04em',
          marginTop: 'clamp(18px,1.5vw,28px)',
        }}
      >
        press ↵ to throw
      </div>
    </div>
  );
}

// ─── the modules grid (02-modules.html) ───────────────────────────────────────

function ModulesGrid({
  onOpen,
  onSettings,
}: {
  onOpen: (key: SubmoduleKey) => void;
  onSettings?: () => void;
}) {
  return (
    <div
      data-testid="desktop-modules-grid"
      style={{
        ...box,
        width: 'clamp(640px, 48vw, 940px)',
        maxWidth: '100%',
        maxHeight: '100%',
        overflowY: 'auto',
      }}
    >
      {ROOMS.map((group) => (
        <section key={group.room} style={{ ...box, marginBottom: 'clamp(46px,3.8vw,72px)' }}>
          <div
            style={{
              fontFamily: v2.mono,
              fontSize: 'clamp(10px,0.85vw,14px)',
              letterSpacing: '.22em',
              textTransform: 'uppercase',
              color: v2.mute,
              marginBottom: 'clamp(20px,1.7vw,32px)',
            }}
          >
            {group.room}
          </div>
          <div
            style={{
              ...box,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              columnGap: 'clamp(40px,3.2vw,64px)',
              rowGap: 'clamp(26px,2.2vw,42px)',
            }}
          >
            {group.modules.map((mod) => (
              <button
                key={mod.key}
                type="button"
                aria-label={mod.name}
                onClick={() => onOpen(mod.key)}
                style={{
                  ...box,
                  display: 'block',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <div
                  style={{
                    fontSize: 'clamp(17px,1.3vw,25px)',
                    fontWeight: 400,
                    letterSpacing: '-.01em',
                    color: v2.ink,
                  }}
                >
                  {mod.name}
                </div>
                <div
                  style={{
                    fontSize: 'clamp(12.5px,1vw,18px)',
                    fontWeight: 300,
                    color: v2.mute,
                    marginTop: 'clamp(3px,0.3vw,6px)',
                  }}
                >
                  {mod.hint}
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}

      {/* a quiet settings link — the one route to the hand-built settings */}
      {onSettings && (
        <button
          type="button"
          aria-label="settings"
          onClick={onSettings}
          style={{
            ...box,
            background: 'transparent',
            border: 'none',
            padding: '4px 0',
            cursor: 'pointer',
            fontSize: 'clamp(12.5px,1vw,16px)',
            fontWeight: 400,
            color: v2.mute,
            letterSpacing: '.03em',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          settings
        </button>
      )}
    </div>
  );
}

// re-export for symmetry with ShellApp's barrel surface
export type { ModuleKey };
