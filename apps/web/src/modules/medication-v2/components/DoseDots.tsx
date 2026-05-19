/**
 * medication-v2 · <DoseDots> — the day's dose dots (medication.html)
 *
 * One small dot per scheduled dose today. Verbatim from the mockups:
 *   - done   — a filled sage dot
 *   - now    — an amber ring + soft amber glow (the live dose)
 *   - ahead  — a faint hairline ring
 * When no med is scheduled at all, the cold form shows two faint dashed
 * placeholders (medication-cold.html) — pass `cold` for that.
 *
 * No streak, no running total to beat — a quiet glance, nothing more.
 */
import { v2 } from '../../money-v2/v2';
import type { DoseDotState } from '../selectors';

export interface DoseDotsProps {
  /** one state per scheduled dose today */
  dots: DoseDotState[];
  /** the cold form — two faint dashed placeholders */
  cold?: boolean;
}

const DOT = 13;

export function DoseDots({ dots, cold = false }: DoseDotsProps) {
  if (cold || dots.length === 0) {
    return (
      <div
        aria-hidden
        style={{ display: 'flex', alignItems: 'center', gap: 13 }}
      >
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
      style={{ display: 'flex', alignItems: 'center', gap: 13, flexWrap: 'wrap', justifyContent: 'center' }}
    >
      {dots.map((state, i) => {
        const base = {
          boxSizing: 'border-box' as const,
          width: DOT,
          height: DOT,
          borderRadius: '50%',
        };
        if (state === 'done') {
          return <span key={i} style={{ ...base, background: v2.sage }} />;
        }
        if (state === 'now') {
          return (
            <span
              key={i}
              style={{
                ...base,
                border: `2.2px solid ${v2.accent}`,
                boxShadow: '0 4px 12px rgba(201,146,62,.24)',
              }}
            />
          );
        }
        return (
          <span key={i} style={{ ...base, border: `1.6px solid ${v2.line}` }} />
        );
      })}
    </div>
  );
}
