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
        minHeight: "100vh",
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
      <ThemeProvider>
        <Gate />
      </ThemeProvider>
    </ClerkProvider>
  </React.StrictMode>,
);
