/**
 * PetObservationEntry · behavioural tests
 *
 * Covers:
 *   1. collapsed by default — only the trigger button shows
 *   2. opening reveals weight / note / behaviour-tag fields
 *   3. the record button is disabled until something is entered
 *   4. a free-text note alone is recordable; text reaches onRecord verbatim
 *   5. a weight reading folds into text ("weight N kg") + a weight:N tag
 *   6. behaviour quick-pick tags are toggled into the observation
 *   7. occurred_at + pet_id are set on the recorded observation
 *   8. after recording, the panel closes and fields reset
 *   9. DNA: no blame / streak / exclamation copy in the source file
 */

import React, { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { SPECIES_PROFILES } from '@ollie/logic/pets';
import type { Observation } from '@ollie/logic/pets';
import { PetObservationEntry } from './PetObservationEntry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const guineaPig = SPECIES_PROFILES.guinea_pig;

let container: HTMLDivElement;
let root: Root;

function click(el: Element | null): void {
  if (!el) throw new Error('click target not found');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  act(() => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function openPanel(): void {
  click(container.querySelector('button'));
}

function recordBtn(): HTMLButtonElement {
  const btns = Array.from(container.querySelectorAll('button'));
  const btn = btns.find((b) => b.textContent?.includes('add to the notebook'));
  if (!btn) throw new Error('record button not found');
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('PetObservationEntry', () => {
  it('is collapsed by default — only the trigger button shows', () => {
    act(() => {
      root.render(
        <PetObservationEntry petId="p1" speciesProfile={guineaPig} onRecord={() => {}} />,
      );
    });
    expect(container.textContent).toContain('record an observation');
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('opening reveals the weight, note and behaviour fields', () => {
    act(() => {
      root.render(
        <PetObservationEntry petId="p1" speciesProfile={guineaPig} onRecord={() => {}} />,
      );
    });
    openPanel();
    expect(container.querySelector('input[type="number"]')).not.toBeNull();
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.textContent).toContain('what you noticed');
    // species behaviour tags surface as quick-pick chips
    expect(container.textContent).toContain('popcorning');
  });

  it('keeps the record button disabled until something is entered', () => {
    act(() => {
      root.render(
        <PetObservationEntry petId="p1" speciesProfile={guineaPig} onRecord={() => {}} />,
      );
    });
    openPanel();
    expect(recordBtn().disabled).toBe(true);
  });

  it('records a free-text note verbatim into observation.text', () => {
    let recorded: Observation | null = null;
    act(() => {
      root.render(
        <PetObservationEntry
          petId="p1"
          speciesProfile={guineaPig}
          onRecord={(o) => {
            recorded = o;
          }}
        />,
      );
    });
    openPanel();
    const note = container.querySelector('textarea') as HTMLTextAreaElement;
    setValue(note, 'not eating much, a little hunched');
    expect(recordBtn().disabled).toBe(false);
    click(recordBtn());

    expect(recorded).not.toBeNull();
    expect(recorded!.pet_id).toBe('p1');
    expect(recorded!.text).toBe('not eating much, a little hunched');
  });

  it('folds a weight reading into text and adds a weight tag', () => {
    let recorded: Observation | null = null;
    act(() => {
      root.render(
        <PetObservationEntry
          petId="p1"
          speciesProfile={guineaPig}
          onRecord={(o) => {
            recorded = o;
          }}
        />,
      );
    });
    openPanel();
    const weight = container.querySelector('input[type="number"]') as HTMLInputElement;
    setValue(weight, '0.94');
    click(recordBtn());

    expect(recorded).not.toBeNull();
    expect(recorded!.text).toContain('weight 0.94 kg');
    expect(recorded!.tags).toContain('weight:0.94');
  });

  it('toggles behaviour quick-pick tags into the observation', () => {
    let recorded: Observation | null = null;
    act(() => {
      root.render(
        <PetObservationEntry
          petId="p1"
          speciesProfile={guineaPig}
          onRecord={(o) => {
            recorded = o;
          }}
        />,
      );
    });
    openPanel();
    const chips = Array.from(container.querySelectorAll('button'));
    const popcorn = chips.find((b) => b.textContent === 'popcorning');
    click(popcorn ?? null);
    click(recordBtn());

    expect(recorded).not.toBeNull();
    expect(recorded!.tags).toContain('popcorning');
  });

  it('sets occurred_at on the recorded observation', () => {
    let recorded: Observation | null = null;
    const before = Date.now();
    act(() => {
      root.render(
        <PetObservationEntry
          petId="p1"
          speciesProfile={guineaPig}
          onRecord={(o) => {
            recorded = o;
          }}
        />,
      );
    });
    openPanel();
    setValue(container.querySelector('textarea') as HTMLTextAreaElement, 'quiet today');
    click(recordBtn());

    expect(recorded!.occurred_at).toBeGreaterThanOrEqual(before);
    expect(recorded!.occurred_at).toBeLessThanOrEqual(Date.now());
  });

  it('closes the panel and resets fields after recording', () => {
    act(() => {
      root.render(
        <PetObservationEntry petId="p1" speciesProfile={guineaPig} onRecord={() => {}} />,
      );
    });
    openPanel();
    setValue(container.querySelector('textarea') as HTMLTextAreaElement, 'ate well');
    click(recordBtn());
    // panel collapsed again
    expect(container.querySelector('textarea')).toBeNull();
    // reopening shows an empty note field
    openPanel();
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('DNA: rendered copy carries no blame / streak / exclamation', () => {
    act(() => {
      root.render(
        <PetObservationEntry petId="p1" speciesProfile={guineaPig} onRecord={() => {}} />,
      );
    });
    openPanel();
    const copy = (container.textContent ?? '').toLowerCase();
    expect(copy).not.toContain('!');
    expect(copy).not.toContain('streak');
    expect(copy).not.toContain('you forgot');
    expect(copy).not.toContain('you missed');
  });

  it('DNA: source placeholders carry no blame / streak / exclamation', () => {
    const src = readFileSync(join(__dirname, 'PetObservationEntry.tsx'), 'utf8');
    // user-facing string literals only — exclude code operators
    const literals = src.match(/(["'])(?:(?!\1).)*\1/g) ?? [];
    const copy = literals.join(' ').toLowerCase();
    expect(copy).not.toContain('streak');
    expect(copy).not.toContain('you forgot');
    expect(copy).not.toContain('you missed');
  });
});
