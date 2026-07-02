/**
 * TodayPulse — the one calm orientation line at the top of home.
 *
 * "today's clear." / "a few things for today." — a single glance at what today
 * is like, above the "worth a glance" noticings. NOT a planner: no timeline, no
 * calendar, no list here. It reuses the same today-list the TodoScreen shows
 * (loadTodayTodos + selectTodayList) plus the capacity read, and renders one
 * sentence from the pure buildTodayPulse.
 *
 * Recomputes on mount, on window focus, and when a dump lands (dump.items) or
 * the capacity read changes — so it stays roughly live without its own poll.
 */

import { useEffect, useState } from 'react';
import { Text } from '../ui';
import { colors } from '../theme/tokens';
import { store } from '../store';
import { loadTodayTodos } from './loadTodos';
import { selectTodayList, isoToday } from './aggregateTodos';
import { buildTodayPulse, type Capacity } from './todayPulseCopy';

function readCapacity(): Capacity {
  const c = store.get<{ level?: string } | null>('shared', 'capacity', null);
  const lvl = c?.level;
  return lvl === 'low' || lvl === 'medium' || lvl === 'high' ? lvl : null;
}

export function TodayPulse(): JSX.Element | null {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      try {
        const items = await loadTodayTodos();
        if (cancelled) return;
        const count = selectTodayList(items, isoToday()).length;
        setLine(buildTodayPulse({ taskCount: count, capacity: readCapacity() }));
      } catch {
        // Best-effort: a read failure just hides the line, never throws into home.
        if (!cancelled) setLine(null);
      }
    };
    void compute();

    const onFocus = () => void compute();
    window.addEventListener('focus', onFocus);
    const unsubDump = store.subscribeKey('dump', 'items', () => void compute());
    const unsubCap = store.subscribeKey('shared', 'capacity', () => void compute());
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      unsubDump();
      unsubCap();
    };
  }, []);

  if (line === null) return null;
  return (
    <Text scale="body" color={colors.inkSoft} style={{ lineHeight: 1.4 }}>
      {line}
    </Text>
  );
}
