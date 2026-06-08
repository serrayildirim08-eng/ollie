/**
 * apps/native · modules/brain/TodayNoticings.tsx
 *
 * The cross-life "today" surface — Sprint 2's PRIMARY brain surface. Instead
 * of every detector dropping its own card into its Box (a nag-wall), this is
 * the ONE calm place that shows the top 2–3 noticings across her WHOLE life,
 * chosen by the selection discipline (modules/brain/noticings.ts → the pure
 * @ollie/logic/brain selector).
 *
 * Each note has a gentle "not now" (postpone — comes back in a day) and a
 * quieter "dismiss" (gone for good). Postpone + dismiss persist in SQLite, so
 * a snoozed note stays gone across app restarts until its window lapses.
 *
 * Relationship to the per-module PatternCards: those stay as-is inside each
 * Box for now (a module-local detail view). THIS is the new primary, cross-
 * life selection — the calm front door, not a wall.
 *
 * Design (Ollie DNA — matches PatternCards' grammar exactly):
 *   - cream/paper surface, sage kicker, one editorial sentence per note.
 *   - NO red / severity / badges / streaks / counts. NO shame.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ScoredNoticing } from '@ollie/logic/brain';
import { Stack } from '../../layout';
import { Text } from '../../ui';
import { colors, fontSizes, lineHeights, space, radii, letterSpacings } from '../../theme/tokens';
import { store } from '../../store';
import { selectTodaysNoticings, postponeNoticing, dismissNoticing } from './noticings';

const KICKER_STYLE: React.CSSProperties = {
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: letterSpacings.caps,
  fontSize: fontSizes.kicker,
  marginBottom: space[1],
};

/**
 * Recompute the cross-life selection whenever a noticing source changes. We
 * subscribe to the store keys the selection reads (every `<ns>.patterns`,
 * `shared.patterns`, `shared.capacity`) plus an internal bump after a
 * postpone/dismiss, and re-run the async select. Best-effort: a failure
 * yields an empty surface, never a throw.
 */
function useTodaysNoticings(): {
  noticings: ScoredNoticing[];
  refresh: () => void;
} {
  const [noticings, setNoticings] = useState<ScoredNoticing[]>([]);

  const refresh = useCallback(() => {
    void selectTodaysNoticings(store).then(setNoticings).catch(() => setNoticings([]));
  }, []);

  useEffect(() => {
    refresh();
    // The selection reads each module's patterns + shared.patterns + capacity.
    // Subscribing to all of them keeps the surface live without polling.
    const namespaces = [
      'admin', 'body', 'goals', 'grocery', 'habits',
      'journal', 'pets', 'work', 'sleep', 'finance', 'cycle', 'medication',
    ];
    const unsubs = namespaces.map((ns) => store.subscribeKey(ns, 'patterns', refresh));
    unsubs.push(store.subscribeKey('shared', 'patterns', refresh));
    unsubs.push(store.subscribeKey('shared', 'capacity', refresh));
    unsubs.push(store.subscribeKey('brain', 'harmEventCount', refresh));
    return () => unsubs.forEach((u) => u());
  }, [refresh]);

  return { noticings, refresh };
}

export function TodayNoticings(): JSX.Element | null {
  const { noticings, refresh } = useTodaysNoticings();

  const onPostpone = useCallback(
    (n: ScoredNoticing) => {
      void postponeNoticing({ id: n.id, module: n.module, category: n.category ?? null }).then(refresh);
    },
    [refresh],
  );

  const onDismiss = useCallback(
    (n: ScoredNoticing) => {
      void dismissNoticing(n.id).then(refresh);
    },
    [refresh],
  );

  // Renders NOTHING when there's nothing worth her attention — no empty-state
  // box, no "all clear" badge. Silence is the default (Serra: minimal UI).
  if (noticings.length === 0) return null;

  return (
    <Stack gap={space[2]} style={{ marginTop: space[6] }}>
      <Text scale="caption" color={colors.sage} style={KICKER_STYLE}>
        worth a glance
      </Text>

      {noticings.map((n) => (
        <div
          key={n.id}
          style={{
            background: colors.paper,
            border: `1px solid ${colors.hairlineSoft}`,
            borderRadius: radii.md,
            padding: `${space[4]} ${space[5]}`,
          }}
        >
          <Text scale="body" color={colors.ink} style={{ lineHeight: lineHeights.lede }}>
            {n.copy}
          </Text>

          <div style={{ display: 'flex', gap: space[4], marginTop: space[3] }}>
            <button
              type="button"
              onClick={() => onPostpone(n)}
              style={affordanceStyle}
            >
              not now
            </button>
            <button
              type="button"
              onClick={() => onDismiss(n)}
              style={{ ...affordanceStyle, color: colors.inkFaint }}
            >
              dismiss
            </button>
          </div>
        </div>
      ))}
    </Stack>
  );
}

const affordanceStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: colors.sage,
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
  fontSize: fontSizes.caption,
};
