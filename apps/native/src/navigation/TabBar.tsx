/**
 * TabBar — shared primary navigation surface.
 *
 * Desktop (≥900px): editorial left rail (Monocle-style thin spine).
 *   Vertical stack, generous whitespace, smcp labels.
 * Mobile (<900px): soft bottom bar, 3-4 icons max, thin baseline.
 *
 * Not a SaaS dashboard. No pill backgrounds, no shadows. Active state is a
 * hairline indicator + ink-weight shift, never a fill.
 */

import { NavLink } from "react-router";
import { Row, Stack } from "../layout";
import { Text } from "../ui";
import { space } from "../theme/tokens";
import { primaryRoutes, type RouteEntry } from "./routes";

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: "all-small-caps",
  letterSpacing: "0.08em",
  fontSize: "12px",
};

interface TabBarProps {
  readonly variant?: "sidebar" | "bottom" | "responsive";
}

export function TabBar({ variant = "responsive" }: TabBarProps) {
  if (variant === "sidebar") return <Sidebar items={primaryRoutes} />;
  if (variant === "bottom") return <BottomBar items={primaryRoutes} />;
  return (
    <>
      <div className="ollie-nav-sidebar">
        <Sidebar items={primaryRoutes} />
      </div>
      <div className="ollie-nav-bottom">
        <BottomBar items={primaryRoutes} />
      </div>
    </>
  );
}

interface ListProps {
  readonly items: readonly RouteEntry[];
}

function Sidebar({ items }: ListProps) {
  return (
    <nav
      aria-label="Primary"
      style={{
        width: 220,
        height: "100dvh",
        padding: `${space[6]} ${space[5]}`,
        borderRight: `1px solid var(--ollie-color-hairline)`,
        background: 'var(--ollie-color-cream)',
        boxSizing: "border-box",
      }}
    >
      <Stack gap={space[4]}>
        {/* Real masthead — serif wordmark in ink, not a faint smcp eyebrow.
            The thin spine deserves a brand moment, not a label. */}
        <Text scale="heading" color="var(--ollie-color-ink)">
          Ollie
        </Text>
        <Stack gap={space[2]} as="ul" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((item) => (
            <li key={item.id}>
              <NavLink
                to={item.path}
                end={item.path === "/"}
                style={({ isActive }) => ({
                  display: "flex",
                  alignItems: "center",
                  gap: space[3],
                  padding: `${space[2]} 0`,
                  color: isActive ? 'var(--ollie-color-ink)' : 'var(--ollie-color-ink-faint)',
                  fontWeight: isActive ? 500 : 400,
                  textDecoration: "none",
                  borderLeft: isActive
                    ? `2px solid var(--ollie-color-ink)`
                    : "2px solid transparent",
                  paddingLeft: space[3],
                  transition: "color 180ms ease-out",
                })}
              >
                <NavIcon name={item.icon} />
                <Text>{item.label}</Text>
              </NavLink>
            </li>
          ))}
        </Stack>
      </Stack>
    </nav>
  );
}

// Hand-rolled stroke icons — no icon dependency, matches the app's existing
// inline-SVG idiom (GoalArc, SeedGlyph). Keyed by route.icon name.
function NavIcon({ name }: { name?: string }): JSX.Element | null {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "House":
      return (
        <svg {...common}>
          <path d="M4 11.5 12 4l8 7.5" />
          <path d="M6 10v9h12v-9" />
        </svg>
      );
    case "ListChecks":
      return (
        <svg {...common}>
          <path d="M10 6h10M10 12h10M10 18h10" />
          <path d="m3 6 1.4 1.4L7 5" />
          <path d="m3 12 1.4 1.4L7 11" />
          <path d="m3 18 1.4 1.4L7 17" />
        </svg>
      );
    case "SquaresFour":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
        </svg>
      );
    case "Gear":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
        </svg>
      );
    default:
      return null;
  }
}

function BottomBar({ items }: ListProps) {
  const capped = items.slice(0, 4);
  return (
    <nav
      aria-label="Primary"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 56,
        borderTop: `1px solid var(--ollie-color-hairline)`,
        background: 'var(--ollie-color-cream)',
        paddingBottom: "env(safe-area-inset-bottom)",
        boxSizing: "content-box",
      }}
    >
      <Row
        as="ul"
        justify="space-around"
        align="center"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          height: "100%",
        }}
      >
        {capped.map((item) => (
          <li key={item.id} style={{ flex: 1, height: "100%" }}>
            {/* The WHOLE cell is the tap target (>=48px), not just the text —
                fixes the sub-44px hit area the audit flagged. Icon over label. */}
            <NavLink
              to={item.path}
              end={item.path === "/"}
              style={({ isActive }) => ({
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                width: "100%",
                height: "100%",
                minHeight: 48,
                color: isActive ? 'var(--ollie-color-ink)' : 'var(--ollie-color-ink-faint)',
                textDecoration: "none",
                fontWeight: isActive ? 500 : 400,
              })}
            >
              <NavIcon name={item.icon} />
              <Text scale="caption" style={SMCP_STYLE}>{item.label}</Text>
            </NavLink>
          </li>
        ))}
      </Row>
    </nav>
  );
}
