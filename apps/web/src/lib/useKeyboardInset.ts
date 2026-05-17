/**
 * useKeyboardInset — pure-web on-screen keyboard tracking.
 *
 * Returns how many pixels the on-screen keyboard currently overlaps the
 * bottom of the layout viewport. When the keyboard is closed (or the
 * platform doesn't expose `visualViewport`), returns 0.
 *
 * How it works:
 *   `window.visualViewport` reports the *visual* viewport — the part of
 *   the page actually visible above the keyboard. The layout viewport
 *   (`window.innerHeight`) does not shrink when the iOS keyboard opens;
 *   the visual viewport does. The difference (minus any scroll offset
 *   the browser applied to keep the focused field visible) is exactly
 *   how far the keyboard intrudes into the layout.
 *
 *     inset = innerHeight - visualViewport.height - visualViewport.offsetTop
 *
 * This needs NO Capacitor plugin and works inside the iOS WKWebView
 * (visualViewport is supported there since iOS 13).
 *
 * Consumers typically translate a bottom-anchored bar up by this value
 * so the keyboard never covers it.
 */

import { useEffect, useState } from 'react';

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    // Unsupported — return a stable 0 and never attach listeners.
    if (!vv) return;

    const update = () => {
      const next = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setInset((prev) => (prev === next ? prev : next));
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
