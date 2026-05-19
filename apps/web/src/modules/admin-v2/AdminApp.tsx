/**
 * admin-v2 · AdminApp — the preview module root
 *
 * Mounted behind the dev-only `/preview/admin` route. It owns a small
 * in-module navigation stack (the v2 pattern: module + leaf pages push a
 * stack; back is a swipe-down on the handle). The whole thing is real,
 * runnable, clickable code over the live `admin.tasks` store — it does NOT
 * touch the live `modules/admin` module or the app's main navigation.
 *
 * `onExit` returns to whatever opened the preview; `now` is injected so
 * screens stay deterministic and testable. Mirrors body-v2/BodyApp.tsx.
 *
 * The `task` leaf carries a `selectedTaskId` — set when a row on the tasks
 * list is opened — so the detail screen knows which task to render.
 */
import { useCallback, useState } from 'react';
import { AdminFace } from './screens/AdminFace';
import { TasksScreen } from './screens/TasksScreen';
import { TaskScreen } from './screens/TaskScreen';
import { AddScreen } from './screens/AddScreen';
import { CallsScreen } from './screens/CallsScreen';
import { BurstScreen } from './screens/BurstScreen';
import { PatternsScreen } from './screens/PatternsScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';

/** every reachable v2 admin screen */
export type AdminRoute =
  | 'face'
  | 'tasks'
  | 'task'
  | 'add'
  | 'calls'
  | 'burst'
  | 'patterns'
  | 'notifications';

export interface AdminAppProps {
  /** injected for deterministic tests; defaults to Date.now() */
  now?: number;
  /** leave the preview module entirely */
  onExit?: () => void;
  /** the route to open on first mount (the preview index can deep-link) */
  initialRoute?: AdminRoute;
  /** opening the crisis surface — the Safe dot */
  onSafe?: () => void;
}

export function AdminApp({
  now,
  onExit,
  initialRoute = 'face',
  onSafe,
}: AdminAppProps) {
  const clock = now ?? Date.now();
  // a real push/pop stack — `face` is always the floor
  const [stack, setStack] = useState<AdminRoute[]>(
    initialRoute === 'face' ? ['face'] : ['face', initialRoute],
  );
  // the task the detail screen renders — set when a tasks-list row is opened
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const current = stack[stack.length - 1];

  const push = useCallback((to: AdminRoute) => {
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

  /** open a task's detail page */
  const openTask = useCallback(
    (id: string) => {
      setSelectedTaskId(id);
      push('task');
    },
    [push],
  );

  const safe = useCallback(() => {
    if (onSafe) onSafe();
  }, [onSafe]);

  switch (current) {
    case 'tasks':
      return (
        <TasksScreen
          now={clock}
          onBack={pop}
          onOpenTask={openTask}
          onAdd={() => push('add')}
          onSafe={safe}
        />
      );
    case 'task':
      return (
        <TaskScreen
          now={clock}
          taskId={selectedTaskId}
          onBack={pop}
          onSafe={safe}
        />
      );
    case 'add':
      return <AddScreen now={clock} onBack={pop} />;
    case 'calls':
      return <CallsScreen now={clock} onBack={pop} onSafe={safe} />;
    case 'burst':
      return <BurstScreen now={clock} onBack={pop} />;
    case 'patterns':
      return <PatternsScreen now={clock} onBack={pop} />;
    case 'notifications':
      return <NotificationsScreen now={clock} onBack={pop} />;
    case 'face':
    default:
      return (
        <AdminFace
          now={clock}
          navigate={push}
          onOpenTask={openTask}
          onSafe={safe}
        />
      );
  }
}
