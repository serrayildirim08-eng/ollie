import React from "react";
import ReactDOM from "react-dom/client";
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignIn,
} from "@clerk/clerk-react";
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/dm-serif-display/400-italic.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./global.css";
import { ThemeProvider } from "./theme";
import { Router } from "./navigation";
// Boot the store + root orchestrator (cadence scanner, sub-orchestrators).
// Side-effect import — evaluating this module runs `createOrchestrator(...).init()`.
// Must precede first render so cadence sources are live before any module mounts.
import "./store";
// Wire the global `ollie:notify` CustomEvent bridge → system notifications.
// Singleton; never torn down for the lifetime of the app window. Any
// feature can fire:
//   window.dispatchEvent(new CustomEvent('ollie:notify', { detail: { title, body } }))
// and get a real macOS / desktop notification when the user has granted
// permission, otherwise a console.log fallback (web preview / pre-grant).
import { installNotifyListener } from "./notify/systemNotify";
installNotifyListener();

// Retention telemetry (installed / session_started / dN_returned). Fire-and-
// forget: consent-gated, queues until Clerk sign-in wires the bearer (see
// AnalyticsBridge in navigation/Router), and never blocks boot.
import { initAnalytics } from "./api/analytics";
initAnalytics();

// Replenishment push scanner — wakes every 30 minutes while the app is open
// and fires `ollie:notify` for any pantry item that's predicted-out within
// the next 24h, gated on the per-item `remind_me` flag. The scanner is a
// no-op when the user has no flagged items or none have crossed the predict
// threshold, so the polling cost is bounded. Runs once immediately so a
// fresh app open doesn't miss a same-day prediction.
import { scanPantryPushes } from "./modules/grocery/pushScanner";
const PUSH_SCAN_INTERVAL_MS = 30 * 60 * 1000;
void scanPantryPushes().catch((err) =>
  console.warn("[pushScanner] initial scan failed", err),
);
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  void scanPantryPushes().catch((err) =>
    console.warn("[pushScanner] interval scan failed", err),
  );
}, PUSH_SCAN_INTERVAL_MS);

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

if (!PUBLISHABLE_KEY) {
  throw new Error(
    "Missing VITE_CLERK_PUBLISHABLE_KEY — add it to apps/native/.env.local. " +
      "See Clerk dashboard → API keys → Publishable key (pk_test_…).",
  );
}

function Gate() {
  return (
    <>
      <SignedIn>
        <Router />
      </SignedIn>
      <SignedOut>
        <SignInGate />
      </SignedOut>
    </>
  );
}

function SignInGate() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--ollie-color-cream, #FAFAF7)",
        padding: 24,
      }}
    >
      <SignIn routing="hash" signUpUrl="#/sign-up" />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <ThemeProvider forceMode="light">
        <Gate />
      </ThemeProvider>
    </ClerkProvider>
  </React.StrictMode>,
);
