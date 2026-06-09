import type { ElementType, HTMLAttributes, ReactNode } from "react";
import styles from "./Text.module.css";

export type TextScale = "display" | "title" | "heading" | "body" | "caption";

/**
 * Color accepts any CSS value — intended for theme token strings from
 * `../theme/tokens` (e.g. `color.inkLight`) but plain hex works too.
 */
export interface TextProps extends HTMLAttributes<HTMLElement> {
  scale?: TextScale;
  /** CSS color value. Defaults to --ollie-ink-mid for most scales, --ollie-ink-light for caption. */
  color?: string;
  /** Override the rendered element. Defaults to semantic element per scale. */
  as?: ElementType;
  children: ReactNode;
}

const DEFAULT_TAG: Record<TextScale, ElementType> = {
  display: "h1",
  title:   "h2",
  heading: "h3",
  body:    "p",
  caption: "span",
};

/**
 * Ollie Text — type scale primitive.
 * Uses `as` prop for semantic flexibility.
 *
 * @example
 * <Text scale="caption" color="var(--ollie-ink-light)">Step 1 of 3</Text>
 */
export function Text({
  scale = "body",
  color,
  as,
  className,
  style,
  children,
  ...rest
}: TextProps) {
  const Tag = as ?? DEFAULT_TAG[scale];

  const cls = [styles.text, styles[scale], className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <Tag
      className={cls}
      style={color ? { color, ...style } : style}
      {...rest}
    >
      {children}
    </Tag>
  );
}
