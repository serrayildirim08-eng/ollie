/**
 * Router regression tests.
 *
 * As of the 2026-05-19 migration the app root IS the clean-slate v2 shell.
 * The route table collapsed to three concerns:
 *   - `/crisis` and the `/preview/*` surfaces sit ABOVE the gate layout,
 *     reachable in any app state.
 *   - inside the gate layout the index renders the v2-shell, `/settings`
 *     is the one remaining hand-built screen, and every stale screen path
 *     collapses to the shell root via the catch-all.
 *
 * `matchRoutes` resolves paths WITHOUT rendering, so no account boot is
 * needed.
 */
import { describe, it, expect } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { routes } from './router';

/** The leaf path that `matchRoutes` resolves a URL to. */
function resolvedLeaf(pathname: string): string | undefined {
  const matches = matchRoutes(routes, pathname);
  return matches?.[matches.length - 1]?.route.path;
}

describe('route table — the gated app', () => {
  it('the app root resolves through the gate layout', () => {
    // index → ShellHostRoute, a 2-deep chain (GatedLayout → index).
    const matches = matchRoutes(routes, '/');
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('settings is a real route inside the gate layout', () => {
    expect(resolvedLeaf('/settings')).toBe('settings');
    const matches = matchRoutes(routes, '/settings');
    expect(matches && matches.length).toBeGreaterThanOrEqual(2);
  });

  it('every stale screen path collapses to the shell catch-all', () => {
    // home · dashboard · garden · module · insights · voice · gallery ·
    // onboarding are no longer routes — the v2-shell owns in-app
    // navigation, so a stale deep link falls through to `*` → root.
    const stale = [
      '/home',
      '/dashboard',
      '/garden',
      '/module/finance',
      '/insights',
      '/voice',
      '/gallery',
      '/onboarding',
      '/this-screen-does-not-exist',
    ];
    for (const path of stale) {
      expect(resolvedLeaf(path)).toBe('*');
    }
  });
});

describe('route table — surfaces above the gate', () => {
  it('the crisis route sits OUTSIDE the gated layout', () => {
    // Crisis must be reachable pre-auth/pre-consent — a top-level route,
    // not a child of the gate layout (a 1-deep chain).
    expect(matchRoutes(routes, '/crisis')).toHaveLength(1);
  });

  it('the preview hub + the assembled v2 preview are reachable', () => {
    expect(resolvedLeaf('/preview')).toBe('/preview');
    expect(resolvedLeaf('/preview/v2')).toBe('/preview/v2');
    // a single-module preview still resolves
    expect(resolvedLeaf('/preview/work')).toBe('/preview/work');
  });

  it('the preview surfaces sit OUTSIDE the gated layout', () => {
    expect(matchRoutes(routes, '/preview/v2')).toHaveLength(1);
    expect(matchRoutes(routes, '/preview')).toHaveLength(1);
  });
});
