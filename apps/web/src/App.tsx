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
 * `ToastProvider` stays at the very top because `AppServicesProvider`
 * (mounted inside `AppRouter`) consumes `useToast()` for the void:toast
 * bridge effect.
 */

import { ToastProvider } from './components/ToastContext';
import { AppRouter } from './router';

export function App() {
  return (
    <ToastProvider>
      <AppRouter />
    </ToastProvider>
  );
}
