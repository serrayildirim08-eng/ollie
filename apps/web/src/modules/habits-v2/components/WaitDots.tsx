/**
 * habits-v2 · <WaitDots> — the day's waiting-dot row (habits.html)
 *
 * One small dot per habit on file today, in day order. Verbatim from
 * habits.html / habits-cold.html:
 *   - done    — a soft sage dot (a habit checked in today)
 *   - now     — an ink dot (the single next check-in, the current hero)
 *   - waiting — a faint line dot (a habit still waiting for its cue)
 *
 * It counts what WAITS — never what was missed, never a streak. A quiet
 * glance, nothing more. When there are no habits at all, it shows two
 * faint dashed placeholders so the face is never blank.
 */
import { v2 } from '../../money-v2/v2';
import type { WaitDotState } from '../selectors';

export interface WaitDotsProps {
  /** one state per habit on file today, in day order */
  dots: WaitDotState[];
}

const DOT = 9;

export function WaitDots({ dots }: WaitDotsProps) {
  if (dots.length === 0) {
    return (
      <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        {[0, 1].map((i) => (
          <span
            key={i}
            style={{
              boxSizing: 'border-box',
              width: DOT,
              height: DOT,
              borderRadius: '50%',
              background: 'transparent',
              border: `1.5px dashed ${v2.line}`,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      aria-hidden
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}
    >
      {dots.map((state, i) => {
        const bg =
          state === 'done' ? v2.sage : state === 'now' ? v2.ink : v2.line;
        return (
          <span
            key={i}
            style={{
              boxSizing: 'border-box',
              width: DOT,
              height: DOT,
              borderRadius: '50%',
              background: bg,
            }}
          />
        );
      })}
    </div>
  );
}
