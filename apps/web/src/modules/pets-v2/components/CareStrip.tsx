/**
 * pets-v2 · <CareStrip> — the tailored 30-day care strip
 *
 * Verbatim from the approved pets.html / pets-profile.html mockups: 30 tiny
 * dots in a row, one per day, oldest-left. A filled sage dot is a day with
 * care logged; a hollow line dot is a day with none; a soft warm dot is a
 * "gap" — a day before the pet joined the notebook. A real little data
 * object, never decorative.
 *
 * `size` switches between the roster strip (compact, 6px) and the profile
 * strip (scaled up, 8px).
 */
import { v2 } from '../../money-v2/v2';
import type { StripDay } from '../selectors';

export interface CareStripProps {
  /** 30 cells, oldest-left, today rightmost */
  days: StripDay[];
  /** 'sm' — the roster strip · 'lg' — the profile strip */
  size?: 'sm' | 'lg';
}

const GAP_FILL = '#F0E6D2';

export function CareStrip({ days, size = 'sm' }: CareStripProps) {
  const dot = size === 'lg' ? 8 : 6;
  const gap = size === 'lg' ? 4 : 3;
  return (
    <div
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        gap,
        alignItems: 'center',
        flexWrap: 'nowrap',
      }}
      aria-hidden
    >
      {days.map((d, i) => (
        <span
          key={i}
          style={{
            width: dot,
            height: dot,
            borderRadius: '50%',
            flexShrink: 0,
            background:
              d === 'on' ? v2.sage : d === 'gap' ? GAP_FILL : v2.line,
          }}
        />
      ))}
    </div>
  );
}
