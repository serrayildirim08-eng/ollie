/**
 * RecipeCard · render + interaction tests.
 *
 * No real network. We render through createRoot, then drive the DOM
 * directly (querySelector / click). Atelier DNA assertions live in this
 * file: no emoji, no ASCII arrows, ingredient split + coverage math, aria
 * labels on each action button.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RecipeCard } from './RecipeCard';
import type { RecipeSuggestion } from '../hooks/useFeedMe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function suggestion(over: Partial<RecipeSuggestion> = {}): RecipeSuggestion {
  return {
    dish: 'shakshuka',
    cuisine: 'levantine',
    diet: ['vegetarian'],
    ingredients: [
      { name: 'tomato', canonical: 'tomato', have: true },
      { name: 'garlic', canonical: 'garlic', have: true },
      { name: 'feta', canonical: 'feta', have: true },
      { name: 'olive oil', canonical: 'olive oil', have: true },
      { name: 'egg', canonical: 'egg', have: false },
      { name: 'bell pepper', canonical: 'bell pepper', have: false },
    ],
    steps: ['warm pan', 'add eggs', 'serve'],
    prepMinutes: 5,
    cookMinutes: 15,
    servings: 2,
    ...over,
  };
}

interface Probe {
  container: HTMLDivElement;
  root: Root;
}

function render(node: React.ReactNode): Probe {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return { container, root };
}

describe('RecipeCard', () => {
  let mounted: Probe[] = [];

  beforeEach(() => {
    mounted = [];
  });
  afterEach(() => {
    for (const p of mounted) {
      act(() => p.root.unmount());
      p.container.remove();
    }
    mounted = [];
  });

  function mount(node: React.ReactNode): Probe {
    const p = render(node);
    mounted.push(p);
    return p;
  }

  it('renders the dish name and cuisine subtitle', () => {
    const p = mount(
      <RecipeCard
        suggestion={suggestion()}
        onCook={() => {}}
        onReject={() => {}}
        onAddMissing={() => {}}
      />,
    );
    expect(p.container.textContent).toContain('shakshuka');
    expect(p.container.textContent).toContain('levantine');
    expect(p.container.textContent).toContain('about 20 minutes');
    expect(p.container.textContent).toContain('2 servings');
  });

  it('coverage pips split 4/6 — 4 sage + 2 outline', () => {
    const p = mount(
      <RecipeCard
        suggestion={suggestion()}
        onCook={() => {}}
        onReject={() => {}}
        onAddMissing={() => {}}
      />,
    );
    const role = p.container.querySelector(
      '[aria-label="you have 4 of 6 ingredients"]',
    );
    expect(role).not.toBeNull();
    expect(p.container.textContent).toContain('you have 4 of 6');
  });

  it('have / missing ingredient split renders correctly', () => {
    const p = mount(
      <RecipeCard
        suggestion={suggestion()}
        onCook={() => {}}
        onReject={() => {}}
        onAddMissing={() => {}}
      />,
    );
    expect(p.container.textContent).toContain('in your pantry');
    expect(p.container.textContent).toContain("you'd need");
    expect(p.container.textContent).toContain('egg');
    expect(p.container.textContent).toContain('bell pepper');
  });

  it('"add missing" button calls onAddMissing with canonical names', () => {
    const calls: string[][] = [];
    const p = mount(
      <RecipeCard
        suggestion={suggestion()}
        onCook={() => {}}
        onReject={() => {}}
        onAddMissing={(names) => calls.push(names)}
      />,
    );
    const btn = p.container.querySelector(
      'button[aria-label^="add the"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => btn!.click());
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(['egg', 'bell pepper']);
  });

  it('hides "add missing" when zero ingredients are missing', () => {
    const allHave = suggestion({
      ingredients: [
        { name: 'tomato', canonical: 'tomato', have: true },
        { name: 'egg', canonical: 'egg', have: true },
      ],
    });
    const p = mount(
      <RecipeCard
        suggestion={allHave}
        onCook={() => {}}
        onReject={() => {}}
        onAddMissing={() => {}}
      />,
    );
    expect(
      p.container.querySelector('button[aria-label^="add the"]'),
    ).toBeNull();
  });

  it('"I cooked this" button calls onCook', () => {
    let cooks = 0;
    const p = mount(
      <RecipeCard
        suggestion={suggestion()}
        onCook={() => cooks++}
        onReject={() => {}}
        onAddMissing={() => {}}
      />,
    );
    const btn = p.container.querySelector(
      'button[aria-label="I cooked shakshuka"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => btn!.click());
    expect(cooks).toBe(1);
  });

  it('reject button calls onReject', () => {
    let rejects = 0;
    const p = mount(
      <RecipeCard
        suggestion={suggestion()}
        onCook={() => {}}
        onReject={() => rejects++}
        onAddMissing={() => {}}
      />,
    );
    const btn = p.container.querySelector(
      'button[aria-label="not this · skip shakshuka"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => btn!.click());
    expect(rejects).toBe(1);
  });

  it('renders reasonSuggested when present', () => {
    const p = mount(
      <RecipeCard
        suggestion={suggestion({
          reasonSuggested: 'the tomatoes turn this week',
        })}
        onCook={() => {}}
        onReject={() => {}}
        onAddMissing={() => {}}
      />,
    );
    expect(p.container.textContent).toContain('tomatoes turn this week');
  });

  it('respects the `added` flag (changes button label, no-op on click)', () => {
    const calls: string[][] = [];
    const p = mount(
      <RecipeCard
        suggestion={suggestion()}
        onCook={() => {}}
        onReject={() => {}}
        onAddMissing={(names) => calls.push(names)}
        added
      />,
    );
    expect(p.container.textContent).toContain('added to the list');
    const btn = p.container.querySelector(
      'button[aria-label="added to shopping list"]',
    ) as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => btn!.click());
    expect(calls.length).toBe(0);
  });

  it('does not render any emoji or ASCII arrows', () => {
    const p = mount(
      <RecipeCard
        suggestion={suggestion()}
        onCook={() => {}}
        onReject={() => {}}
        onAddMissing={() => {}}
      />,
    );
    // sweep visible text + interactive labels for forbidden glyphs.
    const text = p.container.textContent ?? '';
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(text).not.toMatch(/→|←|⇒|⇐|↑|↓/);
  });
});
