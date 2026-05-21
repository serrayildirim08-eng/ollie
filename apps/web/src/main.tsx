import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/capacitor';
import * as SentryReact from '@sentry/react';
import { ClerkProvider } from '@clerk/react';
import { App } from './App';
import { ErrorFallback } from './components/ErrorFallback';
import { bootNotificationLayer } from './lib/push-register';
import { installSavingsDigestLoop } from './lib/savings-digest';
import { bootAccount } from './lib/account-boot';
import { installDeeplinkHandler } from './lib/capacitor-deeplink';
import { captureInviteFromUrl } from './lib/invite';
import { installGroceryRoutingMockFromURL } from './devtools/groceryRoutingMock';
import { installReplenishmentMockFromURL } from './devtools/replenishmentMock';
import { installFeedMeMockFromURL } from './devtools/feedMeMock';

// Sentry — error tracking. Capacitor SDK wraps the React SDK so we get
// JS errors + native iOS crashes from the same project. MUST init before
// any boot* call so it can capture errors thrown during account/
// notification bootstrap.
// Privacy:
//   beforeSend strips event.extra.encrypted so opt-in encrypted blobs
//   never leak to Sentry. ollie is privacy-first; any payload that
//   touches an external service must be sanitised here.
const sentryDsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? '';
// Tunnel — Turkish ISP DPI blocks TLS to *.sentry.io. Route envelopes
// through our Cloudflare worker (workers.dev is unblocked) when the
// tunnel URL is set. Falls back to direct ingest when unset.
const sentryTunnel = (import.meta.env.VITE_SENTRY_TUNNEL_URL as string | undefined) ?? '';
if (sentryDsn) {
  Sentry.init(
    {
      dsn: sentryDsn,
      ...(sentryTunnel ? { tunnel: sentryTunnel } : {}),
      tracesSampleRate: 0.1,
      beforeSend(event) {
        // Strip the encrypted payload field from event.extra — privacy
        // guard. Mutates the event in place (Sentry expects this).
        if (event.extra && 'encrypted' in event.extra) {
          const { encrypted: _stripped, ...rest } = event.extra;
          event.extra = rest;
        }
        return event;
      },
    },
    SentryReact.init,
  );
}

// Boot account layer (Credibility audit C2): wires @ollie/auth +
// @ollie/sync + @ollie/research-stream into the running app. Idempotent.
bootAccount();

// Task 22 — capture invite code from `?invite=…`, `#invite=…`, or the
// Capacitor `ollie://invite/…` deep-link path. Writes to sessionStorage
// so the onboarding gate (ConsentStep) can pre-fill. Strips the param
// from the URL via history.replaceState so reloads don't double-fire.
captureInviteFromUrl();

// iOS Siri App Intents → URL scheme → MicButton (Sprint 4 · E3).
// No-op on web/desktop; Capacitor native only.
void installDeeplinkHandler();

// Devtool — `?mock=grocery_<fixture>` triggers a canned grocery routing
// sequence so SortedToast + PendingHair can be exercised without the
// backend AI router being live. No-op when the param is absent.
installGroceryRoutingMockFromURL();

// Devtool — `?mock=replenish_<fixture>` seeds the useReplenishment cache
// so the adaptive-replenishment badge can be exercised across confidence
// states without the worker `/replenishment/:user` endpoint being live.
installReplenishmentMockFromURL();

// Devtool — `?mock=feedme_<fixture>` seeds the useFeedMe cache so the
// 3-card Feed Me face can be exercised across user / pet / loading /
// fallback / empty states without the worker `/feed-me/:user` endpoint.
installFeedMeMockFromURL();
import './design/tokens.css';
import './design/animations.css';
import './design/breakpoints.css';

// Boot notifications layer (NL1-NL3). Async — install runs in
// parallel with first render; calls before backend is ready fall
// through to the noop path and are still logged + budget-checked.
void bootNotificationLayer().then(() => {
  installSavingsDigestLoop();
});

// Service worker — caches /videos/* /audio/* /fonts/* for offline + first-paint speed.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[ollie] sw registration failed:', err);
    });
  });
}

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

// Clerk — identity / login layer (2026-05-19, replaces Supabase Auth).
// Key comes from VITE_CLERK_PUBLISHABLE_KEY in .env.local. Clerk owns ONLY
// "who is signed in" — the passphrase-derived encryption vault (@ollie/auth)
// is a separate layer and is NOT Clerk's responsibility.
const clerkPublishableKey =
  (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined) ?? '';
if (!clerkPublishableKey) {
  console.error('[ollie] VITE_CLERK_PUBLISHABLE_KEY missing — sign-in will fail');
}

createRoot(root).render(
  <StrictMode>
    <SentryReact.ErrorBoundary fallback={<ErrorFallback />}>
      <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    </SentryReact.ErrorBoundary>
  </StrictMode>,
);
