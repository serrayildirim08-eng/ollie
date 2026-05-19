/**
 * apps/web · push registration bootstrap (NL2)
 *
 * Called once on app boot. Installs the platform notification backend on
 * the dispatcher and, on Capacitor iOS, wires the APNs token listeners.
 *
 * IMPORTANT — no cold permission prompt: booting this layer does NOT pop
 * the OS permission dialog. `installCapacitorBackend()` only sets up the
 * APNs `registration` listeners. The iOS system dialog is triggered later,
 * on-demand, by the NotificationPrimer screen calling the dispatcher's
 * `requestPermission()` — see apps/web/src/components/NotificationPrimer.tsx.
 * (A prior audit flagged the old boot-time cold request: the dialog fired
 * on first launch with zero context.)
 *
 * On web / desktop, this is a no-op for permissions — installWebBackend() /
 * installElectronBackend() request lazily on their own.
 *
 * Configure via Vite env (apps/web/.env or wherever):
 *   VITE_PUSH_REGISTER_ENDPOINT  https://ollie-notifications.<sub>.workers.dev/register-token
 *   VITE_PUSH_REGISTER_AUTH      <REGISTER_SHARED_SECRET>
 */

import { installCapacitorBackend } from '@ollie/notifications/backends/capacitor';
import { installWebBackend } from '@ollie/notifications/backends/web';
import { installElectronBackend } from '@ollie/notifications/backends/electron';
import { installStore } from '@ollie/notifications';
import { store } from '../store';
import { getAuthUserId } from './account-boot';

interface OllieGlobal {
  ollie?: { notify?: unknown };
  Capacitor?: { isNativePlatform?: () => boolean };
}

function detectPlatform(): 'capacitor' | 'electron' | 'web' {
  const g = globalThis as unknown as OllieGlobal;
  if (g.Capacitor?.isNativePlatform?.()) return 'capacitor';
  if (g.ollie?.notify) return 'electron';
  return 'web';
}

export async function bootNotificationLayer(): Promise<void> {
  // Wire the store first so dedupe / budget / log have a home.
  installStore(store);

  const platform = detectPlatform();
  try {
    if (platform === 'capacitor') {
      await installCapacitorBackend({
        pushRegisterEndpoint: import.meta.env.VITE_PUSH_REGISTER_ENDPOINT,
        pushRegisterAuth: import.meta.env.VITE_PUSH_REGISTER_AUTH,
        // Phase 1 (Clerk migration): returns null — the push token still
        // registers, just without a user_id association. Re-wired to the
        // Clerk user id in Phase 2.
        getUserId: () => getAuthUserId(),
      });
    } else if (platform === 'electron') {
      await installElectronBackend();
    } else {
      await installWebBackend();
    }
  } catch (err) {
    console.warn('[push-register] backend install failed; staying on noop', err);
  }
}
