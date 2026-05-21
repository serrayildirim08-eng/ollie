/**
 * RecipeCard — one Feed Me v2 suggestion, rendered Atelier-style.
 *
 * The 3-card stack on the Feed Me face renders one of these per
 * `RecipeSuggestion`. Layout mirrors the single-recipe `FoundRecipe` block
 * the v1 view shipped, lifted into a card primitive so the new stack reads
 * as a small typographic editorial spread:
 *
 *   dish (32px Fraunces-equivalent light)
 *   cuisine subtitle (13px mute)
 *   coverage pip row · "you have 4 of 6"
 *   reasonSuggested line (soon-reframe style, when present)
 *   ingredients · in your pantry (have)
 *   ingredients · you'd need     (missing)
 *   action row · [add missing]  [I cooked this]  [× not this]
 *
 * No emoji. No ASCII arrows. Reject button uses `IconCross`. All buttons
 * have explicit aria-labels. Reduced-motion respected.
 *
 * The card lives in `apps/web/src/components` — not in grocery-v2 — because
 * the same primitive will reappear in the pet-feed face once /pets gets a
 * "feed plan" mode; keeping it module-agnostic avoids a fork later.
 */
import { useMemo } from 'react';
import {
  AmberButton,
  IconPlus,
  IconCheck,
  IconCross,
  v2,
} from '../modules/money-v2/v2';
import type { RecipeSuggestion } from '../hooks/useFeedMe';
import { useReducedMotion } from '../hooks/useReducedMotion';

export interface RecipeCardProps {
  suggestion: RecipeSuggestion;
  /** open the cook-rating modal then write cook_history with the rating */
  onCook: () => void;
  /** suppress this dish, refetch with excludeDishes */
  onReject: () => void;
  /** add the missing ingredient names to the shopping list */
  onAddMissing: (names: string[]) => void;
  /** when this card's "add" action has already been used in this session */
  added?: boolean;
}

export function RecipeCard({
  suggestion,
  onCook,
  onReject,
  onAddMissing,
  added = false,
}: RecipeCardProps) {
  const reduced = useReducedMotion();

  const { have, missing, missingNames, total, haveCount } = useMemo(() => {
    const have = suggestion.ingredients.filter((i) => i.have);
    const missing = suggestion.ingredients.filter((i) => !i.have);
    const missingNames = missing.map((m) => m.canonical ?? m.name);
    const total = suggestion.ingredients.length;
    return {
      have,
      missing,
      missingNames,
      total,
      haveCount: have.length,
    };
  }, [suggestion.ingredients]);

  const totalMinutes = suggestion.prepMinutes + suggestion.cookMinutes;

  return (
    <article
      aria-label={`recipe suggestion · ${suggestion.dish}`}
      style={{
        boxSizing: 'border-box',
        marginTop: 22,
        padding: '24px 22px 22px',
        background: v2.card,
        border: `1px solid ${v2.line}`,
        borderRadius: 18,
        boxShadow: v2.cardShadow,
        // when reduced-motion is on we strip the soft float entrance shadow
        // (purely visual). content unchanged.
        transition: reduced ? 'none' : 'box-shadow 220ms ease-out',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* dish */}
      <div
        style={{
          fontSize: 32,
          fontWeight: 300,
          color: v2.ink,
          letterSpacing: '-0.03em',
          lineHeight: 1.1,
        }}
      >
        {suggestion.dish}
      </div>

      {/* cuisine + time caption */}
      <div
        style={{
          marginTop: 6,
          fontSize: 13,
          color: v2.mute,
          fontWeight: 500,
          letterSpacing: '0.02em',
        }}
      >
        {suggestion.cuisine}
        {totalMinutes > 0 && (
          <>
            {' · '}
            {`about ${totalMinutes} minutes`}
          </>
        )}
        {suggestion.servings > 0 && (
          <>
            {' · '}
            {`${suggestion.servings} serving${suggestion.servings === 1 ? '' : 's'}`}
          </>
        )}
      </div>

      {/* coverage pip row */}
      <div
        style={{
          marginTop: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
          aria-label={`you have ${haveCount} of ${total} ingredients`}
          role="img"
        >
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              aria-hidden
              style={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                background: i < haveCount ? v2.sage : 'transparent',
                border:
                  i < haveCount ? 'none' : `1.8px solid ${v2.line}`,
                boxSizing: 'border-box',
              }}
            />
          ))}
        </div>
        <span
          style={{
            fontSize: 13,
            color: v2.ink,
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          {`you have ${haveCount} of ${total}`}
        </span>
      </div>

      {/* reasonSuggested — the soon-reframe line */}
      {suggestion.reasonSuggested && (
        <div
          style={{
            marginTop: 13,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: v2.sage,
              flexShrink: 0,
              marginTop: 5,
            }}
          />
          <span
            style={{
              fontSize: 13,
              color: v2.ink,
              fontWeight: 500,
              lineHeight: 1.5,
              letterSpacing: '-0.01em',
            }}
          >
            {suggestion.reasonSuggested}
          </span>
        </div>
      )}

      {/* ingredient split */}
      {have.length > 0 && (
        <IngredientList label="in your pantry" rows={have} />
      )}
      {missing.length > 0 && (
        <IngredientList label="you'd need" rows={missing} />
      )}

      {/* action row */}
      <div
        style={{
          marginTop: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {missingNames.length > 0 && (
          <AmberButton
            icon={<IconPlus size={18} weight={2.4} />}
            onClick={() => {
              if (added) return;
              onAddMissing(missingNames);
            }}
            aria-label={
              added
                ? 'added to shopping list'
                : `add the ${missingNames.length} missing to the list`
            }
            style={{ height: 50, borderRadius: 25 }}
          >
            {added
              ? 'added to the list'
              : `add the ${missingNames.length} missing to the list`}
          </AmberButton>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            justifyContent: 'center',
            paddingTop: missingNames.length > 0 ? 4 : 0,
          }}
        >
          <button
            type="button"
            onClick={onCook}
            aria-label={`I cooked ${suggestion.dish}`}
            style={{
              boxSizing: 'border-box',
              padding: '8px 14px',
              background: 'transparent',
              border: `1px solid ${v2.line}`,
              borderRadius: 16,
              color: v2.ink,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            I cooked this
          </button>
          <button
            type="button"
            onClick={onReject}
            aria-label={`not this · skip ${suggestion.dish}`}
            style={{
              boxSizing: 'border-box',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              color: v2.mute,
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '0.02em',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <IconCross size={11} weight={2} />
            not this
          </button>
        </div>
      </div>
    </article>
  );
}

// ─── one ingredient sub-list ─────────────────────────────────────────────────

interface IngredientListProps {
  label: string;
  rows: RecipeSuggestion['ingredients'];
}

function IngredientList({ label, rows }: IngredientListProps) {
  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          fontSize: 11,
          color: v2.mute,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      {rows.map((row, i) => (
        <div
          key={`${row.name}-${i}`}
          style={{
            boxSizing: 'border-box',
            borderTop: `1px solid ${v2.line}`,
            borderBottom:
              i === rows.length - 1 ? `1px solid ${v2.line}` : 'none',
            padding: '12px 2px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: row.have ? v2.sage : 'transparent',
              border: row.have ? 'none' : `1.8px solid ${v2.line}`,
              boxSizing: 'border-box',
            }}
          >
            {row.have && <IconCheck size={10} weight={3.4} stroke="#fff" />}
          </span>
          <span
            style={{
              flex: 1,
              fontSize: 14,
              color: row.have ? v2.ink : v2.mute,
              fontWeight: 500,
              letterSpacing: '-0.01em',
            }}
          >
            {row.name}
          </span>
          {row.qty != null && row.unit && (
            <span
              style={{
                fontSize: 12,
                color: v2.mute,
                fontWeight: 500,
                letterSpacing: '0.02em',
              }}
            >
              {row.qty} {row.unit}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
