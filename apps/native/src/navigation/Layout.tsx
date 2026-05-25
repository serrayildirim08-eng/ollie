/**
 * Layout — shell combining TabBar + routed content.
 *
 * Desktop: sidebar left, content right.
 * Mobile : content fills, bottom tab bar overlays with safe-area padding.
 *
 * Layout owns the responsive switch via a single CSS media query block
 * scoped to `ollie-nav-sidebar` / `ollie-nav-bottom` classes used in TabBar.
 */

import { Outlet } from "react-router";
import { Box } from "../layout";
import { colors, space } from "../theme/tokens";
import { TabBar } from "./TabBar";

const BREAKPOINT_PX = 900;

const responsiveCss = `
  .ollie-nav-bottom { display: none; }
  .ollie-nav-sidebar { display: block; }
  @media (max-width: ${BREAKPOINT_PX - 1}px) {
    .ollie-nav-sidebar { display: none; }
    .ollie-nav-bottom { display: block; }
    .ollie-main { padding-bottom: calc(56px + env(safe-area-inset-bottom)); }
    .ollie-shell-root { flex-direction: column; }
  }
`;

export function Layout(): JSX.Element {
  return (
    <>
      <style>{responsiveCss}</style>
      <Box
        className="ollie-shell-root"
        style={{
          display: "flex",
          flexDirection: "row",
          minHeight: "100vh",
          background: colors.cream,
          color: colors.ink,
        }}
      >
        <TabBar />
        <Box
          as="main"
          className="ollie-main"
          style={{
            flex: 1,
            padding: space[6],
            minWidth: 0,
          }}
        >
          <Outlet />
        </Box>
      </Box>
    </>
  );
}
