/**
 * money-v2 · MoneyApp — the preview module root
 *
 * Mounted behind the dev-only `/preview/money` route. It owns a small
 * in-module navigation stack (DIRECTION.md: "module and detail pages push
 * a stack; back is a swipe-down on the handle"). The whole thing is real,
 * runnable, clickable code over the live `finance.*` store — it does NOT
 * touch the live finance module or the app's main navigation.
 *
 * `onExit` returns to whatever opened the preview (the dev preview index
 * passes a router back). `now` is injected so screens stay deterministic
 * and testable; `MoneyApp` defaults it to wall-clock.
 */
import { useCallback, useState } from 'react';
import { MoneyFace } from './screens/MoneyFace';
import { BillsScreen } from './screens/BillsScreen';
import { IncomeScreen } from './screens/IncomeScreen';
import { SubscriptionsScreen } from './screens/SubscriptionsScreen';
import { SavingsScreen } from './screens/SavingsScreen';
import { AdhdTaxScreen } from './screens/AdhdTaxScreen';
import { LogSpendScreen } from './screens/LogSpendScreen';
import { ImpulsePauseScreen } from './screens/ImpulsePauseScreen';
import { TaxSetAsideScreen } from './screens/TaxSetAsideScreen';
import { ShoppingCheckScreen } from './screens/ShoppingCheckScreen';
import { FindScreen } from './screens/FindScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';

/** every reachable v2 money screen */
export type MoneyRoute =
  | 'face'
  | 'bills'
  | 'income'
  | 'subscriptions'
  | 'savings'
  | 'adhdtax'
  | 'log-spend'
  | 'impulse-pause'
  | 'tax-setaside'
  | 'shopping-check'
  | 'find'
  | 'notifications';

export interface MoneyAppProps {
  /** injected for deterministic tests; defaults to Date.now() */
  now?: number;
  /** leave the preview module entirely */
  onExit?: () => void;
  /** the route to open on first mount (the preview index can deep-link) */
  initialRoute?: MoneyRoute;
  /** opening the crisis surface — the Safe dot */
  onSafe?: () => void;
}

export function MoneyApp({ now, onExit, initialRoute = 'face', onSafe }: MoneyAppProps) {
  const clock = now ?? Date.now();
  // a real push/pop stack — `face` is always the floor
  const [stack, setStack] = useState<MoneyRoute[]>(
    initialRoute === 'face' ? ['face'] : ['face', initialRoute],
  );
  const current = stack[stack.length - 1];

  const push = useCallback((to: MoneyRoute) => {
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

  const openFind = useCallback(() => push('find'), [push]);

  switch (current) {
    case 'bills':
      return <BillsScreen now={clock} onBack={pop} navigate={push} onFind={openFind} onSafe={safe} />;
    case 'income':
      return <IncomeScreen now={clock} onBack={pop} onFind={openFind} onSafe={safe} />;
    case 'subscriptions':
      return (
        <SubscriptionsScreen now={clock} onBack={pop} onFind={openFind} onSafe={safe} />
      );
    case 'savings':
      return <SavingsScreen now={clock} onBack={pop} onFind={openFind} onSafe={safe} />;
    case 'adhdtax':
      return (
        <AdhdTaxScreen now={clock} onBack={pop} navigate={push} onFind={openFind} onSafe={safe} />
      );
    case 'log-spend':
      return <LogSpendScreen now={clock} onBack={pop} navigate={push} />;
    case 'impulse-pause':
      return <ImpulsePauseScreen onBack={pop} />;
    case 'tax-setaside':
      return <TaxSetAsideScreen now={clock} onBack={pop} onFind={openFind} onSafe={safe} />;
    case 'shopping-check':
      return <ShoppingCheckScreen onBack={pop} />;
    case 'find':
      return <FindScreen now={clock} onBack={pop} navigate={push} />;
    case 'notifications':
      return <NotificationsScreen onBack={pop} />;
    case 'face':
    default:
      return <MoneyFace now={clock} navigate={push} onFind={openFind} onSafe={safe} />;
  }
}
