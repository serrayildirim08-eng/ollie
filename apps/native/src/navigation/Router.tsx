/**
 * Router — top-level router for the native shell.
 *
 * React Router v7 declarative API.
 *
 * Routes:
 *   /              — DumpScreen (brain-dump universal entry)
 *   /modules       — module index
 *   /settings      — settings screen
 *   /box/<module>  — per-module box screens
 */

import { useEffect } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import { useUser, useClerk, useAuth } from "@clerk/clerk-react";
import { Layout } from "./Layout";
import { useDeepLinks } from "./useDeepLinks";
import {
  registerOllieNotificationActions,
  initNotificationActionRouter,
  type ReminderActionMeta,
} from "../notify/notificationActions";
import { tasks as adminTasksRepo } from "../modules/admin";
import { tasks as workTasksRepo } from "../modules/work";
import { onTaskCompleted } from "../notify/datelessLadderHook";
import { pullGroceryPantry } from "../sync/groceryPull";
import { useFeature } from "../settings/features";
import { Stack, Row, Box } from "../layout";
import { Text } from "../ui";

// calm sans title (redesign/olive-neumorphic) — replaces the giant editorial serif
const TITLE_STYLE: React.CSSProperties = {
  fontFamily: "var(--ollie-font-sans)",
  fontSize: "26px",
  fontWeight: 700,
  lineHeight: 1.15,
  letterSpacing: "-0.01em",
};
import { colors, radii, shadows } from "../theme/tokens";
import { DumpScreen } from "../dump";
import { MODULE_MANIFEST, MODULE_GROUP_META } from "./moduleRegistry";
import { TodoScreen } from "../todo/TodoScreen";
import { useServerReminderBridge } from "../notify/serverReminderBridge";

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: "all-small-caps",
  letterSpacing: "0.08em",
};

/** Wires ollie:// deep links to navigation; must live inside <BrowserRouter>. */
function DeepLinkBridge(): null {
  useDeepLinks();
  return null;
}

/** A6b: pull server-applied grocery rows on open/focus (no-op unless flagged). */
function GrocerySyncBridge(): null {
  const { getToken } = useAuth();
  useEffect(() => {
    const run = () => void pullGroceryPantry(() => getToken());
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [getToken]);
  return null;
}

/** Maps a reminder's "got it ✓" tap to the source module's completion write,
 *  then cancels any remaining date-less ladder tiers for the row. */
async function completeReminderTarget(meta: ReminderActionMeta): Promise<void> {
  if (meta.module === 'admin') {
    await adminTasksRepo.markComplete(meta.refId);
  } else {
    await workTasksRepo.markComplete(meta.refId);
  }
  // Completing via the notification action cancels the rest of the ladder.
  await onTaskCompleted(meta.module, meta.refId);
}

/** Registers notification action buttons + routes taps to completion/snooze (A3). */
function NotificationActionBridge(): null {
  useEffect(() => {
    void registerOllieNotificationActions();
    void initNotificationActionRouter(completeReminderTarget);
  }, []);
  return null;
}

export function Router() {
  // Wire the durable app-closed reminder path (Supabase scheduled_jobs →
  // cron → APNs). Mounted here under <SignedIn> so it always has a Clerk
  // identity to resolve. No-op until a device push token exists.
  useServerReminderBridge();
  // Partner is deferred out of v1 behind a feature flag (audit #10). Flagged
  // manifest entries only mount their route when the flag is on. Read all
  // flags here (only 'partner' today) so the routes can be derived below.
  const partnerEnabled = useFeature('partner');
  const flagOn = (entry: (typeof MODULE_MANIFEST)[number]): boolean =>
    entry.flag == null || (entry.flag === 'partner' && partnerEnabled);
  return (
    <BrowserRouter>
      <DeepLinkBridge />
      <NotificationActionBridge />
      <GrocerySyncBridge />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DumpScreen />} />
          {MODULE_MANIFEST.filter(flagOn).map(({ id, Component }) => (
            <Route key={id} path={`box/${id}`} element={<Component />} />
          ))}
          <Route path="modules" element={<ModulesIndex />} />
          <Route path="todo" element={<TodoScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="box/:id" element={<BoxPlaceholder />} />
          <Route path="*" element={<NotFoundPlaceholder />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

const ASIDE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--ollie-font-serif)',
  fontStyle: 'italic',
  fontSize: 14,
  color: colors.inkFaint,
  margin: '-2px 0 12px',
  letterSpacing: '0.005em',
};

function ModulesIndex() {
  // Hide feature-flagged-off modules (audit #10: Partner deferred from v1).
  const partnerEnabled = useFeature('partner');
  // Build the three rooms from the shared manifest (audit #178) — group
  // metadata gives display order + asides; items come from the manifest,
  // filtered by feature flag.
  const visible = MODULE_MANIFEST.filter(
    (m) => m.flag == null || (m.flag === 'partner' && partnerEnabled),
  );
  const groups = MODULE_GROUP_META.map((meta) => ({
    ...meta,
    items: visible.filter((m) => m.group === meta.id),
  }));
  return (
    <Stack gap={48}>
      <Stack gap={12}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          modules
        </Text>
        <Text scale="title" color={colors.ink} style={TITLE_STYLE}>modules</Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 540 }}>
          three rooms — yourself, your stuff, the things you owe.
        </Text>
      </Stack>

      {groups.map((group) => (
        <Stack key={group.id} gap={8}>
          <Text
            scale="caption"
            color={colors.inkFaint}
            style={{ ...SMCP_STYLE, letterSpacing: "0.20em" }}
          >
            {group.label}
          </Text>
          <p style={ASIDE_STYLE}>{group.aside}</p>
          <Stack gap={12}>
            {group.items.map((m) => (
              <Link
                key={m.id}
                to={`/box/${m.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <Box bg="cream" radius="card" shadow="raised" style={{ padding: "16px 18px" }}>
                  <Row gap={12} align="baseline" justify="space-between">
                    <Text scale="body">{m.label}</Text>
                    <Text scale="caption" color={colors.inkFaint}>
                      {m.hint}
                    </Text>
                  </Row>
                </Box>
              </Link>
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}

function SettingsScreen() {
  const { user } = useUser();
  const { signOut } = useClerk();
  return (
    <Stack gap={32}>
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          settings
        </Text>
        <Text scale="title" color={colors.ink} style={TITLE_STYLE}>settings</Text>
      </Stack>

      <Stack gap={12}>
        <Box bg="cream" radius="card" shadow="raised" style={{ padding: "16px 18px" }}>
          <Row gap={12} align="center" justify="space-between">
            <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
              account
            </Text>
            <Text scale="body">{user?.primaryEmailAddress?.emailAddress ?? "—"}</Text>
          </Row>
        </Box>

        <button
          onClick={() => void signOut()}
          style={{
            padding: "16px 18px",
            width: "100%",
            textAlign: "left",
            border: "none",
            borderRadius: radii.card,
            background: colors.cream,
            boxShadow: shadows.raised,
            cursor: "pointer",
            color: colors.sageDeep,
            fontVariantCaps: "all-small-caps",
            letterSpacing: "0.08em",
            fontSize: 14,
            fontFamily: "var(--ollie-font-sans)",
          }}
        >
          sign out
        </button>
      </Stack>
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
