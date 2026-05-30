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
        height: 56,
        borderTop: `1px solid ${colors.hairline}`,
        background: colors.cream,
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
          <li key={item.id} style={{ flex: 1, textAlign: "center" }}>
            <NavLink
              to={item.path}
              end={item.path === "/"}
              style={({ isActive }) => ({
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                padding: `${space[2]} 0`,
                color: isActive ? colors.ink : colors.inkFaint,
                textDecoration: "none",
                fontWeight: isActive ? 500 : 400,
              })}
            >
              <Text scale="caption" style={SMCP_STYLE}>{item.label}</Text>
            </NavLink>
          </li>
        ))}
      </Row>
    </nav>
  );
}
