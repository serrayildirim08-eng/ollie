/**
 * apps/native · patterns/PatternCards.tsx
 *
 * The presentational "bulletin board" — soft editorial notes that surface a
 * module's computed Layer-2 patterns inside its Box. This is the ONE thing
 * module agents drop into each Box screen:
 *
 *     import { PatternCards } from '../../patterns/PatternCards';
 *     …
 *     <PatternCards module="body" />
 *
 * Behaviour:
 *   - Reads patterns reactively via usePatterns(module).
 *   - Renders NOTHING when there are no patterns (no empty-state box).
 *   - Each card is a quiet, dismissible note. Dismissal is local/session
 *     only (a calm "noted" gesture) — it does not mutate the store, so a
 *     recomputed pattern can resurface later. No persistence by design:
 *     the watcher owns the data; the user just tidies the surface.
 *
 * Design constraints (Ollie DNA · enforced here so module agents can't drift):
 *   - cream/paper surface, sage ink. NO red, NO amber, NO severity colour.
 *   - NO push, NO streak, NO score, NO count badges.
 *   - soft hairline, generous padding, one editorial sentence per card.
 *   These are "noticings", not alerts.
 */

import { useMemo, useState } from 'react';
import { Stack } from '../layout';
import { Text } from '../ui';
import { colors, fontSizes, lineHeights, space, radii, letterSpacings } from '../theme/tokens';
import { usePatterns, type PatternCard } from './usePatterns';

export interface PatternCardsProps {
  /** Module id, e.g. 'body' | 'work' | 'dump'. Maps to its patterns store key. */
  module: string;
  /** Optional cap on how many cards to show at once. Default 4 (calm). */
  max?: number;
}

/**
 * Modules whose patterns are ADHD-behaviour noticings — these may carry a
 * research citation. Practical domains (grocery, finance, pets, cycle, sleep)
 * are deliberately excluded: a spoilage/spend nudge citing a neuropsych paper
 * is irrelevant clutter.
 */
const CITATION_MODULES = new Set(['work', 'goals', 'habits', 'body']);

/** Pull the displayable sentence out of a tolerant detector card. */
function cardCopy(card: PatternCard): string {
  return (card.copy ?? card.body ?? card.message ?? '').toString().trim();
}

/** Pull a stable-ish key for React + dismissal from a card. */
function cardKey(card: PatternCard, index: number): string {
  if (typeof card.pattern === 'string' && card.pattern) return card.pattern;
  const copy = cardCopy(card);
  return copy ? `copy:${copy}` : `idx:${index}`;
}

/** Normalise the optional source/citation into a single short trace string. */
function cardSource(card: PatternCard): string | null {
  if (typeof card.source === 'string') return card.source.trim() || null;
  if (card.source && typeof card.source === 'object') {
    return (card.source.citation ?? card.source.url ?? '').trim() || null;
  }
  return (card.citation ?? '').trim() || null;
}

export function PatternCards({ module, max = 4 }: PatternCardsProps): JSX.Element | null {
  const all = usePatterns(module);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const visible = useMemo(() => {
    return all
      .map((card, index) => ({ card, key: cardKey(card, index) }))
      .filter(({ card, key }) => cardCopy(card).length > 0 && !dismissed.has(key))
      .slice(0, max);
  }, [all, dismissed, max]);

  if (visible.length === 0) return null;

  return (
    <Stack gap={space[2]} style={{ marginTop: space[6] }}>
      {visible.map(({ card, key }) => {
        // Citations belong to ADHD-behaviour noticings (work / goals / habits /
        // body), where a research trace is meaningful. Practical-domain cards
        // (grocery, finance, pets…) are common-sense noticings — a "chicken
        // turns soon" nudge citing a neuropsych paper reads as nonsense, so we
        // never show a source trace for them.
        const source = CITATION_MODULES.has(module) ? cardSource(card) : null;
        return (
          <div
            key={key}
            style={{
              position: 'relative',
              background: colors.paper,
              border: `1px solid ${colors.hairlineSoft}`,
              borderRadius: radii.md,
              padding: `${space[4]} ${space[5]}`,
            }}
          >
            {card.title ? (
              <Text
                scale="caption"
                color={colors.sage}
                style={{
                  display: 'block',
                  textTransform: 'uppercase',
                  letterSpacing: letterSpacings.caps,
                  fontSize: fontSizes.kicker,
                  marginBottom: space[1],
                }}
              >
                {String(card.title)}
              </Text>
            ) : null}

            <Text
              scale="body"
              color={colors.ink}
              style={{ lineHeight: lineHeights.lede, paddingRight: space[6] }}
            >
              {cardCopy(card)}
            </Text>

            {source ? (
              <Text
                scale="caption"
                color={colors.inkFaint}
                style={{ display: 'block', marginTop: space[2], fontSize: fontSizes.caption }}
              >
                {source}
              </Text>
            ) : null}

            <button
              type="button"
              aria-label="Dismiss noticing"
              onClick={() =>
                setDismissed((prev) => {
                  const next = new Set(prev);
                  next.add(key);
                  return next;
                })
              }
              style={{
                position: 'absolute',
                top: space[2],
                right: space[3],
                background: 'transparent',
                border: 'none',
                color: colors.inkFaint,
                cursor: 'pointer',
                fontSize: fontSizes.body,
                lineHeight: 1,
                padding: space[1],
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </Stack>
  );
}
