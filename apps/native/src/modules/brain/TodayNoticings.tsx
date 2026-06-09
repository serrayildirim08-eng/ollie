/**
 * apps/native · modules/brain/TodayNoticings.tsx
 *
 * The cross-life "today" surface — Sprint 2's PRIMARY brain surface. Instead
 * of every detector dropping its own card into its Box (a nag-wall), this is
 * the ONE calm place that shows the top 2–3 noticings across her WHOLE life,
 * chosen by the selection discipline (modules/brain/noticings.ts → the pure
 * @ollie/logic/brain selector).
 *
 * Sprint 3 — "speak in your words":
 *   - the sentence is AI-generated, situation-fitted, in the user's APP
 *     language (resolveNoticingCopy → cached once per noticing/day/lang,
 *     trilingual hardcoded FALLBACK when the AI is off — never blank).
 *   - when a noticing offers an action ("want it back on the list?"), an
 *     accept affordance runs it FOR REAL (executeAction — milk → grocery
 *     shopping add) and then clears that noticing.
 *
 * Each note also keeps a gentle "not now" (postpone — comes back in a day) and
 * a quieter "dismiss" (gone for good). Postpone + dismiss persist in SQLite.
 *
 * Design (Ollie DNA — matches PatternCards' grammar exactly):
 *   - cream/paper surface, sage kicker, one editorial sentence per note.
 *   - NO red / severity / badges / streaks / counts. NO shame.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import type { ScoredNoticing, NoticingAction } from '@ollie/logic/brain';
import { Stack } from '../../layout';
import { Text } from '../../ui';
import { colors, fontSizes, lineHeights, space, radii, letterSpacings } from '../../theme/tokens';
import { store } from '../../store';
import { useAppLang } from '../../settings/appLang';
import { selectTodaysNoticings, postponeNoticing, dismissNoticing } from './noticings';
import { resolveNoticingCopy, actionForNoticing } from './copy';
import { executeAction } from './actions';

const KICKER_STYLE: React.CSSProperties = {
  display: 'block',
  textTransform: 'uppercase',
  letterSpacing: letterSpacings.caps,
  fontSize: fontSizes.kicker,
  marginBottom: space[1],
};

/** A noticing as the surface renders it: the scored note + resolved copy + action. */
interface RenderableNoticing {
  noticing: ScoredNoticing;
  copy: string;
  action: NoticingAction | null;
}

/**
 * Recompute the cross-life selection whenever a noticing source changes. We
 * subscribe to the store keys the selection reads (every `<ns>.patterns`,
 * `shared.patterns`, `shared.capacity`, the app-language setting) plus an
 * internal bump after a postpone/dismiss/accept, and re-run the async select
 * THEN resolve each note's AI copy (cached once per noticing/day/lang).
 *
 * Best-effort: a failure yields an empty surface, never a throw. The copy
 * always resolves (AI or trilingual fallback), so a note is never blank.
 */
function useTodaysNoticings(getBearer: () => Promise<string | null>): {
  items: RenderableNoticing[];
  refresh: () => void;
} {
  const [items, setItems] = useState<RenderableNoticing[]>([]);
  const lang = useAppLang();

  const refresh = useCallback(() => {
    void (async () => {
      try {
        const selected = await selectTodaysNoticings(store);
        // One bearer fetch per refresh; resolveNoticingCopy falls back to the
        // trilingual hardcoded sentence when it's null/empty.
        const bearer = await getBearer().catch(() => null);
        const resolved = await Promise.all(
          selected.map(async (noticing) => ({
            noticing,
            copy: await resolveNoticingCopy(noticing, { lang, bearer }),
            action: actionForNoticing(noticing, lang),
          })),
        );
        setItems(resolved);
      } catch {
        setItems([]);
      }
    })();
  }, [getBearer, lang]);

  useEffect(() => {
    refresh();
    // The selection reads each module's patterns + shared.patterns + capacity;
    // copy reads the app-language setting (useAppLang re-renders on its own).
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

  return { items, refresh };
}

export function TodayNoticings(): JSX.Element | null {
  const { getToken } = useAuth();
  const getBearer = useCallback(async () => (await getToken().catch(() => null)) ?? null, [getToken]);
  const { items, refresh } = useTodaysNoticings(getBearer);

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

  // Accept the offer: DO the thing for real, then clear the noticing (a done
  // offer never resurfaces). If the action fails we leave the note in place.
  const onAccept = useCallback(
    (item: RenderableNoticing) => {
      if (!item.action) return;
      void executeAction(item.action).then((ok) => {
        if (ok) void dismissNoticing(item.noticing.id).then(refresh);
      });
    },
    [refresh],
  );

  // Renders NOTHING when there's nothing worth her attention — no empty-state
  // box, no "all clear" badge. Silence is the default (Serra: minimal UI).
  if (items.length === 0) return null;

  return (
    <Stack gap={space[2]} style={{ marginTop: space[6] }}>
      <Text scale="caption" color={colors.sage} style={KICKER_STYLE}>
        worth a glance
      </Text>

      {items.map((item) => (
        <div
          key={item.noticing.id}
          style={{
            background: colors.paper,
            border: `1px solid ${colors.hairlineSoft}`,
            borderRadius: radii.md,
            padding: `${space[4]} ${space[5]}`,
          }}
        >
          <Text scale="body" color={colors.ink} style={{ lineHeight: lineHeights.lede }}>
            {item.copy}
          </Text>

          <div style={{ display: 'flex', gap: space[4], marginTop: space[3] }}>
            {item.action && (
              <button
                type="button"
                onClick={() => onAccept(item)}
                style={{ ...affordanceStyle, color: colors.ink, fontWeight: 600 }}
              >
                {item.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => onPostpone(item.noticing)}
              style={affordanceStyle}
            >
              not now
            </button>
            <button
              type="button"
              onClick={() => onDismiss(item.noticing)}
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
