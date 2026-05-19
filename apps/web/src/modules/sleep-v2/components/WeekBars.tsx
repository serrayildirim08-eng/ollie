/**
 * sleep-v2 · <WeekBars> — the n-night sleep bar visual
 *
 * The signature sleep visual (sleep.html / sleep-cold.html / sleep-history
 * .html): calm ink bars on a hairline baseline rule, the most recent night
 * in amber. An empty "not yet" night is a faint dashed-outline placeholder
 * — never a zero-height bar — so a cold chart reads "filling up", never
 * broken.
 *
 * It is a sleep-v2-local component (the bar grammar is sleep-specific) and
 * is reused by the face (7 nights, compact) and history (14 nights, tall).
 * Bars take a 0..1 `fill`; the caller's selectors own the duration→fill map.
 */
import { v2 } from '../../money-v2/v2';

/** the minimal bar shape WeekBars renders — `WeekBar` + `HistoryNight` satisfy it */
export interface BarDatum {
  /** a stable react key */
  key: string;
  /** 0..1 height fill */
  fill: number;
  /** the most-recent bar — tints amber */
  isLast: boolean;
  /** an empty "not yet" slot — a dashed placeholder. defaults to false */
  empty?: boolean;
}

export interface WeekBarsProps {
  /** the bars, oldest first, most-recent last */
  bars: BarDatum[];
  /** the height of a full (fill === 1) bar, in px */
  maxHeight: number;
  /** bar width in px; default 11 (the face). history passes a flex bar */
  barWidth?: number;
  /** gap between bars in px */
  gap?: number;
  /** when true, bars flex to fill the row (the history chart) */
  flex?: boolean;
}

/** the smallest a real bar is allowed to draw, so a short night stays visible */
const MIN_BAR = 16;

export function WeekBars({
  bars,
  maxHeight,
  barWidth = 11,
  gap = 9,
  flex = false,
}: WeekBarsProps) {
  return (
    <div
      role="img"
      aria-label="recent nights of sleep, by duration"
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'flex-end',
        gap,
        height: maxHeight + 8,
        paddingBottom: 6,
        position: 'relative',
        width: flex ? '100%' : undefined,
      }}
    >
      {/* the baseline rule */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 4,
          height: 1.5,
          borderRadius: 1,
          background: v2.line,
        }}
      />
      {bars.map((b) => {
        if (b.empty) {
          return (
            <span
              key={b.key}
              aria-hidden
              style={{
                boxSizing: 'border-box',
                width: flex ? undefined : barWidth,
                flex: flex ? 1 : undefined,
                height: Math.round(maxHeight * 0.36),
                borderRadius: 3,
                border: `1.5px dashed ${v2.line}`,
                background: 'transparent',
                position: 'relative',
                zIndex: 1,
              }}
            />
          );
        }
        const h = Math.max(MIN_BAR, Math.round(maxHeight * b.fill));
        return (
          <span
            key={b.key}
            aria-hidden
            style={{
              boxSizing: 'border-box',
              width: flex ? undefined : barWidth,
              flex: flex ? 1 : undefined,
              height: h,
              borderRadius: 3,
              background: b.isLast ? v2.accent : v2.mute,
              position: 'relative',
              zIndex: 1,
            }}
          />
        );
      })}
    </div>
  );
}
