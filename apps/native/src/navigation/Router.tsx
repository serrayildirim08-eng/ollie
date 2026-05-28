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

import { BrowserRouter, Link, Route, Routes } from "react-router";
import { useUser, useClerk } from "@clerk/clerk-react";
import { Layout } from "./Layout";
import { Stack, Row } from "../layout";
import { Text } from "../ui";
import { colors } from "../theme/tokens";
import { DumpScreen } from "../dump";
import { GroceryBox } from "../modules/grocery";
import { PetsBox } from "../modules/pets";
import { BodyBox } from "../modules/body";
import { WorkBox } from "../modules/work";
import { FinanceBox } from "../modules/finance";
import { SleepBox } from "../modules/sleep";
import { AdminBox } from "../modules/admin";
import { HabitsBox } from "../modules/habits";
import { GoalsBox } from "../modules/goals";
import { MedicationBox } from "../modules/medication";
import { CycleBox } from "../modules/cycle";

const SMCP_STYLE: React.CSSProperties = {
  fontVariantCaps: "all-small-caps",
  letterSpacing: "0.08em",
};

export function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DumpScreen />} />
          <Route path="box/grocery" element={<GroceryBox />} />
          <Route path="box/pets" element={<PetsBox />} />
          <Route path="box/body" element={<BodyBox />} />
          <Route path="box/work" element={<WorkBox />} />
          <Route path="box/finance" element={<FinanceBox />} />
          <Route path="box/sleep" element={<SleepBox />} />
          <Route path="box/admin" element={<AdminBox />} />
          <Route path="box/habits" element={<HabitsBox />} />
          <Route path="box/goals" element={<GoalsBox />} />
          <Route path="box/medication" element={<MedicationBox />} />
          <Route path="box/cycle" element={<CycleBox />} />
          <Route path="modules" element={<ModulesIndex />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="box/:id" element={<BoxPlaceholder />} />
          <Route path="*" element={<NotFoundPlaceholder />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

const MODULES: Array<{ id: string; label: string; hint: string }> = [
  { id: "grocery", label: "Grocery", hint: "pantry + shopping" },
  { id: "pets", label: "Pets", hint: "feeds, vet, supplements" },
  { id: "body", label: "Body", hint: "water, movement, symptoms" },
  { id: "work", label: "Work", hint: "tasks + focus" },
  { id: "finance", label: "Finance", hint: "transactions + bills" },
  { id: "sleep", label: "Sleep", hint: "logs + insomnia" },
  { id: "admin", label: "Admin", hint: "renewals + paperwork" },
  { id: "habits", label: "Habits", hint: "streaks + identity" },
  { id: "goals", label: "Goals", hint: "progress + milestones" },
  { id: "medication", label: "Medication", hint: "doses + side effects" },
  { id: "cycle", label: "Cycle", hint: "period + symptoms" },
];

function ModulesIndex() {
  return (
    <Stack gap={32}>
      <Stack gap={8}>
        <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
          modules
        </Text>
        <Text scale="display">All boxes</Text>
      </Stack>
      <Stack gap={4}>
        {MODULES.map((m) => (
          <Link
            key={m.id}
            to={`/box/${m.id}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <Row gap={12} align="baseline" justify="space-between" style={{ padding: "12px 0" }}>
              <Text scale="body">{m.label}</Text>
              <Text scale="caption" color={colors.inkFaint}>
                {m.hint}
              </Text>
            </Row>
          </Link>
        ))}
      </Stack>
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
        <Text scale="display">Settings</Text>
      </Stack>

      <Stack gap={16}>
        <Stack gap={4}>
          <Text scale="caption" color={colors.inkFaint} style={SMCP_STYLE}>
            account
          </Text>
          <Text scale="body">{user?.primaryEmailAddress?.emailAddress ?? "—"}</Text>
        </Stack>

        <button
          onClick={() => void signOut()}
          style={{
            alignSelf: "flex-start",
            background: "none",
            border: "none",
            padding: "12px 0",
            color: colors.inkFaint,
            cursor: "pointer",
            fontVariantCaps: "all-small-caps",
            letterSpacing: "0.08em",
            fontSize: 13,
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
