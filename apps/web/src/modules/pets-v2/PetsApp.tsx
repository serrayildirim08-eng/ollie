/**
 * pets-v2 · PetsApp — the preview module root
 *
 * Mounted behind the dev-only `/preview/pets` route. It owns a small
 * in-module navigation stack (the v2 pattern: module + leaf pages push a
 * stack; back is a swipe-down on the handle). The whole thing is real,
 * runnable, clickable code over the live `pets.*` store — it does NOT
 * touch the live `modules/pets` module or the app's main navigation.
 *
 * `onExit` returns to whatever opened the preview; `now` is injected so
 * screens stay deterministic and testable. Mirrors admin-v2/AdminApp.tsx.
 *
 * The `profile` leaf carries a `selectedPetId` — set when a roster row is
 * opened — so the profile screen knows which pet to render. The `log` and
 * `observe` leaves carry an optional `prefillPetId` / `prefillTask` so the
 * hero's "log care" lands pre-targeted.
 */
import { useCallback, useState } from 'react';
import { PetsFace } from './screens/PetsFace';
import { ProfileScreen } from './screens/ProfileScreen';
import { AddScreen } from './screens/AddScreen';
import { LogCareScreen } from './screens/LogCareScreen';
import { ObserveScreen } from './screens/ObserveScreen';
import { HealthScreen } from './screens/HealthScreen';
import { PatternsScreen } from './screens/PatternsScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';

/** every reachable v2 pets screen */
export type PetsRoute =
  | 'face'
  | 'profile'
  | 'add'
  | 'log'
  | 'observe'
  | 'health'
  | 'patterns'
  | 'notifications';

export interface PetsAppProps {
  /** injected for deterministic tests; defaults to Date.now() */
  now?: number;
  /** leave the preview module entirely */
  onExit?: () => void;
  /** the route to open on first mount (the preview index can deep-link) */
  initialRoute?: PetsRoute;
  /** opening the crisis surface — the Safe dot */
  onSafe?: () => void;
}

export function PetsApp({
  now,
  onExit,
  initialRoute = 'face',
  onSafe,
}: PetsAppProps) {
  const clock = now ?? Date.now();
  // a real push/pop stack — `face` is always the floor
  const [stack, setStack] = useState<PetsRoute[]>(
    initialRoute === 'face' ? ['face'] : ['face', initialRoute],
  );
  // the pet the profile / log / observe screens target
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  // an optional pre-targeted care task for the log screen (the hero CTA)
  const [prefillTask, setPrefillTask] = useState<string | null>(null);
  const current = stack[stack.length - 1];

  const push = useCallback((to: PetsRoute) => {
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

  /** open a pet's profile page */
  const openProfile = useCallback(
    (id: string) => {
      setSelectedPetId(id);
      push('profile');
    },
    [push],
  );

  /** open the log-care screen, optionally pre-targeted at a pet + task */
  const openLog = useCallback(
    (petId?: string, task?: string) => {
      setSelectedPetId(petId ?? null);
      setPrefillTask(task ?? null);
      push('log');
    },
    [push],
  );

  /** open the observe screen, optionally pre-targeted at a pet */
  const openObserve = useCallback(
    (petId?: string) => {
      setSelectedPetId(petId ?? null);
      push('observe');
    },
    [push],
  );

  const safe = useCallback(() => {
    if (onSafe) onSafe();
  }, [onSafe]);

  switch (current) {
    case 'profile':
      return (
        <ProfileScreen
          now={clock}
          petId={selectedPetId}
          onBack={pop}
          onLogCare={(id) => openLog(id)}
          onObserve={(id) => openObserve(id)}
        />
      );
    case 'add':
      return <AddScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'log':
      return (
        <LogCareScreen
          now={clock}
          prefillPetId={selectedPetId}
          prefillTask={prefillTask}
          onBack={pop}
        />
      );
    case 'observe':
      return (
        <ObserveScreen
          now={clock}
          prefillPetId={selectedPetId}
          onBack={pop}
        />
      );
    case 'health':
      return <HealthScreen now={clock} onBack={pop} />;
    case 'patterns':
      return <PatternsScreen now={clock} onBack={pop} />;
    case 'notifications':
      return <NotificationsScreen now={clock} onBack={pop} />;
    case 'face':
    default:
      return (
        <PetsFace
          now={clock}
          navigate={push}
          onOpenProfile={openProfile}
          onLogCare={openLog}
          onSafe={safe}
        />
      );
  }
}
