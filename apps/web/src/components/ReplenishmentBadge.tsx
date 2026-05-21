/**
 * <ReplenishmentBadge> — confidence-aware "days left" pill.
 *
 * The surface for the adaptive-replenishment system. Replaces every
 * hardcoded "2 weeks left" / "months left" string in the grocery v2
 * surfaces. The estimate carries its own confidence, and the badge
 * renders ACCORDINGLY — a static guess is italic + faded with a `~`
 * prefix, an observed cadence is solid + accent, low-data is in between.
 * Restraint: a static estimate is NEVER allowed to read as observed truth.
 *
 * Display logic (`daysLeft`):
 *   < 0   → "due now"          (umber severity, no prefix)
 *   < 3   → "{N} days left"    (umber, urgent)
 *   < 14  → "{N} days left"    (normal unit)
 *   < 60  → "{N} weeks left"   (round daysLeft/7)
 *   ≥ 60  → "{N} months left"  (round daysLeft/30)
 *
 * Confidence overlay:
 *   static    → italic + mute  + "~" prefix + cold-start tooltip
 *   low-data  → regular + ink  + "~" prefix + still-learning tooltip
 *   observed  → solid + accent + no prefix + "every X days" tooltip
 *
 * Atelier DNA: no emoji, no ASCII arrows, no SaaS pill chrome. The
 * "urgent" state lifts to v2.umber (the warm severity ink) — never red.
 * The badge respects `prefers-reduced-motion`: no transitions when the
 * OS asks for none.
 */

import { useMemo } from 'react';
import { v2 } from '../modules/money-v2/v2';
import { useReducedMotion } from '../hooks/useReducedMotion';
import type { ReplenishmentEstimate } from '../hooks/useReplenishment';

export interface ReplenishmentBadgeProps {
  estimate: ReplenishmentEstimate;
  /** optional className passthrough — tests + storybook decorators use it */
  className?: string;
}

// ─── unit + label ────────────────────────────────────────────────────────────

interface DaysLabel {
  /** the rendered text (without prefix) — "3 days left", "due now", … */
  text: string;
  /** true when the days bucket is past-due or under 3 days */
  urgent: boolean;
}

/** Round daysLeft into the appropriate unit. */
function daysLabel(daysLeft: number): DaysLabel {
  if (daysLeft < 0) return { text: 'due now', urgent: true };
  const d = Math.round(daysLeft);
  if (d < 3) {
    return {
      text: d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} left`,
      urgent: true,
    };
  }
  if (d < 14) return { text: `${d} days left`, urgent: false };
  if (d < 60) {
    const w = Math.round(d / 7);
    return { text: `${w} week${w === 1 ? '' : 's'} left`, urgent: false };
  }
  const m = Math.round(d / 30);
  return { text: `${m} month${m === 1 ? '' : 's'} left`, urgent: false };
}

/** Build the tooltip per confidence state. */
function buildTooltip(estimate: ReplenishmentEstimate): string {
  if (estimate.confidence === 'static') {
    return 'based on typical shelf life — buy a few times to teach me';
  }
  if (estimate.confidence === 'low-data') {
    return '1 purchase logged — still learning your pattern';
  }
  const n = estimate.sampleSize;
  const x = Math.round(estimate.medianIntervalDays);
  return `based on your last ${n} purchases (every ${x} days)`;
}

// ─── component ───────────────────────────────────────────────────────────────

export function ReplenishmentBadge({
  estimate,
  className,
}: ReplenishmentBadgeProps) {
  const reduceMotion = useReducedMotion();
  const { text, urgent } = useMemo(
    () => daysLabel(estimate.daysLeft),
    [estimate.daysLeft],
  );
  const tooltip = useMemo(() => buildTooltip(estimate), [estimate]);

  const isStatic = estimate.confidence === 'static';
  const isLowData = estimate.confidence === 'low-data';
  const isObserved = estimate.confidence === 'observed';

  // colour: urgent overrides confidence — a past-due item is always umber
  const color = urgent
    ? v2.umber
    : isObserved
      ? v2.accent
      : isStatic
        ? v2.mute
        : v2.ink;

  // weight: observed reads solid, low-data regular, static italic
  const fontWeight = isObserved ? 600 : isLowData ? 500 : 500;
  const fontStyle = isStatic ? 'italic' : 'normal';

  // a "~" prefix marks an estimate that is NOT yet observed
  const prefix = isObserved ? '' : '~';

  return (
    <span
      className={className}
      title={tooltip}
      aria-label={`${tooltip} · ${text}`}
      data-confidence={estimate.confidence}
      data-urgent={urgent ? 'true' : 'false'}
      style={{
        display: 'inline-block',
        fontSize: 13,
        fontWeight,
        fontStyle,
        fontFamily: v2.sans,
        letterSpacing: '-0.01em',
        color,
        whiteSpace: 'nowrap',
        transition: reduceMotion ? 'none' : 'color 180ms ease-out',
      }}
    >
      {prefix}
      {text}
    </span>
  );
}
