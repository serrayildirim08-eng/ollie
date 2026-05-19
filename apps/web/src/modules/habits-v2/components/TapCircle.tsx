/**
 * habits-v2 · <TapCircle> — the single-check-in tap target (habits.html)
 *
 * The act of checking ONE habit in. A soft, generous circle — a hairline
 * ink-track edge, a quiet amber check inside — verbatim from habits.html /
 * habits-cold.html. Tapping it checks the habit in for today; the next
 * habit then slides in as the new hero. Cold and warm are the SAME warm
 * circle: first run is a real, usable face, not a placeholder.
 *
 * When every habit is already done there is nothing to check in — the
 * circle becomes a calm, decorative "all in" mark (a non-interactive div,
 * a sage check), never a zero, never a streak counter, never a number.
 */
import { v2, IconCheck } from '../../money-v2/v2';

export interface TapCircleProps {
  /** is there a habit to check in? false = the calm decorative all-done mark */
  live: boolean;
  /** the tap handler — checks the next habit in; only used when `live` */
  onCheck?: () => void;
  /** an accessible name for the live tap target — the habit being checked */
  label?: string;
}

const SIZE = 150;

export function TapCircle({ live, onCheck, label }: TapCircleProps) {
  const ringStyle = {
    boxSizing: 'border-box' as const,
    width: SIZE,
    height: SIZE,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: v2.card,
    boxShadow: '0 16px 38px rgba(42,38,34,.07)',
  };

  if (!live) {
    // every habit is in — a quiet, decorative all-done mark, never a button
    return (
      <div
        aria-hidden
        style={{ ...ringStyle, border: `2px solid ${v2.line}` }}
      >
        <IconCheck size={50} weight={2.1} stroke={v2.sage} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onCheck}
      aria-label={label ? `check in — ${label}` : 'check this habit in'}
      style={{
        ...ringStyle,
        border: `2px solid ${v2.line}`,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <IconCheck size={50} weight={2.1} stroke={v2.accent} />
    </button>
  );
}
