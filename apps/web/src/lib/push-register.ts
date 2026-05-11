/**
 * apps/web · push registration bootstrap (NL2)
 *
 * Called once on app boot when running inside Capacitor iOS. Installs
 * the capacitor backend on the notification dispatcher AND registers
 * the device with APNs, forwarding the token to the Cloudflare Worker.
 *
 * On web / desktop, this is a no-op — installWebBackend() /
 * installElectronBackend() take care of those platforms separately.
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
