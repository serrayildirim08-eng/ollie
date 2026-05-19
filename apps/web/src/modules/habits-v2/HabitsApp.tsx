/**
 * habits-v2 · HabitsApp — the preview module root
 *
 * Mounted behind the dev-only `/preview/habits` route. It owns a small
 * in-module navigation stack (the v2 pattern: module + leaf pages push a
 * stack; back is a swipe-down on the handle). The whole thing is real,
 * runnable, clickable code over the live `shared.habits_v2` +
 * `habits.patterns` store — it does NOT touch the live `modules/habits`
 * module or the app's main navigation.
 *
 * `onExit` returns to whatever opened the preview; `now` is injected so
 * screens stay deterministic and testable. Mirrors
 * medication-v2/MedicationApp.tsx.
 */
import { useCallback, useState } from 'react';
import { HabitsFace } from './screens/HabitsFace';
import { AddHabitScreen } from './screens/AddHabitScreen';
import { AllHabitsScreen } from './screens/AllHabitsScreen';
import { PatternsScreen } from './screens/PatternsScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';

/** every reachable v2 habits screen */
export type HabitsRoute = 'face' | 'add' | 'all' | 'patterns' | 'notifications';

export interface HabitsAppProps {
  /** injected for deterministic tests; defaults to Date.now() */
  now?: number;
  /** leave the preview module entirely */
  onExit?: () => void;
  /** the route to open on first mount (the preview index can deep-link) */
  initialRoute?: HabitsRoute;
  /** opening the crisis surface — the Safe dot */
  onSafe?: () => void;
}

export function HabitsApp({
  now,
  onExit,
  initialRoute = 'face',
  onSafe,
}: HabitsAppProps) {
  const clock = now ?? Date.now();
  // a real push/pop stack — `face` is always the floor
  const [stack, setStack] = useState<HabitsRoute[]>(
    initialRoute === 'face' ? ['face'] : ['face', initialRoute],
  );
  const current = stack[stack.length - 1];

  const push = useCallback((to: HabitsRoute) => {
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
    case 'add':
      return <AddHabitScreen now={clock} onBack={pop} />;
    case 'all':
      return <AllHabitsScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'patterns':
      return <PatternsScreen onBack={pop} />;
    case 'notifications':
      return <NotificationsScreen onBack={pop} />;
    case 'face':
    default:
      return <HabitsFace now={clock} navigate={push} onSafe={safe} />;
  }
}
