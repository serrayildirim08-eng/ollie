/**
 * Box — generic div wrapper with style props resolved to CSS token vars.
 *
 * All token props accept the key name (e.g. bg="cream", padding="lg").
 * Raw CSS strings are also accepted for one-off overrides (e.g. padding="0 auto").
 * Non-token values pass through as-is.
 */

import React, { CSSProperties } from 'react';
import { colors as color, space, radii as radius } from '../theme/tokens';

// Token key types derived from the token maps
type ColorKey  = keyof typeof color;
type SpaceKey  = keyof typeof space;
type RadiusKey = keyof typeof radius;

// Accept either a token key or an arbitrary CSS string
type ColorProp  = ColorKey  | (string & {});
type SpaceProp  = SpaceKey  | (string & {});
type RadiusProp = RadiusKey | (string & {});

export interface BoxProps {
  /** background-color: token key or raw CSS */
  bg?: ColorProp;
  /** padding: token key, shorthand string, or number (treated as px) */
  padding?: SpaceProp | number;
  /** padding-top */
  pt?: SpaceProp | number;
  /** padding-right */
  pr?: SpaceProp | number;
  /** padding-bottom */
  pb?: SpaceProp | number;
  /** padding-left */
  pl?: SpaceProp | number;
  /** padding inline (left+right) */
  px?: SpaceProp | number;
  /** padding block (top+bottom) */
  py?: SpaceProp | number;
  /** margin: token key, shorthand string, or number (treated as px) */
  margin?: SpaceProp | number;
  /** margin-top */
  mt?: SpaceProp | number;
  /** margin-bottom */
  mb?: SpaceProp | number;
  /** border-radius: token key or raw CSS */
  radius?: RadiusProp;
  /** width — raw CSS string or number (px) */
  width?: string | number;
  /** height — raw CSS string or number (px) */
  height?: string | number;
  /** min-width */
  minWidth?: string | number;
  /** min-height */
  minHeight?: string | number;
  /** max-width */
  maxWidth?: string | number;
  /** max-height */
  maxHeight?: string | number;
  /** overflow */
  overflow?: CSSProperties['overflow'];
  /** position */
  position?: CSSProperties['position'];
  /** display */
  display?: CSSProperties['display'];
  /** Additional inline styles (last-wins over token props) */
  style?: CSSProperties;
  /** className for one-off overrides */
  className?: string;
  children?: React.ReactNode;
  // Allow all standard div attributes except style/className (handled above)
  as?: React.ElementType;
}

// Resolve a space prop: token key → CSS var, number → px, string → as-is
function resolveSpace(val: SpaceProp | number | undefined): string | undefined {
  if (val === undefined) return undefined;
  if (typeof val === 'number') return `${val}px`;
  if (val in space) return space[val as unknown as SpaceKey];
  return val as string;
}

function resolveColor(val: ColorProp | undefined): string | undefined {
  if (val === undefined) return undefined;
  if (val in color) return color[val as ColorKey];
  return val as string;
}

function resolveRadius(val: RadiusProp | undefined): string | undefined {
  if (val === undefined) return undefined;
  if (val in radius) return radius[val as RadiusKey];
  return val as string;
}

function resolveSize(val: string | number | undefined): string | undefined {
  if (val === undefined) return undefined;
  if (typeof val === 'number') return `${val}px`;
  return val;
}

export function Box({
  as: Tag = 'div',
  bg,
  padding,
  pt, pr, pb, pl, px, py,
  margin,
  mt, mb,
  radius: radiusProp,
  width,
  height,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  overflow,
  position,
  display,
  style,
  className,
  children,
}: BoxProps) {
  const resolved: CSSProperties = {
    backgroundColor: resolveColor(bg),
    padding:         resolveSpace(padding),
    paddingTop:      resolveSpace(pt ?? py),
    paddingBottom:   resolveSpace(pb ?? py),
    paddingLeft:     resolveSpace(pl ?? px),
    paddingRight:    resolveSpace(pr ?? px),
    margin:          resolveSpace(margin),
    marginTop:       resolveSpace(mt),
    marginBottom:    resolveSpace(mb),
    borderRadius:    resolveRadius(radiusProp),
    width:           resolveSize(width),
    height:          resolveSize(height),
    minWidth:        resolveSize(minWidth),
    minHeight:       resolveSize(minHeight),
    maxWidth:        resolveSize(maxWidth),
    maxHeight:       resolveSize(maxHeight),
    overflow,
    position,
    display,
    // Spread caller overrides last so they win
    ...style,
  };

  // Strip undefined keys to keep the style object clean
  const cleanStyle = Object.fromEntries(
    Object.entries(resolved).filter(([, v]) => v !== undefined),
  ) as CSSProperties;

  return (
    <Tag style={cleanStyle} className={className}>
      {children}
    </Tag>
  );
}
