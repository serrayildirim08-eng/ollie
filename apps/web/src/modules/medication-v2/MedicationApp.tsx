/**
 * medication-v2 · MedicationApp — the preview module root
 *
 * Mounted behind the dev-only `/preview/medication` route. It owns a small
 * in-module navigation stack (the v2 pattern: module + leaf pages push a
 * stack; back is a swipe-down on the handle). The whole thing is real,
 * runnable, clickable code over the live `medication.*` store — it does
 * NOT touch the live `modules/medication` module or the app's main
 * navigation.
 *
 * `onExit` returns to whatever opened the preview; `now` is injected so
 * screens stay deterministic and testable. Mirrors body-v2/BodyApp.tsx.
 */
import { useCallback, useState } from 'react';
import { MedicationFace } from './screens/MedicationFace';
import { AddMedicationScreen } from './screens/AddMedicationScreen';
import { AdherenceLogScreen } from './screens/AdherenceLogScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';

/** every reachable v2 medication screen */
export type MedicationRoute = 'face' | 'add' | 'log' | 'notifications';

export interface MedicationAppProps {
  /** injected for deterministic tests; defaults to Date.now() */
  now?: number;
  /** leave the preview module entirely */
  onExit?: () => void;
  /** the route to open on first mount (the preview index can deep-link) */
  initialRoute?: MedicationRoute;
  /** opening the crisis surface — the Safe dot */
  onSafe?: () => void;
}

export function MedicationApp({
  now,
  onExit,
  initialRoute = 'face',
  onSafe,
}: MedicationAppProps) {
  const clock = now ?? Date.now();
  // a real push/pop stack — `face` is always the floor
  const [stack, setStack] = useState<MedicationRoute[]>(
    initialRoute === 'face' ? ['face'] : ['face', initialRoute],
  );
  const current = stack[stack.length - 1];

  const push = useCallback((to: MedicationRoute) => {
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
      return <AddMedicationScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'log':
      return <AdherenceLogScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'notifications':
      return <NotificationsScreen onBack={pop} />;
    case 'face':
    default:
      return <MedicationFace now={clock} navigate={push} onSafe={safe} />;
  }
}
