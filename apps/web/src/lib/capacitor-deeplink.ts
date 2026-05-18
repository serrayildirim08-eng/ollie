/**
 * apps/web · Capacitor deep-link handler (Sprint 4 · E3 · iOS)
 *
 * Listens for `appUrlOpen` events from the Capacitor App plugin and
 * routes ollie://… URLs to the right surface. iOS App Intents
 * (`OllieIntents.swift`) open these URLs when "Hey Siri, Ollie
 * capture" / "remind" / "what's due" fire.
 *
 * URL schemes handled:
 *   ollie://capture          → trigger MicButton via custom window event
 *   ollie://admin?…          → navigate to admin (TODO when routing exists)
 *   ollie://dashboard?…      → navigate to dashboard (TODO)
 *
 * Web / desktop ignore this — only Capacitor native fires `appUrlOpen`.
 */

import { captureInviteFromDeeplink } from './invite';

interface CapApp {
  addListener: (event: string, cb: (data: { url: string }) => void) => Promise<{ remove: () => void }>;
}

/** Custom window event MicButton listens for. */
export const SIRI_CAPTURE_EVENT = 'ollie:siri-capture';

export async function installDeeplinkHandler(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;
  try {
    const mod = await dynImport('@capacitor/app');
    const App = mod?.App as CapApp | undefined;
    if (!App?.addListener) return;
    await App.addListener('appUrlOpen', ({ url }) => {
      handleUrl(url);
    });
  } catch {
    // Capacitor not present — silent no-op (we're in web/desktop).
  }
}

export function handleUrl(url: string): void {
  if (!url || typeof url !== 'string') return;
  if (!url.startsWith('ollie://')) return;
  const path = url.slice('ollie://'.length).split('?')[0];

  // Task 22 — `ollie://invite/<code>` captures the pending invite code
  // so the next ConsentStep render pre-fills the input.
  if (path.startsWith('invite/') || path === 'invite') {
    captureInviteFromDeeplink(url);
    return;
  }

  if (path === 'capture') {
    // MicButton listens for this and calls start().
    try { window.dispatchEvent(new CustomEvent(SIRI_CAPTURE_EVENT, { detail: { source: 'siri' } })); }
    catch { /* noop */ }
    return;
  }

  // Screen deep links. As of the 2026-05-18 react-router migration the
  // app uses hash routing, so a deep link just needs to set the hash —
  // the router (and its gate layout) picks it up on the next tick. The
  // gates still apply: an unauthenticated cold-start deep link lands on
  // AuthFlow first, then resolves to the requested screen post-gate.
  const HASH_TARGETS: Record<string, string> = {
    dashboard: '#/dashboard',
    admin: '#/module/admin',
  };
  const hash = HASH_TARGETS[path];
  if (hash) {
    try {
      window.location.hash = hash;
    } catch {
      /* noop */
    }
    // Keep the legacy event too, in case anything else still listens.
    try {
      window.dispatchEvent(
        new CustomEvent(SIRI_CAPTURE_EVENT, { detail: { source: 'siri', target: path } }),
      );
    } catch { /* noop */ }
  }
}
