/**
 * Container — max-width content wrapper, centered.
 *
 * Desktop-first but iPhone-safe: horizontal padding collapses gracefully at
 * narrow widths (Tauri iOS runs at ~390px viewport width).
 *
 * Three size variants:
 *   "text"   — 640px  — long-form prose / onboarding copy
 *   "content"— 880px  — default; dashboard cards, module bodies
 *   "wide"   — 1200px — full desktop layouts
 *
 * Padding strategy: generous horizontal padding on desktop (xl = 40px each side),
 * fluid down to md (16px) on narrow viewports via clamp().
 */

import React, { CSSProperties } from 'react';
import { space } from '../theme/tokens';

export type ContainerSize = 'text' | 'content' | 'wide';

const maxWidths: Record<ContainerSize, string> = {
  text:    '640px',
  content: '880px',
  wide:    '1200px',
};

/**
 * Fluid horizontal padding: xl at wide, md at narrow.
 * clamp(min, preferred, max) — resolves CSS vars before clamping.
 * We spell out the px values directly because CSS clamp() can't do
 * arithmetic on custom properties without calc() nesting.
 *
 *   md = 16px, xl = 40px
 *   preferred: 4vw — scales naturally between ~390px and ~1200px viewport.
 */
const fluidPaddingInline = 'clamp(16px, 4vw, 40px)';

export interface ContainerProps {
  /** Max-width variant. Default: "content". */
  size?: ContainerSize;
  /** Override horizontal padding. Token key or raw CSS. */
  px?: keyof typeof space | (string & {}) | number;
  /** Override vertical padding. Token key or raw CSS. */
  py?: keyof typeof space | (string & {}) | number;
  /** Center the container with auto horizontal margins. Default: true. */
  centered?: boolean;
  /** Additional inline styles */
  style?: CSSProperties;
  className?: string;
  children?: React.ReactNode;
  as?: React.ElementType;
}

type SpaceKey = keyof typeof space;

function resolvePadding(val: SpaceKey | string | number | undefined): string | undefined {
  if (val === undefined) return undefined;
  if (typeof val === 'number') return `${val}px`;
  if (val in space) return space[val as unknown as SpaceKey];
  return val as string;
}

export function Container({
  as: Tag = 'div',
  size = 'content',
  px,
  py,
  centered = true,
  style,
  className,
  children,
}: ContainerProps) {
  const computed: CSSProperties = {
    width:          '100%',
    maxWidth:       maxWidths[size],
    marginInline:   centered ? 'auto' : undefined,
    paddingInline:  px !== undefined ? resolvePadding(px) : fluidPaddingInline,
    paddingBlock:   resolvePadding(py),
    boxSizing:      'border-box',
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
