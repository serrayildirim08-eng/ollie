/**
 * sleep-v2 · SleepApp — the preview module root
 *
 * Mounted behind the dev-only `/preview/sleep` route. It owns a small
 * in-module navigation stack (the v2 pattern: module + leaf pages push a
 * stack; back is a swipe-down on the handle). The whole thing is real,
 * runnable, clickable code over the live `sleep.*` store — it does NOT
 * touch the live `modules/sleep` module or the app's main navigation.
 *
 * `onExit` returns to whatever opened the preview; `now` is injected so
 * screens stay deterministic and testable. Mirrors cycle-v2/CycleApp.tsx.
 */
import { useCallback, useState } from 'react';
import { SleepFace } from './screens/SleepFace';
import { LogNightScreen } from './screens/LogNightScreen';
import { WindDownScreen } from './screens/WindDownScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SoundsScreen } from './screens/SoundsScreen';
import { SurveyScreen } from './screens/SurveyScreen';
import { PatternsScreen } from './screens/PatternsScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';

/** every reachable v2 sleep screen */
export type SleepRoute =
  | 'face'
  | 'log'
  | 'winddown'
  | 'history'
  | 'sounds'
  | 'survey'
  | 'patterns'
  | 'notifications';

export interface SleepAppProps {
  /** injected for deterministic tests; defaults to Date.now() */
  now?: number;
  /** leave the preview module entirely */
  onExit?: () => void;
  /** the route to open on first mount (the preview index can deep-link) */
  initialRoute?: SleepRoute;
  /** opening the crisis surface — the Safe dot */
  onSafe?: () => void;
}

export function SleepApp({
  now,
  onExit,
  initialRoute = 'face',
  onSafe,
}: SleepAppProps) {
  const clock = now ?? Date.now();
  // a real push/pop stack — `face` is always the floor
  const [stack, setStack] = useState<SleepRoute[]>(
    initialRoute === 'face' ? ['face'] : ['face', initialRoute],
  );
  const current = stack[stack.length - 1];

  const push = useCallback((to: SleepRoute) => {
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
      return <LogNightScreen now={clock} onBack={pop} />;
    case 'winddown':
      return <WindDownScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'history':
      return <HistoryScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'sounds':
      return <SoundsScreen onBack={pop} onSafe={safe} />;
    case 'survey':
      return <SurveyScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'patterns':
      return <PatternsScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'notifications':
      return <NotificationsScreen onBack={pop} />;
    case 'face':
    default:
      return <SleepFace now={clock} navigate={push} onSafe={safe} />;
  }
}
