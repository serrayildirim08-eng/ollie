/**
 * Router regression tests.
 *
 * The react-router migration exists to fix three bugs the old
 * `useState<Screen>` machine shipped:
 *   1. hardware/browser Back did nothing,
 *   2. deep links could not open a specific screen,
 *   3. a refresh always landed on home.
 *
 * (1) and (3) are properties of the history stack and are exercised at
 * runtime; (2) — every screen being reachable by URL — is structural and
 * is asserted here against the route table with `matchRoutes`, which
 * resolves paths WITHOUT rendering (so no account boot is needed).
 */
import { describe, it, expect } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { routes } from './router';

/** The leaf path that `matchRoutes` resolves a URL to. */
function resolvedLeaf(pathname: string): string | undefined {
  const matches = matchRoutes(routes, pathname);
  return matches?.[matches.length - 1]?.route.path;
}

describe('route table — deep-link reachability (bug 2)', () => {
  // Every screen Serra's spec named must resolve to a real route.
  const screens: Array<[string, string]> = [
    ['/home', 'home'],
    ['/dashboard', 'dashboard'],
    ['/garden', 'garden'],
    ['/settings', 'settings'],
    ['/insights', 'insights'],
    ['/voice', 'voice'],
    ['/gallery', 'gallery'],
    ['/crisis', '/crisis'],
  ];

  it.each(screens)('deep link %s resolves to a route', (url, leaf) => {
    expect(resolvedLeaf(url)).toBe(leaf);
  });

  it('module deep link resolves with its :id param', () => {
    const matches = matchRoutes(routes, '/module/finance');
    const leaf = matches?.[matches.length - 1];
    expect(leaf?.route.path).toBe('module/:id');
    expect(leaf?.params.id).toBe('finance');
  });

  it('the crisis route sits OUTSIDE the gated layout', () => {
    // Crisis must be reachable pre-auth/pre-consent — so it is a
    // top-level route, not a child of the gate layout.
    const matches = matchRoutes(routes, '/crisis');
    expect(matches).toHaveLength(1); // no GatedLayout parent in the chain
  });

  it('gated screens sit INSIDE the gated layout', () => {
    // A normal screen resolves through the gate layout (2-deep chain).
    const matches = matchRoutes(routes, '/dashboard');
    expect(matches && matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('route table — fallbacks', () => {
  it('the index path redirects (no blank screen)', () => {
    const matches = matchRoutes(routes, '/');
    expect(matches).not.toBeNull();
    // The index route is a <Navigate> — it still matches.
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('an unknown deep link still matches (catch-all → home)', () => {
    const matches = matchRoutes(routes, '/this-screen-does-not-exist');
    expect(matches).not.toBeNull();
    expect(resolvedLeaf('/this-screen-does-not-exist')).toBe('*');
  });

  it('the legacy onboarding path is routable', () => {
    expect(resolvedLeaf('/onboarding')).toBe('onboarding');
  });
});
