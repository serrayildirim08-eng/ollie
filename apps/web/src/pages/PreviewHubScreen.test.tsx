/**
 * PreviewHubScreen · behavioral tests + route reachability
 *
 * The hub is the tappable entry point that makes the clean-slate v2
 * redesign reachable in the native iOS app (no URL bar). These tests
 * cover the two things that matter:
 *
 *   STRUCTURE
 *     1. `/preview` resolves to a real route OUTSIDE the gated layout
 *        (reachable directly, like `/crisis` and the other previews).
 *
 *   BEHAVIOR
 *     2. the hub renders the "full new app" row.
 *     3. the hub renders all 12 individual module rows.
 *     4. tapping the full-app row calls onOpen('/preview/v2').
 *     5. tapping a module row calls onOpen with its `/preview/{module}`.
 *     6. tapping back calls onExit.
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { matchRoutes } from 'react-router-dom';

import { routes } from '../router';
import { PreviewHubScreen } from './PreviewHubScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── 1 · route reachability ──────────────────────────────────────────────────

describe('PreviewHubScreen · route', () => {
  /** The leaf path `matchRoutes` resolves a URL to. */
  function resolvedLeaf(pathname: string): string | undefined {
    const matches = matchRoutes(routes, pathname);
    return matches?.[matches.length - 1]?.route.path;
  }

  it('/preview resolves to a real route', () => {
    expect(resolvedLeaf('/preview')).toBe('/preview');
  });

  it('/preview sits OUTSIDE the gated layout (reachable directly)', () => {
    // Like /crisis: a top-level route, not a child of GatedLayout, so it
    // is reachable without going through auth / consent / onboarding.
    const matches = matchRoutes(routes, '/preview');
    expect(matches).toHaveLength(1);
  });
});

// ─── 2 · behavior ────────────────────────────────────────────────────────────

describe('PreviewHubScreen · behavior', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(props: Parameters<typeof PreviewHubScreen>[0]) {
    act(() => {
      root.render(<PreviewHubScreen {...props} />);
    });
  }

  it('renders the full-new-app row', () => {
    render({ onOpen: vi.fn(), onExit: vi.fn() });
    const btn = host.querySelector('button[aria-label="open the full new app"]');
    expect(btn).not.toBeNull();
  });

  it('renders all 12 individual module rows', () => {
    render({ onOpen: vi.fn(), onExit: vi.fn() });
    const modules = [
      'money', 'cycle', 'sleep', 'body', 'medication', 'habits',
      'partner', 'admin', 'pets', 'grocery', 'work', 'goals',
    ];
    for (const m of modules) {
      const btn = host.querySelector(`button[aria-label="open ${m} preview"]`);
      expect(btn, `${m} row should render`).not.toBeNull();
    }
  });

  it('tapping the full-app row opens /preview/v2', () => {
    const onOpen = vi.fn();
    render({ onOpen, onExit: vi.fn() });
    const btn = host.querySelector(
      'button[aria-label="open the full new app"]',
    ) as HTMLButtonElement;
    act(() => btn.click());
    expect(onOpen).toHaveBeenCalledWith('/preview/v2');
  });

  it('tapping a module row opens its /preview/{module} route', () => {
    const onOpen = vi.fn();
    render({ onOpen, onExit: vi.fn() });
    const btn = host.querySelector(
      'button[aria-label="open money preview"]',
    ) as HTMLButtonElement;
    act(() => btn.click());
    expect(onOpen).toHaveBeenCalledWith('/preview/money');
  });

  it('tapping back calls onExit', () => {
    const onExit = vi.fn();
    render({ onOpen: vi.fn(), onExit });
    const btn = host.querySelector(
      'button[aria-label="back to settings"]',
    ) as HTMLButtonElement;
    act(() => btn.click());
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
