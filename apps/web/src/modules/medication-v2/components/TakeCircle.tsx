/**
 * medication-v2 · <TakeCircle> — the next-dose tap target (medication.html)
 *
 * Habits' tap-circle scaled for one dose: a calm ring, the dose time
 * inside, a small lowercase cue under it. Two states, verbatim from the
 * mockups:
 *   - live   — a soft amber edge + amber glow, "tap when taken" cue. A real
 *              <button>: tapping it logs the dose.
 *   - cold   — an ink-outline ring (no amber), a quiet "–" inside, no cue.
 *              The mockup renders this when no med is on file; it is purely
 *              decorative (a non-interactive div), never a zero.
 *
 * No streaks, no scoring — the amber edge marks the LIVE action, never a
 * target to beat.
 */
import { v2 } from '../../money-v2/v2';

export interface TakeCircleProps {
  /** the dose time shown inside — "2:00pm", or "–" cold */
  time: string;
  /** the small lowercase cue under the time — "" hides it */
  cue: string;
  /** the live (amber) variant — tappable; cold variant is decorative */
  live: boolean;
  /** the tap handler — only used in the live variant */
  onTake?: () => void;
}

export function TakeCircle({ time, cue, live, onTake }: TakeCircleProps) {
  const inner = (
    <>
      <span
        style={{
          fontSize: live ? 30 : 40,
          fontWeight: live ? 300 : 200,
          color: live ? v2.ink : v2.mute,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {time}
      </span>
      {cue && (
        <span
          style={{
            fontSize: 11,
            color: live ? v2.accent : v2.mute,
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          {cue}
        </span>
      )}
    </>
  );

  const ringStyle = {
    boxSizing: 'border-box' as const,
    width: 164,
    height: 164,
    borderRadius: '50%',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: live ? 3 : 4,
  };

  if (!live) {
    // cold — a calm decorative ring, never a button (nothing to take)
    return (
      <div
        aria-hidden
        style={{
          ...ringStyle,
          border: `2px solid ${v2.line}`,
          background: v2.card,
          boxShadow: '0 14px 34px rgba(42,38,34,.06)',
        }}
      >
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onTake}
      aria-label={`log this dose — ${time}`}
      style={{
        ...ringStyle,
        border: `2.4px solid ${v2.accent}`,
        background: '#FCF6EA',
        boxShadow: '0 14px 34px rgba(201,146,62,.24)',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {inner}
    </button>
  );
}
