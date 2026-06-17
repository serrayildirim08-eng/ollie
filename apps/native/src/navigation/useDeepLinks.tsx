/**
 * ollie:// deep-link routing (A2).
 *
 * Resolves three external entry points to in-app routes:
 *   - ollie://dump        → "/" with the dump input focused
 *   - ollie://box/:id     → "/box/:id" (a module)
 *   - ollie://todo        → "/todo"
 *
 * Handles BOTH the warm path (onOpenUrl, app already running — notification
 * tap, Siri, widget) and the COLD-START path (getCurrent(), app launched BY
 * the link). Mounted once inside <BrowserRouter> so useNavigate has context.
 *
 * Best-effort: the plugin is only present in the Tauri runtime; in a plain
 * browser (vitest, web preview) the dynamic import resolves to a no-op so the
 * hook never throws.
 */
import { useEffect, useRef } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router';

/** The stable id set on the dump Textarea so we can focus it after navigating. */
export const DUMP_INPUT_ID = 'ollie-dump-input';

/** Map an incoming ollie:// URL to an in-app path, or null if unrecognised. */
export function resolveDeepLink(raw: string): { path: string; focusDump?: boolean } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'ollie:') return null;

  // ollie://dump → host="dump"; ollie://box/grocery → host="box", path="/grocery".
  const host = url.hostname;
  const rest = url.pathname.replace(/^\/+/, ''); // strip leading slashes

  if (host === 'dump') return { path: '/', focusDump: true };
  if (host === 'todo') return { path: '/todo' };
  if (host === 'box' && rest) return { path: `/box/${rest}` };
  return null;
}

function applyDeepLink(raw: string, navigate: NavigateFunction): boolean {
  const target = resolveDeepLink(raw);
  if (!target) return false;
  navigate(target.path);
  if (target.focusDump) {
    // Let the route render before focusing.
    setTimeout(() => {
      const el = document.getElementById(DUMP_INPUT_ID) as HTMLTextAreaElement | null;
      el?.focus();
    }, 120);
  }
  return true;
}

export function useDeepLinks(): void {
  const navigate = useNavigate();
  // Guard against the cold-start URL being handled twice (StrictMode double-run).
  const coldHandled = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      let mod: typeof import('@tauri-apps/plugin-deep-link') | null = null;
      try {
        mod = await import('@tauri-apps/plugin-deep-link');
      } catch {
        return; // not in a Tauri runtime — nothing to wire.
      }
      if (cancelled || !mod) return;

      // Cold start: the app was launched by the link.
      if (!coldHandled.current) {
        coldHandled.current = true;
        try {
          const current = await mod.getCurrent();
          if (current && current.length) applyDeepLink(current[0], navigate);
        } catch {
          /* no cold-start url */
        }
      }

      // Warm path: links arriving while the app is already open.
      try {
        unlisten = await mod.onOpenUrl((urls) => {
          if (urls.length) applyDeepLink(urls[0], navigate);
        });
      } catch {
        /* listener unavailable */
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [navigate]);
}
