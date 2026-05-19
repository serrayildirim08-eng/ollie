/**
 * money-v2 · inline SVG icon set
 *
 * Stroke icons lifted verbatim from the approved v2 mockups. Each takes a
 * `size`, `stroke` colour and `width` (stroke-width). They are inline SVGs
 * — not a dependency — so the preview module ships nothing new.
 *
 * `aria-hidden` by default: every icon in v2 sits next to a real text
 * label, so the icon is decorative. Pass an `title` to make one labelled.
 */
import type { SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number;
  /** stroke-width */
  weight?: number;
  title?: string;
}

function base(size: number, weight: number, title?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    strokeWidth: weight,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': title ? undefined : true,
    role: title ? 'img' : undefined,
  };
}

export function IconSearch({ size = 15, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5" />
    </svg>
  );
}

export function IconShield({ size = 15, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />
    </svg>
  );
}

export function IconEye({ size = 16, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconEyeClosed({ size = 16, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M2 12s3.5-7 10-7 10 7 10 7" />
      <path d="M3 4l18 16" />
      <path d="M9.5 9.6A3 3 0 0 0 12 15a3 3 0 0 0 2.6-1.5" />
    </svg>
  );
}

export function IconPlus({ size = 18, weight = 2.4, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconChevronDown({ size = 14, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconCheck({ size = 26, weight = 2.4, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M5 13l4 4 10-11" />
    </svg>
  );
}

export function IconBackspace({ size = 22, weight = 1.9, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M21 5H8L3 12l5 7h13z" />
      <path d="M16 9l-5 6M11 9l5 6" />
    </svg>
  );
}

export function IconClock({ size = 26, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

export function IconArrowUpRight({ size = 16, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

export function IconReceipt({ size = 18, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M5 21V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v16l-3-2-3 2-3-2-3 2-2-1.3" />
      <path d="M9 9h6M9 13h6" />
    </svg>
  );
}

export function IconTrendUp({ size = 18, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M3 17l5-5 4 3 7-8" />
      <path d="M14 4h5v5" />
    </svg>
  );
}

export function IconRefresh({ size = 18, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" />
    </svg>
  );
}

export function IconStar({ size = 18, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M12 3l2.5 5 5.5.8-4 3.9 1 5.5L12 21l-5-2.1 1-5.5-4-3.9 5.5-.8z" />
    </svg>
  );
}

export function IconAlert({ size = 18, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5h.01" />
    </svg>
  );
}

export function IconBriefcase({ size = 18, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M9 3h6l1 4H8zM6 7h12v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
      <path d="M12 11v6M9 14h6" />
    </svg>
  );
}

export function IconCalendar({ size = 15, weight = 1.8, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M3 10h18M7 3v4M17 3v4M5 6h14v14H5z" />
    </svg>
  );
}

export function IconGlobe({ size = 15, weight = 1.8, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </svg>
  );
}

export function IconDownload({ size = 16, weight = 1.9, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M12 3v12M8 11l4 4 4-4M5 20h14" />
    </svg>
  );
}

export function IconFaceId({ size = 24, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M9 10v2M15 10v2M12 9v4M9.5 16a4 4 0 0 0 5 0" />
    </svg>
  );
}

export function IconBag({ size = 24, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M6 8h12l1.5 11a1 1 0 0 1-1 1.1H5.5A1 1 0 0 1 4.5 19z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

/** a chevron-right — the quiet drill caret used by cycle's nav rows */
export function IconChevronRight({ size = 14, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** a teardrop — cycle's module glyph (a calm period drop) */
export function IconDrop({ size = 15, weight = 1.8, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M12 3.5C12 3.5 5.5 11 5.5 15.5a6.5 6.5 0 0 0 13 0C18.5 11 12 3.5 12 3.5z" />
    </svg>
  );
}

/** a capsule pill — birth-control glyph */
export function IconPill({ size = 16, weight = 1.9, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M10.5 13.5l3-3M8 16a4 4 0 0 1 0-5.6l2.4-2.4a4 4 0 0 1 5.6 5.6L13.6 16A4 4 0 0 1 8 16z" />
    </svg>
  );
}

/** a pencil — the quiet note-line affordance */
export function IconPencil({ size = 15, weight = 1.8, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M4 20h16M5 16l9.5-9.5a2 2 0 0 1 3 3L8 19l-4 1z" />
    </svg>
  );
}

/** a heart — the touch / partner glyph */
export function IconHeart({ size = 15, weight = 1.8, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />
    </svg>
  );
}

/** a house — the labor / chores glyph */
export function IconHome({ size = 15, weight = 1.8, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />
    </svg>
  );
}

/** a speech bubble — the emotional-support glyph */
export function IconChat({ size = 15, weight = 1.8, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** a share / upload tray — the send-ask action glyph */
export function IconShare({ size = 18, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14" />
    </svg>
  );
}

/** an info circle — the calm disclaimer mark */
export function IconInfo({ size = 15, weight = 1.8, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

/** a sun — the morning cue-time glyph */
export function IconSun({ size = 16, weight = 1.9, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M5 5l2 2M17 17l2 2M2 12h3M19 12h3M5 19l2-2M17 7l2-2" />
    </svg>
  );
}

/** a crescent moon — sleep's module glyph (a calm night) */
export function IconMoon({ size = 15, weight = 1.8, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
    </svg>
  );
}

/** a play triangle — the sounds-player paused glyph (filled) */
export function IconPlay({ size = 24, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d="M8 5l12 7-12 7z" />
    </svg>
  );
}

/** a pause glyph — the sounds-player playing state (filled) */
export function IconPause({ size = 24, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title && <title>{title}</title>}
      <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
    </svg>
  );
}

/** a handset — admin's phone-call glyph (a calm receiver) */
export function IconPhone({ size = 15, weight = 1.9, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M5 4h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
    </svg>
  );
}

/** a dog-eared page — admin's attached-document glyph */
export function IconDoc({ size = 14, weight = 1.9, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

/** a chain link — the doc-reference link glyph */
export function IconLink({ size = 14, weight = 1.9, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

/** a single figure — the stale-ball / person glyph */
export function IconPerson({ size = 14, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

/** an envelope — the last-5%-mailed glyph */
export function IconMail({ size = 14, weight = 1.9, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 8l9 6 9-6" />
    </svg>
  );
}

/** three stacked lines — the weekly-note recap glyph */
export function IconList({ size = 14, weight = 1.9, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

/** a paw — the pets-v2 submodule glyph. Four toe pads + a main pad. */
export function IconPaw({ size = 16, weight = 1.6, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="15" r="4" />
      <circle cx="6.5" cy="9.5" r="1.9" />
      <circle cx="11" cy="7.5" r="1.9" />
      <circle cx="15.5" cy="8" r="1.9" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  );
}

/** a feather of hay / grass blades — the hay-refill care glyph. */
export function IconHay({ size = 16, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M4 20l6-14M20 20l-6-14M8 20l4-9 4 9" />
    </svg>
  );
}

/** a small leaf — the observe / behaviour glyph. */
export function IconLeaf({ size = 16, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M5 19c0-8 6-13 14-13 0 8-6 14-14 13z" />
      <path d="M5 19c4-4 7-6 10-7" />
    </svg>
  );
}

/** a shopping basket — the grocery `shop` mode glyph (grocery-cold.html). */
export function IconBasket({ size = 16, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M4 8h16l-1.4 10.6a1 1 0 0 1-1 .9H6.4a1 1 0 0 1-1-.9L4 8z" />
      <path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2" />
    </svg>
  );
}

/** a pantry jar — the grocery `pantry` mode glyph (grocery-cold.html). */
export function IconJar({ size = 16, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M7 9.5V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3.5" />
      <rect x="5.5" y="9.5" width="13" height="11" rx="1.5" />
      <path d="M9.5 4v5.5M14.5 4v5.5" />
    </svg>
  );
}

/** a target ring — the grocery `feed me` recipe-matcher glyph. */
export function IconTarget({ size = 16, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

/** a small sprout — the goals cold-state seed glyph (nothing growing yet). */
export function IconSeed({ size = 34, weight = 1.7, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M12 21v-7" />
      <path d="M12 14c0-3.3-2.7-6-6-6 0 3.3 2.7 6 6 6z" />
      <path d="M12 12c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6z" />
    </svg>
  );
}

/** a small spark — the calm AI step-breakdown mark (a sun-burst nucleus). */
export function IconSparkle({ size = 16, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M12 3v4M12 17v4M5 12H1M23 12h-4M6 6l2 2M18 6l-2 2M6 18l2-2M18 18l-2-2" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

/** a graduation cap — the goals `learning` category glyph. */
export function IconCap({ size = 13, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M4 19V8l8-4 8 4v11M9 19v-6h6v6" />
    </svg>
  );
}

/** a small case — the goals `career` category glyph. */
export function IconCareer({ size = 13, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M3 7h18v12H3zM8 7V4h8v3" />
    </svg>
  );
}

/** a coin column — the goals `finance` category glyph. */
export function IconCoins({ size = 13, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M12 3v18M5 8h14M7 13h10" />
    </svg>
  );
}

/** two figures — the goals `relationship` category glyph. */
export function IconPeople({ size = 13, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="9" cy="8" r="3" />
      <circle cx="16" cy="10" r="2.4" />
      <path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5M14 20c0-2 1-3.4 3-3.8" />
    </svg>
  );
}

/** a paintbrush — the goals `creative` category glyph. */
export function IconBrush({ size = 13, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M5 21l3-9 8-8 5 5-8 8zM14 5l5 5" />
    </svg>
  );
}

/** a folded contract page — the goals Ulysses-contract glyph. */
export function IconContract({ size = 12, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M5 4h11l3 3v13H5zM9 4v6h6" />
    </svg>
  );
}

/** crossing arrows — the goals interference glyph (two pulls). */
export function IconCross({ size = 14, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <path d="M7 7l-4 5 4 5M17 7l4 5-4 5M14 4l-4 16" />
    </svg>
  );
}

/** a checked circle — the goals review-prompt glyph. */
export function IconCheckCircle({ size = 14, weight = 2, title, ...rest }: IconProps) {
  return (
    <svg {...base(size, weight, title)} {...rest}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="9" />
      <path d="M9 12l2 2 4-5" />
    </svg>
  );
}
