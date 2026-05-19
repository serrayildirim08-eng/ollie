/**
 * goals-v2 · GoalsApp — the preview module root
 *
 * Mounted behind the dev-only `/preview/goals` route. It owns a small
 * in-module navigation stack (the v2 pattern: module + leaf pages push a
 * stack; back is a swipe-down on the handle). The whole thing is real,
 * runnable, clickable code over the live `goals.*` store — it does NOT
 * touch the live `modules/goals` module or the app's main navigation.
 *
 * `onExit` returns to whatever opened the preview; `now` is injected so
 * screens stay deterministic and testable. Mirrors admin-v2/AdminApp.tsx.
 *
 * The `goal` and `review` leaves carry a `selectedGoalId` — set when a
 * goal is opened from the face — so the detail / check-in screen knows
 * which goal to render.
 *
 * goals.html + goals-cold.html are ONE face, two states (picked by
 * `faceVM().hasAnyGoal`); the 7 mockups therefore map to 6 screens.
 */
import { useCallback, useState } from 'react';
import { GoalsFace } from './screens/GoalsFace';
import { GoalScreen } from './screens/GoalScreen';
import { AddScreen } from './screens/AddScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { PatternsScreen } from './screens/PatternsScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';

/** every reachable v2 goals screen */
export type GoalsRoute =
  | 'face'
  | 'goal'
  | 'add'
  | 'review'
  | 'patterns'
  | 'notifications';

export interface GoalsAppProps {
  /** injected for deterministic tests; defaults to Date.now() */
  now?: number;
  /** leave the preview module entirely */
  onExit?: () => void;
  /** the route to open on first mount (the preview index can deep-link) */
  initialRoute?: GoalsRoute;
  /** opening the crisis surface — the Safe dot */
  onSafe?: () => void;
}

export function GoalsApp({
  now,
  onExit,
  initialRoute = 'face',
  onSafe,
}: GoalsAppProps) {
  const clock = now ?? Date.now();
  // a real push/pop stack — `face` is always the floor
  const [stack, setStack] = useState<GoalsRoute[]>(
    initialRoute === 'face' ? ['face'] : ['face', initialRoute],
  );
  // the goal the detail / review screen renders — set when a goal is opened
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const current = stack[stack.length - 1];

  const push = useCallback((to: GoalsRoute) => {
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

  /** open a goal's detail page */
  const openGoal = useCallback(
    (id: string) => {
      setSelectedGoalId(id);
      push('goal');
    },
    [push],
  );

  /** open the soft check-in for a goal */
  const openReview = useCallback(
    (id: string) => {
      setSelectedGoalId(id);
      push('review');
    },
    [push],
  );

  const safe = useCallback(() => {
    if (onSafe) onSafe();
  }, [onSafe]);

  switch (current) {
    case 'goal':
      return (
        <GoalScreen
          now={clock}
          goalId={selectedGoalId}
          onBack={pop}
          onSafe={safe}
          onReview={openReview}
        />
      );
    case 'add':
      return <AddScreen now={clock} onBack={pop} />;
    case 'review':
      return <ReviewScreen now={clock} goalId={selectedGoalId} onBack={pop} />;
    case 'patterns':
      return <PatternsScreen now={clock} onBack={pop} />;
    case 'notifications':
      return <NotificationsScreen now={clock} onBack={pop} />;
    case 'face':
    default:
      return (
        <GoalsFace
          now={clock}
          navigate={push}
          onOpenGoal={openGoal}
          onReview={openReview}
          onSafe={safe}
        />
      );
  }
}
