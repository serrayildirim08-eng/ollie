/**
 * RecipeDetail — the "show me how ›" drill-in screen.
 *
 * The reading surface for one recipe. Unlike the olive-neumorphic list, the
 * detail sits on a calm CREAM/PAPER sheet — a recipe is content you READ, like
 * an article (design locked 2026-06-23, mock ollie-recipe-instructive.html):
 *   - serif dish title + a one-line meta ("15 min · serves 2 · 4 of 5 on your
 *     shelf") — no repeated "in your pantry".
 *   - an optional "before you start" prep strip (pan / heat / hands-on).
 *   - ingredients as a quiet hairline list: have → tiny filled olive dot;
 *     need → hollow ring + a tap-to-"add to list" link.
 *   - HOW as a timeline rail of connected beads; each step is an action plus a
 *     "look for →" / "done when →" sensory cue (no guessing) and an optional tip.
 *   - "i cooked it ✓" pinned at the bottom.
 *
 * Instructive content (cues/tips/prep) comes from `suggestion.stepsDetailed` +
 * `suggestion.prep` when the worker produced them; otherwise we map the plain
 * `steps: string[]` into bare action rows so the screen still works.
 */

import { useState } from 'react';
import { Stack, Row } from '../../layout';
import { Text } from '../../ui';
import { colors, fonts } from '../../theme/tokens';
import type { FeedRecipeStep, FeedRecipeSuggestion } from '../../api/types';

const PAPER = '#f4f1e8';
const PAPER_LINE = 'rgba(86,90,60,0.16)';

const SMCP: React.CSSProperties = {
  fontVariantCaps: 'all-small-caps',
  letterSpacing: '0.08em',
};

export function RecipeDetail({
  suggestion,
  cooked,
  onCookedIt,
  shopNames,
  onAddToShop,
  onBack,
}: {
  suggestion: FeedRecipeSuggestion;
  cooked: boolean;
  onCookedIt: () => void;
  shopNames?: Set<string>;
  onAddToShop?: (name: string, quantity?: number | null, unit?: string | null) => void;
  onBack: () => void;
}): JSX.Element {
  const totalMin = suggestion.prepMinutes + suggestion.cookMinutes;
  const haveCount = suggestion.ingredients.filter((i) => i.have).length;
  const totalIng = suggestion.ingredients.length;

  // Prefer the instructive steps; fall back to bare action rows.
  const steps: FeedRecipeStep[] =
    suggestion.stepsDetailed && suggestion.stepsDetailed.length > 0
      ? suggestion.stepsDetailed
      : suggestion.steps.map((s) => ({ do: s }));

  const [addedNames, setAddedNames] = useState<Set<string>>(() => new Set());
  const isAdded = (name: string): boolean =>
    addedNames.has(name.toLowerCase()) || (shopNames?.has(name.toLowerCase()) ?? false);

  return (
    <div
      style={{
        background: PAPER,
        borderRadius: 28,
        boxShadow: '0 18px 40px rgba(70,86,50,0.18)',
        padding: '22px 22px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      {/* back */}
      <button
        type="button"
        onClick={onBack}
        style={{
          appearance: 'none',
          background: 'transparent',
          border: 'none',
          padding: '0 0 14px',
          margin: 0,
          textAlign: 'left',
          cursor: 'pointer',
          color: colors.inkSoft,
          fontSize: 13,
        }}
      >
        ‹ feed me
      </button>

      {/* hero */}
      <span
        style={{
          fontFamily: fonts.serif,
          fontSize: 30,
          lineHeight: 1.05,
          letterSpacing: '-0.015em',
          fontWeight: 400,
          color: colors.ink,
        }}
      >
        {suggestion.dish}
      </span>
      <span style={{ marginTop: 9, fontSize: 11, color: colors.inkFaint, ...SMCP }}>
        {totalMin > 0 ? `${totalMin} min` : 'a few minutes'}
        {suggestion.servings > 0 ? ` · serves ${suggestion.servings}` : ''}
        {totalIng > 0 ? ` · ${haveCount} of ${totalIng} on your shelf` : ''}
      </span>

      {/* before-you-start prep strip */}
      {suggestion.prep && hasPrep(suggestion.prep) && (
        <Row gap={22} style={{ marginTop: 16, flexWrap: 'wrap' }}>
          {suggestion.prep.pan && <PrepCell k="pan" v={suggestion.prep.pan} />}
          {suggestion.prep.heat && <PrepCell k="heat" v={suggestion.prep.heat} />}
          {typeof suggestion.prep.handsOnMinutes === 'number' && (
            <PrepCell k="hands-on" v={`~${suggestion.prep.handsOnMinutes} min`} />
          )}
        </Row>
      )}

      <Rule />

      {/* ingredients */}
      {suggestion.ingredients.length > 0 && (
        <>
          <span style={{ fontSize: 11, color: colors.inkFaint, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            what you need
          </span>
          <Stack gap={0} style={{ marginTop: 8 }}>
            {suggestion.ingredients.map((ing, i) => {
              const label = [ing.qty ? String(ing.qty) : '', ing.unit ?? '', ing.name]
                .filter(Boolean)
                .join(' ');
              const added = isAdded(ing.name);
              const canAdd = !ing.have && !added && !!onAddToShop;
              return (
                <Row
                  key={`${ing.name}-${i}`}
                  align="center"
                  gap={12}
                  style={{
                    padding: '12px 2px',
                    borderBottom:
                      i === suggestion.ingredients.length - 1
                        ? 'none'
                        : `1px solid ${PAPER_LINE}`,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: ing.have ? colors.sageDeep : 'transparent',
                      border: ing.have ? 'none' : `1.5px solid ${colors.inkFaint}`,
                    }}
                  />
                  <Text scale="body" color={ing.have ? colors.ink : colors.inkSoft}>
                    {label}
                  </Text>
                  <span style={{ marginLeft: 'auto' }}>
                    {canAdd ? (
                      <button
                        type="button"
                        aria-label={`add ${ing.name} to shopping list`}
                        onClick={() => {
                          onAddToShop!(ing.name, ing.qty ?? null, ing.unit ?? null);
                          setAddedNames((prev) => new Set(prev).add(ing.name.toLowerCase()));
                        }}
                        style={{
                          appearance: 'none',
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          color: colors.sageDeep,
                          fontWeight: 600,
                          fontSize: 13,
                        }}
                      >
                        add to list +
                      </button>
                    ) : !ing.have ? (
                      <span style={{ fontSize: 11, color: colors.sage, fontWeight: 600, ...SMCP }}>
                        {added ? 'added' : 'need'}
                      </span>
                    ) : null}
                  </span>
                </Row>
              );
            })}
          </Stack>
          <Rule />
        </>
      )}

      {/* how — timeline */}
      {steps.length > 0 && (
        <>
          <span style={{ fontSize: 11, color: colors.inkFaint, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            how
          </span>
          <Stack gap={0} style={{ marginTop: 12 }}>
            {steps.map((step, i) => (
              <StepRow key={i} step={step} index={i} last={i === steps.length - 1} />
            ))}
          </Stack>
        </>
      )}

      {/* i cooked it — generous bottom margin + raised z-index so the bottom
          button always clears the fixed bottom tab bar's hit area (it was
          landing under the nav on tall recipes → taps went to the nav, not the
          button). position relative keeps it above any sibling in the stack. */}
      <button
        type="button"
        onClick={cooked ? undefined : onCookedIt}
        disabled={cooked}
        style={{
          position: 'relative',
          zIndex: 2,
          marginTop: 20,
          marginBottom: 32,
          appearance: 'none',
          border: 'none',
          borderRadius: 16,
          padding: '15px',
          textAlign: 'center',
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: '0.02em',
          touchAction: 'manipulation',
          cursor: cooked ? 'default' : 'pointer',
          background: cooked ? 'transparent' : colors.sageDeep,
          color: cooked ? colors.sage : '#f3f6ee',
          boxShadow: cooked ? 'none' : '0 10px 22px rgba(67,87,31,0.30)',
        }}
      >
        {cooked ? 'cooked ✓' : 'i cooked it ✓'}
      </button>
    </div>
  );
}

// ─── pieces ───────────────────────────────────────────────────────────────

function Rule(): JSX.Element {
  return <div style={{ height: 1, background: PAPER_LINE, margin: '20px 0 16px' }} />;
}

function hasPrep(p: NonNullable<FeedRecipeSuggestion['prep']>): boolean {
  return !!p.pan || !!p.heat || typeof p.handsOnMinutes === 'number';
}

function PrepCell({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <Stack gap={3}>
      <span style={{ fontSize: 10, color: colors.inkFaint, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        {k}
      </span>
      <Text scale="caption" color={colors.ink}>
        {v}
      </Text>
    </Stack>
  );
}

/** One timeline step: a connected bead rail + action + "look for →" cue + tip. */
function StepRow({
  step,
  index,
  last,
}: {
  step: FeedRecipeStep;
  index: number;
  last: boolean;
}): JSX.Element {
  return (
    <Row gap={16} align="stretch" style={{ paddingBottom: last ? 2 : 22 }}>
      {/* rail */}
      <div style={{ flex: '0 0 14px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span
          aria-hidden
          style={{
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: colors.sageDeep,
            flexShrink: 0,
            marginTop: 5,
          }}
        />
        {!last && <span style={{ width: 2, flex: '1 1 auto', background: PAPER_LINE, marginTop: 3 }} />}
      </div>
      {/* body */}
      <div style={{ flex: '1 1 auto' }}>
        <span style={{ fontSize: 10, color: colors.inkFaint, fontWeight: 700, ...SMCP }}>
          {`step ${index + 1}`}
          {typeof step.minutes === 'number' ? ` · ${step.minutes} min` : ''}
        </span>
        <div
          style={{
            fontFamily: fonts.serif,
            fontSize: 16,
            lineHeight: 1.45,
            color: colors.ink,
            marginTop: 3,
          }}
        >
          {step.do}
        </div>
        {step.cue && (
          <Row gap={8} align="baseline" style={{ marginTop: 6 }}>
            <span style={{ flexShrink: 0, color: colors.sageDeep, fontWeight: 700, fontSize: 12, ...SMCP }}>
              look for →
            </span>
            <Text scale="caption" color={colors.inkSoft}>
              {step.cue}
            </Text>
          </Row>
        )}
        {step.tip && (
          <div
            style={{
              marginTop: 9,
              background: '#ece7d6',
              borderRadius: 12,
              padding: '9px 12px',
              fontSize: 12.5,
              lineHeight: 1.4,
              color: colors.inkSoft,
            }}
          >
            <span style={{ color: colors.sageDeep, fontWeight: 700, ...SMCP }}>tip</span>
            {`  ${step.tip}`}
          </div>
        )}
      </div>
    </Row>
  );
}
