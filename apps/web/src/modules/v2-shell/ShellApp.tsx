/**
 * v2-shell · ShellApp — the clean-slate v2 navigation host
 *
 * This is the SHELL that ties the 12 already-built `*-v2` module apps into
 * one navigable app (DIRECTION.md). It owns three things:
 *
 *   1. the CAPTURE DECK — Throw · Caught · Noticed · the 4-modules view,
 *      four horizontally-swipeable panels (a 4-dot deck).
 *   2. the PUSH STACK — a module homepage and a mounted submodule app push
 *      on top of the deck; back pops one frame.
 *   3. the ALWAYS-ON overlays — Find (top-left) and Safe (top-right),
 *      reachable from every screen.
 *
 * It does NOT rebuild the modules: a submodule frame mounts the real
 * `MoneyApp` / `CycleApp` / … unchanged. Each module app's `onExit` is
 * wired to pop the shell stack, and its `onSafe` opens the shell's Safe
 * overlay — so the modules behave as pages inside the shell.
 *
 * The whole assembled app mounts at `/preview/v2`. The 12 individual
 * `/preview/{module}` routes are untouched and keep working.
 */
import { useCallback, useMemo, useState } from 'react';
import { v2 } from '../money-v2/v2';
import type { DeckScreen, ModuleKey, ShellFrame, SubmoduleKey, ShellOverlay } from './types';
import { classifyThrow, type CaughtThought } from './capture-routing';
import { CornerDots, DeckDots } from './chrome';
import { SwipeDeck } from './SwipeDeck';
import { PushSurface } from './PushSurface';
import { ThrowScreen } from './screens/ThrowScreen';
import { ListeningScreen } from './screens/ListeningScreen';
import { CaughtScreen } from './screens/CaughtScreen';
import { NoticedScreen, type NoticedPattern } from './screens/NoticedScreen';
import { ModulesScreen } from './screens/ModulesScreen';
import { BodyHome } from './screens/BodyHome';
import { HomeHome } from './screens/HomeHome';
import { WorkHome } from './screens/WorkHome';
import { FindScreen } from './screens/FindScreen';

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

const DECK_ORDER: DeckScreen[] = ['throw', 'caught', 'noticed', 'modules'];

export interface ShellAppProps {
  /**
   * route a thrown thought through the real brain-dump pipeline. The shell
   * is the app root inside <RouterProvider>'s gated tree, so the host
   * route passes `applyDump`.
   */
  onThrow?: (text: string) => void;
  /** open the app's crisis surface — the Safe dot. */
  onSafe?: () => void;
  /**
   * open the settings screen — reached from a quiet link on the modules
   * panel. Optional: a bare host (e.g. the `/preview/v2` page) omits it
   * and the link simply does not render.
   */
  onSettings?: () => void;
  /** injected for deterministic tests; defaults to wall-clock. */
  now?: number;
  /** the deck panel to open on first mount (tests deep-link). */
  initialDeck?: DeckScreen;
}

/**
 * the patterns shown on Noticed. Returns [] today — wiring the full
 * cross-module detector pipeline (@ollie/logic/patterns needs cycle
 * records + sleep sessions + dump entries assembled) is a documented
 * follow-up. Noticed renders the calm empty state until then.
 */
function useNoticedPatterns(): NoticedPattern[] {
  return useMemo<NoticedPattern[]>(() => [], []);
}

export function ShellApp({ onThrow, onSafe, onSettings, now, initialDeck = 'throw' }: ShellAppProps) {
  const clock = now ?? Date.now();

  // ── the capture deck ──────────────────────────────────────────────────
  const [deckIndex, setDeckIndex] = useState(() => {
    const i = DECK_ORDER.indexOf(initialDeck);
    return i < 0 ? 0 : i;
  });
  const deckScreen = DECK_ORDER[deckIndex];

  // ── the push stack — the deck is always the floor ────────────────────
  const [stack, setStack] = useState<ShellFrame[]>([{ kind: 'deck' }]);

  // ── always-on overlays ────────────────────────────────────────────────
  const [overlay, setOverlay] = useState<ShellOverlay>('none');

  // ── the voice-capture screen (a transient overlay over Throw) ────────
  const [listening, setListening] = useState(false);

  // ── caught thoughts this session — Caught + Find search this corpus ──
  const [caught, setCaught] = useState<CaughtThought[]>([]);

  const patterns = useNoticedPatterns();

  // ── stack ops ─────────────────────────────────────────────────────────
  const pushModule = useCallback((module: ModuleKey) => {
    // money is special — one submodule, so its room opens the money app
    // directly (DIRECTION.md: "money page IS a single rich finance card").
    if (module === 'money') {
      setStack((s) => [...s, { kind: 'submodule', submodule: 'money' }]);
      return;
    }
    setStack((s) => [...s, { kind: 'module', module }]);
  }, []);

  const pushSubmodule = useCallback((submodule: SubmoduleKey) => {
    setStack((s) => [...s, { kind: 'submodule', submodule }]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => (s.length <= 1 ? s : s.slice(0, -1)));
  }, []);

  // ── capture wiring ────────────────────────────────────────────────────
  const handleThrow = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      // the REAL brain-dump write
      onThrow?.(t);
      // a read-only classify so Caught can name the drawer it landed in
      setCaught((c) => [classifyThrow(t, clock), ...c]);
      // slide to Caught — "the thought landed"
      setDeckIndex(DECK_ORDER.indexOf('caught'));
    },
    [onThrow, clock],
  );

  const openListening = useCallback(() => setListening(true), []);
  const onVoiceCaptured = useCallback(
    (text: string) => {
      setListening(false);
      handleThrow(text);
    },
    [handleThrow],
  );
  const onVoiceCancel = useCallback(() => setListening(false), []);

  // ── overlay wiring ────────────────────────────────────────────────────
  const openFind = useCallback(() => setOverlay('find'), []);
  const closeOverlay = useCallback(() => setOverlay('none'), []);
  const openSafe = useCallback(() => {
    // Safe is the app's crisis surface — the `/preview/v2` route hands the
    // shell a navigate-to-/crisis. If a host mounts the shell without
    // `onSafe` (a bare test), the dot is a no-op rather than a crash.
    onSafe?.();
  }, [onSafe]);

  // a submodule jump from Find / Caught closes the overlay first
  const jumpToSubmodule = useCallback(
    (submodule: SubmoduleKey) => {
      setOverlay('none');
      pushSubmodule(submodule);
    },
    [pushSubmodule],
  );

  // ── the capture deck (the floor) ──────────────────────────────────────
  const deck = (
    <div style={{ ...box, position: 'absolute', inset: 0, background: v2.paper }}>
      <SwipeDeck index={deckIndex} count={4} onIndexChange={setDeckIndex}>
        {[
          <ThrowScreen key="throw" onThrow={handleThrow} onMic={openListening} />,
          <CaughtScreen key="caught" history={caught} onOpenSubmodule={jumpToSubmodule} />,
          <NoticedScreen key="noticed" patterns={patterns} />,
          <ModulesScreen key="modules" onOpenModule={pushModule} onSettings={onSettings} />,
        ]}
      </SwipeDeck>
      {/* Find + Safe — fixed chrome over the whole deck */}
      <CornerDots onFind={openFind} onSafe={openSafe} />
      {/* the 4-dot position indicator */}
      <DeckDots active={deckScreen} onJump={(to) => setDeckIndex(DECK_ORDER.indexOf(to))} />
    </div>
  );

  // ── a pushed frame ────────────────────────────────────────────────────
  function renderFrame(frame: ShellFrame) {
    if (frame.kind === 'deck') return deck;

    if (frame.kind === 'module') {
      const homepage =
        frame.module === 'body' ? (
          <BodyHome onBack={pop} onFind={openFind} onSafe={openSafe} onOpenSubmodule={pushSubmodule} />
        ) : frame.module === 'home' ? (
          <HomeHome onBack={pop} onFind={openFind} onSafe={openSafe} onOpenSubmodule={pushSubmodule} />
        ) : (
          <WorkHome onBack={pop} onFind={openFind} onSafe={openSafe} onOpenSubmodule={pushSubmodule} />
        );
      return (
        <PushSurface key={`module-${frame.module}`} onBack={pop}>
          {homepage}
        </PushSurface>
      );
    }

    // a submodule frame — mount the real `*-v2` app. Its `onExit` (called
    // when it pops off its own floor) pops the shell stack; its `onSafe`
    // opens the shell's Safe surface. The module owns its own chrome, so
    // it is NOT wrapped in PushSurface — it has its own back handle.
    const sub = frame.submodule;
    const common = { now: clock, onExit: pop, onSafe: openSafe };
    let app: JSX.Element;
    switch (sub) {
      case 'money':
        app = <MoneyApp {...common} />;
        break;
      case 'cycle':
        app = <CycleApp {...common} />;
        break;
      case 'sleep':
        app = <SleepApp {...common} />;
        break;
      case 'body':
        app = <BodyApp {...common} />;
        break;
      case 'medication':
        app = <MedicationApp {...common} />;
        break;
      case 'habits':
        app = <HabitsApp {...common} />;
        break;
      case 'admin':
        app = <AdminApp {...common} />;
        break;
      case 'pets':
        app = <PetsApp {...common} />;
        break;
      case 'grocery':
        app = <GroceryApp {...common} />;
        break;
      case 'work':
        app = <WorkApp {...common} />;
        break;
      case 'goals':
        app = <GoalsApp {...common} />;
        break;
      case 'partner':
      default:
        app = <PartnerApp {...common} />;
        break;
    }
    return (
      <div key={`submodule-${sub}`} style={{ ...box, position: 'absolute', inset: 0, background: v2.paper, overflowY: 'auto' }}>
        {app}
      </div>
    );
  }

  return (
    <div
      data-testid="v2-shell"
      style={{
        ...box,
        position: 'relative',
        minHeight: '100dvh',
        height: '100dvh',
        width: '100%',
        maxWidth: '100vw',
        background: v2.paper,
        fontFamily: v2.sans,
        color: v2.ink,
        overflow: 'hidden',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* render the WHOLE stack — lower frames stay mounted so a pop is
          instant and module state survives a drill-down and back. only
          the top frame is interactive. */}
      {stack.map((frame, i) => (
        <div
          // stack frames are positional + stable for the stack's lifetime
          key={`shell-frame-${i}`}
          aria-hidden={i !== stack.length - 1}
          style={{
            ...box,
            position: 'absolute',
            inset: 0,
            // keep lower frames painted (no flash on pop) but inert
            pointerEvents: i === stack.length - 1 ? 'auto' : 'none',
            visibility: i === stack.length - 1 ? 'visible' : 'hidden',
          }}
        >
          {renderFrame(frame)}
        </div>
      ))}

      {/* the listening voice-capture overlay — over Throw */}
      {listening && <ListeningScreen onCaptured={onVoiceCaptured} onCancel={onVoiceCancel} />}

      {/* the Find overlay — over everything, reachable from every screen */}
      {overlay === 'find' && (
        <FindScreen onClose={closeOverlay} caught={caught} onOpenSubmodule={jumpToSubmodule} />
      )}
    </div>
  );
}
