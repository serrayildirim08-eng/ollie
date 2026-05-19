/**
 * body-v2 · BodyApp — the preview module root
 *
 * Mounted behind the dev-only `/preview/body` route. It owns a small
 * in-module navigation stack (the v2 pattern: module + leaf pages push a
 * stack; back is a swipe-down on the handle). The whole thing is real,
 * runnable, clickable code over the live `body.*` store — it does NOT
 * touch the live `modules/body` module or the app's main navigation.
 *
 * `onExit` returns to whatever opened the preview; `now` is injected so
 * screens stay deterministic and testable. Mirrors sleep-v2/SleepApp.tsx.
 */
import { useCallback, useState } from 'react';
import { BodyFace } from './screens/BodyFace';
import { IntakeScreen } from './screens/IntakeScreen';
import { SymptomsScreen } from './screens/SymptomsScreen';
import { SymptomLogScreen } from './screens/SymptomLogScreen';
import { EpisodeScreen } from './screens/EpisodeScreen';
import { ConditionsScreen } from './screens/ConditionsScreen';
import { DoctorSummaryScreen } from './screens/DoctorSummaryScreen';
import { PatternsScreen } from './screens/PatternsScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';

/** every reachable v2 body screen */
export type BodyRoute =
  | 'face'
  | 'intake'
  | 'symptoms'
  | 'symptom-log'
  | 'episode'
  | 'conditions'
  | 'doctor'
  | 'patterns'
  | 'notifications';

export interface BodyAppProps {
  /** injected for deterministic tests; defaults to Date.now() */
  now?: number;
  /** leave the preview module entirely */
  onExit?: () => void;
  /** the route to open on first mount (the preview index can deep-link) */
  initialRoute?: BodyRoute;
  /** opening the crisis surface — the Safe dot */
  onSafe?: () => void;
}

export function BodyApp({
  now,
  onExit,
  initialRoute = 'face',
  onSafe,
}: BodyAppProps) {
  const clock = now ?? Date.now();
  // a real push/pop stack — `face` is always the floor
  const [stack, setStack] = useState<BodyRoute[]>(
    initialRoute === 'face' ? ['face'] : ['face', initialRoute],
  );
  const current = stack[stack.length - 1];

  const push = useCallback((to: BodyRoute) => {
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
    case 'intake':
      return <IntakeScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'symptoms':
      return (
        <SymptomsScreen now={clock} onBack={pop} navigate={push} onSafe={safe} />
      );
    case 'symptom-log':
      return <SymptomLogScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'episode':
      return <EpisodeScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'conditions':
      return <ConditionsScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'doctor':
      return <DoctorSummaryScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'patterns':
      return <PatternsScreen onBack={pop} onSafe={safe} />;
    case 'notifications':
      return <NotificationsScreen onBack={pop} />;
    case 'face':
    default:
      return <BodyFace now={clock} navigate={push} onSafe={safe} />;
  }
}
