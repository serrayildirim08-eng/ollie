/**
 * Stack — vertical flex column.
 *
 * ADHD-friendly default gap: "lg" (24px) — generous editorial breathing room.
 * Think Kinfolk magazine column layout, not dense Bootstrap rows.
 */

import React, { CSSProperties } from 'react';
import { space } from '../theme/tokens';

type SpaceKey = keyof typeof space;
type GapProp  = SpaceKey | (string & {}) | number;

export interface StackProps {
  /** Gap between children. Token key, number (px), or raw CSS. Default: "lg" (24px). */
  gap?: GapProp;
  /** align-items */
  align?: CSSProperties['alignItems'];
  /** justify-content */
  justify?: CSSProperties['justifyContent'];
  /** Whether to wrap children (flex-wrap). Default: false. */
  wrap?: boolean;
  /** Reverse direction (column-reverse). Default: false. */
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

export function Stack({
  as: Tag = 'div',
  gap,
  align,
  justify,
  wrap = false,
  reverse = false,
  style,
  className,
  children,
}: StackProps) {
  const computed: CSSProperties = {
    display:        'flex',
    flexDirection:  reverse ? 'column-reverse' : 'column',
    gap:            resolveGap(gap, space[6]),
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
