/**
 * apps/web · useIsWideViewport — the desktop / phone viewport switch
 *
 * The SAME `apps/web` web app is loaded by both an iPhone Capacitor shell
 * and an Electron desktop shell. Several layers need to know which one
 * they are running in so they can pick a desktop layout over a phone one:
 *
 *   - `router.tsx`'s `ShellHostRoute` picks `DesktopShell` ("thin spine")
 *     over the phone `ShellApp` (single-column swipe deck).
 *   - the shared `<Screen>` primitive (every v2 module page mounts inside
 *     one) drops its phone chrome — the swipe handle, the safe-area
 *     insets, the corner Find/Safe dots — and reads as a real desktop page.
 *
 * A single `resize` listener flips the flag live, so dragging the Electron
 * window across the breakpoint swaps layouts with no reload.
 *
 * The breakpoint is 900px: comfortably above the phone column width and
 * matching `DesktopShell`'s lower `clamp()` floor, so the spine + canvas
 * always have room to read as a real desktop app.
 *
 * SSR / test note: when `window` is absent the hook returns `false` (phone
 * mode) — the safe default. jsdom reports a 1024px `innerWidth`; tests
 * that must exercise desktop mode set a narrow/wide `innerWidth` and fire
 * a `resize` event themselves.
 */
import { useEffect, useState } from 'react';

/** the desktop layout floor — see the module doc-comment */
export const DESKTOP_MIN_WIDTH = 900;

/**
 * `true` when the viewport is at least `DESKTOP_MIN_WIDTH` wide. Re-renders
 * the caller on `resize` so a window dragged across the breakpoint swaps
 * layouts live.
 */
export function useIsWideViewport(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= DESKTOP_MIN_WIDTH,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onResize() {
      setWide(window.innerWidth >= DESKTOP_MIN_WIDTH);
    }
    window.addEventListener('resize', onResize);
    // sync once in case the window changed before the listener attached
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return wide;
}
