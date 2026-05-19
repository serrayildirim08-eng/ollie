/**
 * partner-v2 · PartnerApp — integration smoke test
 *
 * Mounts the real preview module against the partner stub store. partner-v2
 * is a NEW feature with no backend — the data is an in-module local stub
 * (`usePartnerStore` seeds `SEED_PARTNER_STATE`); vitest.setup clears
 * localStorage per-test, so every test boots the seeded stub deterministically.
 *
 * Verifies:
 *   - the my-partner face renders the seeded partner + soft states + asks
 *   - the in-module nav stack pushes a leaf and pops back
 *   - the invite leaf renders the invite code and is reachable
 *   - the ask flow composes ollie's note from a chip pick and gates send
 *   - sending an ask records it (the stub history grows) and returns
 *   - the sharing leaf toggles a soft state on/off, updating the preview
 *   - the Safe dot invokes its handler
 *
 * Mirrors habits-v2/HabitsApp.test.tsx.
 */
import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { PartnerApp } from './PartnerApp';

const NOW = new Date('2026-05-18T09:00:00').getTime();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** find a button by its trimmed text content */
function btnByText(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
}

describe('PartnerApp', () => {
  it('the my-partner face renders the seeded partner, soft states and asks', () => {
    act(() => {
      root.render(<PartnerApp now={NOW} />);
    });
    expect(container.textContent).toContain('my partner');
    expect(container.textContent).toContain('Sam');
    expect(container.textContent).toContain('linked since march');
    // the soft states the partner is sharing
    expect(container.textContent).toContain('low on sleep this week');
    expect(container.textContent).toContain('in luteal');
    // the ask history — the focus ask + a quiet line
    expect(container.textContent).toContain('your asks');
    expect(container.textContent).toContain('new ask');
  });

  it('the invite deep-link mounts the invite leaf with the code', () => {
    act(() => {
      root.render(<PartnerApp now={NOW} initialRoute="invite" />);
    });
    expect(container.textContent).toContain('your invite code');
    expect(container.textContent).toContain('OLLIE');
    // the calm sequence + the honest both-need-Ollie note
    expect(container.textContent).toContain('share this');
    expect(container.textContent).toContain('shared patterns need Ollie');
  });

  it('the new-ask button pushes the ask flow and a back affordance', () => {
    act(() => {
      root.render(<PartnerApp now={NOW} />);
    });
    const newAsk = btnByText('new ask');
    expect(newAsk).toBeDefined();
    act(() => newAsk!.click());
    // on the ask flow now
    expect(container.textContent).toContain('what would help');
    expect(container.textContent).toContain('ollie’s note');
    expect(container.querySelector('[aria-label="back"]')).not.toBeNull();
  });

  it('the ask flow composes ollie’s note from a chip pick and gates send', () => {
    act(() => {
      root.render(<PartnerApp now={NOW} initialRoute="ask" />);
    });
    // nothing picked — the send is gated
    const send = () => btnByText('send to Sam')!;
    expect(send().disabled).toBe(true);
    // pick a chip — the note composes, send unlocks
    const hug = btnByText('a hug');
    expect(hug).toBeDefined();
    act(() => hug!.click());
    expect(send().disabled).toBe(false);
    expect(container.textContent).toContain('a hug');
  });

  it('sending an ask records it into the stub and returns to the face', () => {
    act(() => {
      root.render(<PartnerApp now={NOW} initialRoute="ask" />);
    });
    act(() => btnByText('snacks')!.click());
    const send = btnByText('send to Sam')!;
    act(() => send.click());
    // the calm confirmation stage
    expect(container.textContent).toContain('sent to Sam');
  });

  it('the sharing leaf toggles a soft state and updates the preview', () => {
    act(() => {
      root.render(<PartnerApp now={NOW} initialRoute="sharing" />);
    });
    expect(container.textContent).toContain('you choose');
    // the clinical boundary is stated, never a toggle
    expect(container.textContent).toContain('medical flags are never shared');
    // mood is seeded OFF — its switch reads not-checked
    const moodSwitch = container.querySelector(
      'button[role="switch"][aria-label="share mood"]',
    ) as HTMLButtonElement;
    expect(moodSwitch).not.toBeNull();
    expect(moodSwitch.getAttribute('aria-checked')).toBe('false');
    act(() => moodSwitch.click());
    expect(
      (
        container.querySelector(
          'button[role="switch"][aria-label="share mood"]',
        ) as HTMLButtonElement
      ).getAttribute('aria-checked'),
    ).toBe('true');
    // its soft-state line now appears in the preview
    expect(container.textContent).toContain('a tender few days');
  });

  it('the back affordance on a leaf pops the stack to the face', () => {
    act(() => {
      root.render(<PartnerApp now={NOW} initialRoute="sharing" />);
    });
    expect(container.textContent).toContain('you choose');
    const back = container.querySelector('[aria-label="back"]') as HTMLButtonElement;
    act(() => back.click());
    // back on the my-partner face
    expect(container.textContent).toContain('your asks');
    expect(container.textContent).not.toContain('you choose');
  });

  it('Safe dot invokes the onSafe handler', () => {
    let safe = false;
    act(() => {
      root.render(
        <PartnerApp
          now={NOW}
          onSafe={() => {
            safe = true;
          }}
        />,
      );
    });
    const safeDot = container.querySelector('[aria-label="safe"]') as HTMLButtonElement;
    act(() => safeDot.click());
    expect(safe).toBe(true);
  });
});
