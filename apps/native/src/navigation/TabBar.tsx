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
import { colors, space } from "../theme/tokens";
import { primaryRoutes, type RouteEntry } from "./routes";

// olive single-line tab icons, keyed by route id
const TAB_ICON_PATHS: Record<string, string> = {
  home: '<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  todo: '<polyline points="3.5 12 5.5 14 8.5 10"/><path d="M11 7h10M11 12h10M11 17h10"/>',
  modules:
    '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
};

function TabIcon({ id }: { id: string }): JSX.Element {
  return (
    <svg
      width={23}
      height={23}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: TAB_ICON_PATHS[id] ?? "" }}
    />
  );
}

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
        borderRight: `1px solid ${colors.hairline}`,
        background: colors.cream,
        boxSizing: "border-box",
      }}
    >
      <Stack gap={space[4]}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          Ollie
        </Text>
        <Stack gap={space[2]} as="ul" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((item) => (
            <li key={item.id}>
              <NavLink
                to={item.path}
                end={item.path === "/"}
                style={({ isActive }) => ({
                  display: "block",
                  padding: `${space[2]} 0`,
                  color: isActive ? colors.ink : colors.inkFaint,
                  fontWeight: isActive ? 500 : 400,
                  textDecoration: "none",
                  borderLeft: isActive
                    ? `2px solid ${colors.ink}`
                    : "2px solid transparent",
                  paddingLeft: space[3],
                  transition: "color 180ms ease-out",
                })}
              >
                <Text>{item.label}</Text>
              </NavLink>
            </li>
          ))}
        </Stack>
      </Stack>
    </nav>
  );
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
        height: 64,
        background: colors.cream,
        boxShadow: "0 -8px 24px rgba(120, 140, 122, 0.22)",
        paddingBottom: "env(safe-area-inset-bottom)",
        boxSizing: "content-box",
        zIndex: 1000,
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
          <li key={item.id} style={{ flex: 1, textAlign: "center", height: "100%" }}>
            <NavLink
              to={item.path}
              end={item.path === "/"}
              style={({ isActive }) => ({
                display: "flex",
                width: "100%",
                height: "100%",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                minHeight: 44,
                padding: `${space[2]} 0`,
                color: isActive ? colors.sageDeep : colors.inkFaint,
                textDecoration: "none",
                fontWeight: isActive ? 600 : 400,
                transition: "color 180ms ease-out",
              })}
            >
              <TabIcon id={item.id} />
              <span
                style={{
                  fontSize: "10px",
                  letterSpacing: "0.08em",
                  textTransform: "lowercase",
                }}
              >
                {item.label.toLowerCase()}
              </span>
            </NavLink>
          </li>
        ))}
      </Row>
    </nav>
  );
}
