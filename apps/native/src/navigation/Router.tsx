/**
 * Router — top-level router for the native shell.
 *
 * React Router v7 declarative API.
 *
 * Routes are intentionally skeletal:
 *   /         — home placeholder
 *   /box/:id  — generic box screen placeholder
 */

import { BrowserRouter, Route, Routes } from "react-router";
import { Layout } from "./Layout";
import { Stack } from "../layout";
import { Text } from "../ui";
import { colors } from "../theme/tokens";

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: "all-small-caps",
  letterSpacing: "0.08em",
};

export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePlaceholder />} />
          <Route path="box/:id" element={<BoxPlaceholder />} />
          <Route path="*" element={<NotFoundPlaceholder />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

function HomePlaceholder() {
  return (
    <Stack gap={16}>
      <Text scale="display">Ollie</Text>
      <Text color={colors.inkFaint}>A quiet place. Pick a module from the rail.</Text>
    </Stack>
  );
}

function BoxPlaceholder() {
  return (
    <Stack gap={16}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>Box</Text>
      <Text scale="display">{readBoxIdFromPath()}</Text>
      <Text color={colors.inkFaint}>Screen slot — not yet built.</Text>
    </Stack>
  );
}

function NotFoundPlaceholder() {
  return (
    <Stack gap={16}>
      <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>404</Text>
      <Text scale="display">Not here.</Text>
    </Stack>
  );
}

function readBoxIdFromPath(): string {
  if (typeof window === "undefined") return "";
  const match = window.location.pathname.match(/\/box\/([^/]+)/);
  return match?.[1] ?? "";
}
