/**
 * Layout — shell combining TabBar + routed content.
 *
 * Desktop: sidebar left, content right.
 * Mobile : content fills, bottom tab bar overlays with safe-area padding.
 *
 * Layout owns the responsive switch via a single CSS media query block
 * scoped to `ollie-nav-sidebar` / `ollie-nav-bottom` classes used in TabBar.
 */

import { Outlet, useLocation, useNavigate } from "react-router";
import { Box } from "../layout";
import { colors, space } from "../theme/tokens";
import { TabBar } from "./TabBar";

const SMCP: React.CSSProperties = {
  fontVariantCaps: "all-small-caps",
  letterSpacing: "0.08em",
};

function BackBar(): JSX.Element | null {
  const location = useLocation();
  const navigate = useNavigate();

  // No back on home, todo, modules, settings (top-level tabs).
  const path = location.pathname.replace(/\/$/, "");
  const isTopLevel =
    path === "" ||
    path === "/" ||
    path === "/todo" ||
    path === "/modules" ||
    path === "/settings";
  if (isTopLevel) return null;

  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      aria-label="back"
      style={{
        background: "none",
        border: "none",
        padding: "4px 0",
        color: colors.inkFaint,
        cursor: "pointer",
        fontSize: 13,
        fontFamily: "inherit",
        marginBottom: 24,
        ...SMCP,
      }}
    >
      ← back
    </button>
  );
}

const BREAKPOINT_PX = 900;

const responsiveCss = `
  .ollie-nav-bottom { display: none; }
  .ollie-nav-sidebar { display: block; }
  /* Lock the shell to viewport height and let the main column own its
     own scroll. Without this, long box pages were getting cut off
     behind the bottom tab bar with no way to reach them. */
  html, body, #root { height: 100%; margin: 0; }
  .ollie-shell-root {
    /* dvh, not vh: on iOS WebKit 100vh is the LARGEST viewport (ignores the
       dynamic toolbar), which clips the bottom of the shell. 100dvh tracks
       the actual visible height. */
    height: 100dvh;
    overflow: hidden;
  }
  .ollie-main {
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }
  @media (max-width: ${BREAKPOINT_PX - 1}px) {
    .ollie-nav-sidebar { display: none; }
    .ollie-nav-bottom { display: block; }
    .ollie-main { padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
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
            minHeight: 0,
          }}
        >
          {/* Editorial column — content lives in the middle, not edge-to-edge.
              Generous side margins on wide screens, fluid on narrow. */}
          <Box
            style={{
              maxWidth: 720,
              marginLeft: "auto",
              marginRight: "auto",
              width: "100%",
            }}
          >
            <BackBar />
            <Outlet />
          </Box>
        </Box>
      </Box>
    </>
  );
}
