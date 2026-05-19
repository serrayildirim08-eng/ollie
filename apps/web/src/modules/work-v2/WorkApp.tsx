/**
 * work-v2 · WorkApp — the preview module root
 *
 * Mounted behind the dev-only `/preview/work` route. It owns a small
 * in-module navigation stack (the v2 pattern: a leaf page pushes onto a
 * stack; back is the swipe-handle / a real back button). The whole thing is
 * real, runnable, clickable React over the REAL matter backend — the matter
 * container + the deterministic dump→matter routing (`@ollie/logic/work` +
 * the `matter-routing` orchestrator, committed as 9ed51e5). `useWorkStore`
 * reads the live `work` store namespace; there is no stub.
 *
 * The 4 screens, Phase-1/2-honest (WORK-VISION.md build roadmap):
 *   - `face`    — the work submodule card — the matters card
 *   - `matters` — the matter list — every matter, passive
 *   - `matter`  — one matter's view: identity + its routed notes (the
 *                 synthesised secretary briefing is a Phase-3 derived view,
 *                 not built — see MatterScreen)
 *   - `confirm` — the auto-detect / confirm sheet for a "new matter?" nudge
 *
 * The floor is the `face`. A leaf is a `WorkRoute` plus, for `matter`, the
 * matterId it opened. `onExit` returns to whatever opened the preview; `now`
 * is injected so screens stay deterministic. Mirrors partner-v2/PartnerApp.tsx.
 */
import { useCallback, useState } from 'react';
import { useWorkStore } from './useWorkStore';
import { WorkFaceScreen } from './screens/WorkFaceScreen';
import { MatterListScreen } from './screens/MatterListScreen';
import { MatterScreen } from './screens/MatterScreen';
import { MatterConfirmScreen } from './screens/MatterConfirmScreen';

/** every reachable v2 work screen */
export type WorkRoute = 'face' | 'matters' | 'matter' | 'confirm';

/** one entry on the in-module nav stack — a route, plus a matterId for `matter` */
interface StackEntry {
  route: WorkRoute;
  /** the matter being viewed — only set for `route === 'matter'` */
  matterId?: string;
}

export interface WorkAppProps {
  /** injected for deterministic tests; defaults to Date.now() */
  now?: number;
  /** leave the preview module entirely */
  onExit?: () => void;
  /** the route to open on first mount (the preview index can deep-link) */
  initialRoute?: WorkRoute;
  /** the matter to open when `initialRoute` is `matter` (test deep-link) */
  initialMatterId?: string;
  /** opening the crisis surface — the Safe dot */
  onSafe?: () => void;
}

export function WorkApp({
  now,
  onExit,
  initialRoute,
  initialMatterId,
  onSafe,
}: WorkAppProps) {
  const clock = now ?? Date.now();
  const { state, actions } = useWorkStore(clock);

  // the floor is always the work face; `initialRoute` deep-links a leaf on
  // top of it (for tests + the preview index).
  const [stack, setStack] = useState<StackEntry[]>(() => {
    const floor: StackEntry = { route: 'face' };
    if (!initialRoute || initialRoute === 'face') return [floor];
    return [
      floor,
      {
        route: initialRoute,
        matterId:
          initialRoute === 'matter'
            ? initialMatterId ?? state.matters[0]?.id
            : undefined,
      },
    ];
  });
  const current = stack[stack.length - 1];

  const push = useCallback((entry: StackEntry) => {
    setStack((s) => [...s, entry]);
  }, []);

  const pop = useCallback(() => {
    setStack((s) => {
      if (s.length <= 1) {
        onExit?.();
        return s;
      }
      return s.slice(0, -1);
    });
  }, [onExit]);

  const safe = useCallback(() => {
    if (onSafe) onSafe();
  }, [onSafe]);

  switch (current.route) {
    case 'matters':
      return (
        <MatterListScreen
          state={state}
          onOpenMatter={(id) => push({ route: 'matter', matterId: id })}
          onBack={pop}
          onSafe={safe}
        />
      );
    case 'matter':
      return (
        <MatterScreen
          state={state}
          matterId={current.matterId ?? ''}
          now={clock}
          onBack={pop}
          onSafe={safe}
        />
      );
    case 'confirm':
      return (
        <MatterConfirmScreen
          state={state}
          now={clock}
          onConfirm={() => {
            actions.confirmSuggestion();
            pop();
          }}
          onDismiss={() => {
            actions.dismissSuggestion();
            pop();
          }}
          onBack={pop}
          onSafe={safe}
        />
      );
    case 'face':
    default:
      return (
        <WorkFaceScreen
          state={state}
          onOpenMatters={() => push({ route: 'matters' })}
          onOpenConfirm={() => push({ route: 'confirm' })}
          onBack={stack.length > 1 ? pop : onExit}
          onSafe={safe}
        />
      );
  }
}
