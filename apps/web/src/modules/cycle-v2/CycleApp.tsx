/**
 * cycle-v2 · CycleApp — the preview module root
 *
 * Mounted behind the dev-only `/preview/cycle` route. It owns a small
 * in-module navigation stack (the v2 pattern: module + detail pages push a
 * stack; back is a swipe-down on the handle). The whole thing is real,
 * runnable, clickable code over the live `cycle.*` store — it does NOT
 * touch the live `modules/cycle` module or the app's main navigation.
 *
 * `onExit` returns to whatever opened the preview; `now` is injected so
 * screens stay deterministic and testable. Mirrors money-v2/MoneyApp.tsx.
 */
import { useCallback, useState } from 'react';
import { CycleFace } from './screens/CycleFace';
import { LogTodayScreen } from './screens/LogTodayScreen';
import { PillLogScreen } from './screens/PillLogScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { FlagsScreen } from './screens/FlagsScreen';
import { PartnerAskScreen } from './screens/PartnerAskScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';

/** every reachable v2 cycle screen */
export type CycleRoute =
  | 'face'
  | 'log'
  | 'pill'
  | 'history'
  | 'flags'
  | 'partner-ask'
  | 'notifications';

export interface CycleAppProps {
  /** injected for deterministic tests; defaults to Date.now() */
  now?: number;
  /** leave the preview module entirely */
  onExit?: () => void;
  /** the route to open on first mount (the preview index can deep-link) */
  initialRoute?: CycleRoute;
  /** opening the crisis surface — the Safe dot */
  onSafe?: () => void;
}

export function CycleApp({
  now,
  onExit,
  initialRoute = 'face',
  onSafe,
}: CycleAppProps) {
  const clock = now ?? Date.now();
  // a real push/pop stack — `face` is always the floor
  const [stack, setStack] = useState<CycleRoute[]>(
    initialRoute === 'face' ? ['face'] : ['face', initialRoute],
  );
  const current = stack[stack.length - 1];

  const push = useCallback((to: CycleRoute) => {
    setStack((s) => [...s, to]);
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

  switch (current) {
    case 'log':
      return <LogTodayScreen now={clock} onBack={pop} />;
    case 'pill':
      return <PillLogScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'history':
      return <HistoryScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'flags':
      return <FlagsScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'partner-ask':
      return <PartnerAskScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'notifications':
      return <NotificationsScreen onBack={pop} />;
    case 'face':
    default:
      return <CycleFace now={clock} navigate={push} onSafe={safe} />;
  }
}
