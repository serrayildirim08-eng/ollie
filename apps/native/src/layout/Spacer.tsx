/**
 * Spacer — invisible flex child that pushes siblings apart.
 *
 * Usage in Row/Stack: place between items to push the trailing item
 * to the opposite end.
 *
 *   <Row>
 *     <Logo />
 *     <Spacer />
 *     <NavActions />
 *   </Row>
 *
 * Optional fixed size: when `size` is provided, the spacer acts as
 * a fixed-width/height gap instead of a flex-grow pusher.
 */

import { CSSProperties } from 'react';
import { space } from '../theme/tokens';

type SpaceKey = keyof typeof space;

export interface SpacerProps {
  /**
   * Fixed size. When omitted, the spacer grows to fill remaining flex space.
   * Token key, number (px), or raw CSS string.
   */
  size?: SpaceKey | (string & {}) | number;
  /** aria-hidden is true by default — this element is purely presentational. */
  'aria-hidden'?: boolean;
  style?: CSSProperties;
}

function resolveSize(val: SpaceKey | string | number | undefined): string | undefined {
  if (val === undefined) return undefined;
  if (typeof val === 'number') return `${val}px`;
  if (val in space) return space[val as unknown as SpaceKey];
  return val as string;
}

export function Spacer({
  size,
  'aria-hidden': ariaHidden = true,
  style,
}: SpacerProps) {
  const resolvedSize = resolveSize(size);

  const computed: CSSProperties =
    resolvedSize !== undefined
      ? {
          // Fixed-size spacer: a specific dimension in both axes
          display:   'block',
          flexShrink: 0,
          width:     resolvedSize,
          height:    resolvedSize,
          ...style,
        }
      : {
          // Flex-grow pusher
          flex:    '1 1 0%',
          display: 'block',
          ...style,
        };

  return <span style={computed} aria-hidden={ariaHidden} />;
}
