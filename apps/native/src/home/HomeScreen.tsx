/**
 * HomeScreen — the reminder-first shell.
 *
 *   ● (breathing green dot — "I'm here, listening")
 *   today / this week / this month / anytime  — open to-dos with their times
 *   [ chat box pinned at the bottom ]
 *
 * The list is read-only over the existing module repos + the reminder ledger
 * (no new source of truth). Tapping the circle completes the row through the
 * same path the /todo screen uses, which also cancels its pending reminder.
 * Polls like TodoScreen does, since SQLite has no change feed yet.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { Stack } from '../layout';
import { colors } from '../theme/tokens';
import { DumpScreen } from '../dump';
import { loadTodayTodos } from '../todo/loadTodos';
import { markComplete } from '../todo/TodoScreen';
import { loadLedger } from '../notify/reminderLedger';
import { buildUpcoming, whenLabel, type Horizon, type HorizonId, type UpcomingItem } from './upcoming';
import styles from './HomeScreen.module.css';

const POLL_MS = 6000;

const HORIZON_LABEL: Record<HorizonId, string> = {
  today: 'today',
  thisWeek: 'this week',
  thisMonth: 'this month',
  anytime: 'anytime',
};

const SMCP: CSSProperties = { fontVariantCaps: 'all-small-caps', letterSpacing: '0.08em' };

function ListeningDot(): JSX.Element {
  return (
    <div className={styles.dotWrap} role="img" aria-label="ollie is listening">
      <span className={styles.dotHalo} />
      <span className={styles.dot} />
    </div>
  );
}

function Row({
  item,
  horizon,
  onDone,
}: {
  item: UpcomingItem;
  horizon: HorizonId;
  onDone: (item: UpcomingItem) => void;
}): JSX.Element {
  const checkable = item.todo.kind === 'task';
  const when = whenLabel(item, horizon);
  return (
    <li className={styles.row}>
      {checkable ? (
        <button
          type="button"
          className={styles.check}
          aria-label={`done: ${item.text}`}
          onClick={() => onDone(item)}
        />
      ) : (
        <span className={styles.checkGhost} aria-hidden />
      )}
      <span className={styles.text}>{item.text}</span>
      {when && (
        <span className={styles.when} style={when === 'overdue' ? { color: colors.rubric } : undefined}>
          {when}
        </span>
      )}
    </li>
  );
}

export function HomeScreen(): JSX.Element {
  const [horizons, setHorizons] = useState<Horizon[] | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const [todos, ledger] = await Promise.all([loadTodayTodos(), loadLedger()]);
      setHorizons(buildUpcoming(todos, ledger));
    } catch (err) {
      console.warn('[home] load failed', err);
      setHorizons((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    const onFocus = (): void => void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  const onDone = useCallback(
    (item: UpcomingItem) => {
      // Optimistic: hide now, write, then re-read.
      setHidden((s) => new Set(s).add(item.id));
      void markComplete(item.todo)
        .catch((err) => {
          console.warn('[home] complete failed', err);
          setHidden((s) => {
            const n = new Set(s);
            n.delete(item.id);
            return n;
          });
        })
        .finally(() => void refresh());
    },
    [refresh],
  );

  const visible = (horizons ?? [])
    .map((h) => ({ ...h, items: h.items.filter((i) => !hidden.has(i.id)) }))
    .filter((h) => h.items.length > 0);

  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <ListeningDot />
        <Link to="/settings" className={styles.gear} aria-label="settings" style={SMCP}>
          settings
        </Link>
      </header>

      <Stack gap={28}>
        {horizons !== null && visible.length === 0 && (
          <p className={styles.empty}>
            nothing coming up.
            <br />
            tell me what to remember — "call mom tomorrow at 3".
          </p>
        )}
        {visible.map((h) => (
          <section key={h.id}>
            <h2 className={styles.heading} style={SMCP}>
              {HORIZON_LABEL[h.id]}
            </h2>
            <ul className={styles.list}>
              {h.items.map((item) => (
                <Row key={item.id} item={item} horizon={h.id} onDone={onDone} />
              ))}
            </ul>
          </section>
        ))}
      </Stack>

      <div className={styles.spacer} />
      <DumpScreen variant="dock" />
    </div>
  );
}
