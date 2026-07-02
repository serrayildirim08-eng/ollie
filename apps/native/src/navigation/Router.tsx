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
import { useAuth } from "@clerk/clerk-react";
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
import { isFeatureEnabled } from "../settings/features";
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
import { colors } from "../theme/tokens";
import { DumpScreen } from "../dump";
import { MODULE_MANIFEST, MODULE_GROUP_META } from "./moduleRegistry";
import { HouseholdRoom } from "../rooms/HouseholdRoom";
import { HealthRoom } from "../rooms/HealthRoom";
import { ResponsibilitiesRoom } from "../rooms/ResponsibilitiesRoom";
import { MoneyRoom } from "../rooms/MoneyRoom";
import { TodoScreen } from "../todo/TodoScreen";
import { SettingsScreen } from "../settings/SettingsScreen";
import { useServerReminderBridge } from "../notify/serverReminderBridge";
import { useApnsPushRegistration } from "../notify/apnsPushRegistration";

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
  // On native iOS, register the APNs device token to the push worker once
  // signed in (no-op in browser / when unconfigured).
  useApnsPushRegistration();
  // Modules can be deferred behind a feature flag (audit #10). Flagged manifest
  // entries only mount their /box route when the flag is on. Default-OFF today:
  // partner, goals, habits, pets (see settings/features.ts).
  const flagOn = (entry: (typeof MODULE_MANIFEST)[number]): boolean =>
    entry.flag == null || isFeatureEnabled(entry.flag);
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
          <Route path="room/household" element={<HouseholdRoom />} />
          <Route path="room/health" element={<HealthRoom />} />
          <Route path="room/responsibilities" element={<ResponsibilitiesRoom />} />
          <Route path="room/money" element={<MoneyRoom />} />
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
  // Build the rooms from the shared manifest (audit #178) — group metadata
  // gives display order + asides; items come from the manifest, filtered by
  // feature flag (default-OFF modules are hidden, see settings/features.ts).
  // Roomed modules live in a room (their /box routes still exist, reached from
  // the room). Household = grocery + chores; Health = sleep + cycle + body +
  // medication + mood; Responsibilities = work + admin; Money = finance. All
  // are lifted out of the flat module list here, so the flat groups render
  // empty by design.
  const ROOMED_IDS = new Set([
    'grocery',
    'chores',
    'sleep',
    'cycle',
    'body',
    'medication',
    'mood',
    'work',
    'admin',
    'finance',
  ]);
  const visible = MODULE_MANIFEST.filter(
    (m) => (m.flag == null || isFeatureEnabled(m.flag)) && !ROOMED_IDS.has(m.id),
  );
  const groups = MODULE_GROUP_META.map((meta) => ({
    ...meta,
    items: visible.filter((m) => m.group === meta.id),
  })).filter((g) => g.items.length > 0);
  return (
    <Stack gap={48}>
      <Stack gap={12}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          rooms
        </Text>
        <Text scale="title" color={colors.ink} style={TITLE_STYLE}>rooms</Text>
        <Text scale="body" color={colors.inkSoft} style={{ maxWidth: 540 }}>
          one calm screen per part of your life.
        </Text>
      </Stack>

      {/* Built rooms — Health first, then Household. */}
      <Stack gap={8}>
        <Text
          scale="caption"
          color={colors.inkFaint}
          style={{ ...SMCP_STYLE, letterSpacing: "0.20em" }}
        >
          health
        </Text>
        <p style={ASIDE_STYLE}>sleep, energy, your cycle, water, the meds.</p>
        <Link to="/room/health" style={{ textDecoration: "none", color: "inherit" }}>
          <Box bg="cream" radius="card" shadow="raised" style={{ padding: "16px 18px" }}>
            <Row gap={12} align="baseline" justify="space-between">
              <Text scale="body">Health</Text>
              <Text scale="caption" color={colors.inkFaint}>
                sleep · cycle · body · medication
              </Text>
            </Row>
          </Box>
        </Link>
      </Stack>

      <Stack gap={8}>
        <Text
          scale="caption"
          color={colors.inkFaint}
          style={{ ...SMCP_STYLE, letterSpacing: "0.20em" }}
        >
          household
        </Text>
        <p style={ASIDE_STYLE}>the chores, the shopping, what&rsquo;s on the shelf.</p>
        <Link to="/room/household" style={{ textDecoration: "none", color: "inherit" }}>
          <Box bg="cream" radius="card" shadow="raised" style={{ padding: "16px 18px" }}>
            <Row gap={12} align="baseline" justify="space-between">
              <Text scale="body">Household</Text>
              <Text scale="caption" color={colors.inkFaint}>
                chores · grocery · pantry
              </Text>
            </Row>
          </Box>
        </Link>
      </Stack>

      <Stack gap={8}>
        <Text
          scale="caption"
          color={colors.inkFaint}
          style={{ ...SMCP_STYLE, letterSpacing: "0.20em" }}
        >
          responsibilities
        </Text>
        <p style={ASIDE_STYLE}>the things that won&rsquo;t wait — to-dos, focus, renewals.</p>
        <Link to="/room/responsibilities" style={{ textDecoration: "none", color: "inherit" }}>
          <Box bg="cream" radius="card" shadow="raised" style={{ padding: "16px 18px" }}>
            <Row gap={12} align="baseline" justify="space-between">
              <Text scale="body">Responsibilities</Text>
              <Text scale="caption" color={colors.inkFaint}>
                to-do · work · admin
              </Text>
            </Row>
          </Box>
        </Link>
      </Stack>

      <Stack gap={8}>
        <Text
          scale="caption"
          color={colors.inkFaint}
          style={{ ...SMCP_STYLE, letterSpacing: "0.20em" }}
        >
          money
        </Text>
        <p style={ASIDE_STYLE}>what&rsquo;s moving — the week and the bills, no budgets.</p>
        <Link to="/room/money" style={{ textDecoration: "none", color: "inherit" }}>
          <Box bg="cream" radius="card" shadow="raised" style={{ padding: "16px 18px" }}>
            <Row gap={12} align="baseline" justify="space-between">
              <Text scale="body">Money</Text>
              <Text scale="caption" color={colors.inkFaint}>
                spending · bills
              </Text>
            </Row>
          </Box>
        </Link>
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
