/**
 * apps/web · App root
 *
 * As of the 2026-05-18 react-router migration this file is a thin shell.
 * What used to be a hand-rolled `useState<Screen>` machine here now lives
 * in:
 *   - `router.tsx`        — the hash route table + the gate layout
 *   - `app-services.tsx`  — shared services context + cross-cutting effects
 *   - `app-gates.ts`      — the four auth/consent/research/onboarding gates
 *
 * `ToastProvider` lives inside `AppRouter` (router.tsx), co-located with
 * `AppServicesProvider` which is the sole consumer of `useToast()`. This
 * makes the provider/consumer coupling explicit and prevents the
 * "useToast must be inside <ToastProvider>" class of error regardless of
 * which entry point mounts `AppRouter`.
 */

import { AppRouter } from './router';
import { ClerkAuthBridge } from './components/ClerkAuthBridge';

export function App() {
  return (
    <>
      {/*
        ClerkAuthBridge pumps the active Clerk session JWT into a sync
        module-scope ref so non-React modules (account-boot.getAuthJwt,
        aiRoute, /label, /enrich-dump, /generate-invite) can read it
        without going async. Renders nothing.
      */}
      <ClerkAuthBridge />
      <AppRouter />
    </>
  );
}
