/**
 * grocery-v2 · GroceryApp — the preview module root
 *
 * Mounted behind the dev-only `/preview/grocery` route. It owns a small
 * in-module navigation stack (the v2 pattern: module face + leaf pages
 * push a stack; back is a swipe-down on the handle). The whole thing is
 * real, runnable, clickable code over the live `grocery.*` store — it does
 * NOT touch the live `modules/grocery` module or the app's main navigation.
 *
 * The `face` floor carries the 3-mode switch (shop · pantry · feed me) —
 * the mode is held here so it survives a leaf push/pop. The `add`,
 * `patterns` and `notifications` leaves push on top of it.
 *
 * `onExit` returns to whatever opened the preview; `now` is injected so
 * screens stay deterministic and testable. Mirrors admin-v2/AdminApp.tsx.
 */
import { useCallback, useState } from 'react';
import { GroceryFace } from './screens/GroceryFace';
import { AddScreen } from './screens/AddScreen';
import { PatternsScreen } from './screens/PatternsScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import type { GroceryMode } from './components/ModeSwitch';

/** every reachable v2 grocery screen */
export type GroceryRoute = 'face' | 'add' | 'patterns' | 'notifications';

export interface GroceryAppProps {
  /** injected for deterministic tests; defaults to Date.now() */
  now?: number;
  /** leave the preview module entirely */
  onExit?: () => void;
  /** the route to open on first mount (the preview index can deep-link) */
  initialRoute?: GroceryRoute;
  /** the mode the face opens in (shop · pantry · feed me) */
  initialMode?: GroceryMode;
  /** opening the crisis surface — the Safe dot */
  onSafe?: () => void;
}

export function GroceryApp({
  now,
  onExit,
  initialRoute = 'face',
  initialMode = 'shop',
  onSafe,
}: GroceryAppProps) {
  const clock = now ?? Date.now();
  // a real push/pop stack — `face` is always the floor
  const [stack, setStack] = useState<GroceryRoute[]>(
    initialRoute === 'face' ? ['face'] : ['face', initialRoute],
  );
  // the face's 3-mode switch — held here so it survives a leaf push/pop
  const [mode, setMode] = useState<GroceryMode>(initialMode);
  const current = stack[stack.length - 1];

  const push = useCallback((to: GroceryRoute) => {
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
      return <AddScreen now={clock} onBack={pop} />;
    case 'patterns':
      return <PatternsScreen now={clock} onBack={pop} />;
    case 'notifications':
      return <NotificationsScreen now={clock} onBack={pop} />;
    case 'face':
    default:
      return (
        <GroceryFace
          now={clock}
          mode={mode}
          onMode={setMode}
          onAdd={() => push('add')}
          onPatterns={() => push('patterns')}
          onNotifications={() => push('notifications')}
          onSafe={safe}
        />
      );
  }
}
