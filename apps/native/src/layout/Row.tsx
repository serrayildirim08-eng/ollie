/**
 * Row — horizontal flex row.
 *
 * Mirror of Stack but flex-direction: row.
 * Default gap: "md" (16px) — tighter than Stack because items sit side-by-side,
 * but still generous compared to typical 8px defaults.
 */

import React, { CSSProperties } from 'react';
import { space } from '../theme/tokens';

type SpaceKey = keyof typeof space;
type GapProp  = SpaceKey | (string & {}) | number;

export interface RowProps {
  /** Gap between children. Token key, number (px), or raw CSS. Default: "md" (16px). */
  gap?: GapProp;
  /** align-items. Default: "center" — most row content is center-aligned. */
  align?: CSSProperties['alignItems'];
  /** justify-content */
  justify?: CSSProperties['justifyContent'];
  /** Whether to wrap children (flex-wrap). Default: false. */
  wrap?: boolean;
  /** Reverse direction (row-reverse). Default: false. */
  reverse?: boolean;
  /** Additional inline styles */
  style?: CSSProperties;
  className?: string;
  children?: React.ReactNode;
  as?: React.ElementType;
}

function resolveGap(val: GapProp | undefined, fallback: string): string {
  if (val === undefined) return fallback;
  if (typeof val === 'number') return `${val}px`;
  if (val in space) return space[val as unknown as SpaceKey];
  return val as string;
}

export function Row({
  as: Tag = 'div',
  gap,
  align = 'center',
  justify,
  wrap = false,
  reverse = false,
  style,
  className,
  children,
}: RowProps) {
  const computed: CSSProperties = {
    display:        'flex',
    flexDirection:  reverse ? 'row-reverse' : 'row',
    gap:            resolveGap(gap, space[4]),
    alignItems:     align,
    justifyContent: justify,
    flexWrap:       wrap ? 'wrap' : undefined,
    ...style,
  };

  const cleanStyle = Object.fromEntries(
    Object.entries(computed).filter(([, v]) => v !== undefined),
  ) as CSSProperties;

  return (
    <Tag style={cleanStyle} className={className}>
      {children}
    </Tag>
  );
}
