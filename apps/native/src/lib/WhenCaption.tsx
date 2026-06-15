/**
 * WhenCaption · the universal "when" sub-caption under every Box row.
 *
 * Every module's entry rows render this beneath the primary label so
 * Serra can spot patterns at a glance ("I keep dumping milk on Sundays").
 * The grammar is locked in `./formatRelativeTime`; this component just
 * wires the formatter to the editorial caption type — small, faint, a
 * touch wider letter-spacing so the metadata reads as metadata, not
 * body.
 *
 * Renders nothing when `ts` doesn't resolve to a real instant — keeps
 * the row visual clean rather than carrying an empty caption slot.
 */

import type { CSSProperties } from 'react';
import { formatRelativeTime } from './formatRelativeTime';

const WHEN_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--ollie-color-ink-faint)',
  fontWeight: 400,
  letterSpacing: '0.02em',
  lineHeight: 1.4,
};

export function WhenCaption({
  ts,
  style,
}: {
  ts: number | null | undefined;
  style?: CSSProperties;
}): JSX.Element | null {
  const text = formatRelativeTime(ts);
  if (!text) return null;
  return <span style={{ ...WHEN_STYLE, ...style }}>{text}</span>;
}
