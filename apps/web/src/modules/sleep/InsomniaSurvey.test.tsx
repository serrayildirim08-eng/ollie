/**
 * InsomniaSurvey · unit tests
 *
 * Covers:
 *   - intro → question flow advances on each answer
 *   - all 7 questions present, in canonical order
 *   - completing the last question writes sleep.insomnia_survey_answers
 *     (7-element 0–4 array)
 *   - the written array is what scoreInsomniaSurvey would accept
 *   - when sleep.insomnia_survey_result is present, the result phase
 *     renders the score + a non-judgmental band line
 *   - "back" steps the question index down
 *   - banned-phrase smoke check on visible copy
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── store mock ────────────────────────────────────────────────────────────
// Shadow apps/web/src/store with an in-memory map (same shape as the
// WindDownChecklist test harness).

const __storeData = new Map<string, unknown>();
const __sliceListeners = new Set<() => void>();

vi.mock('../../store', async () => {
  const ReactMod = await import('react');
  return {
    store: {
      set: (mod: string, key: string, value: unknown) => {
        __storeData.set(`${mod}:${key}`, value);
        __sliceListeners.forEach((fn) => fn());
      },
      get: (mod: string, key: string, fallback: unknown) => {
        const k = `${mod}:${key}`;
        return __storeData.has(k) ? __storeData.get(k) : fallback;
      },
      subscribe: () => () => {},
    },
    useStoreSlice: <T,>(mod: string, key: string, defaultValue: T): [T, (v: T) => void] => {
      const k = `${mod}:${key}`;
      const [, force] = ReactMod.useState(0);
      ReactMod.useEffect(() => {
        const listener = (): void => force((n) => n + 1);
        __sliceListeners.add(listener);
        return () => { __sliceListeners.delete(listener); };
      }, []);
      const val = (__storeData.has(k) ? __storeData.get(k) : defaultValue) as T;
      const setter = (v: T): void => {
        __storeData.set(k, v);
        __sliceListeners.forEach((fn) => fn());
      };
      return [val, setter];
    },
  };
});

import { InsomniaSurvey } from './InsomniaSurvey';
import { store } from '../../store';
import {
  INSOMNIA_SURVEY_QUESTIONS,
  scoreInsomniaSurvey,
} from '@ollie/logic/sleep';

// ─── harness ───────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  __storeData.clear();
  onClose.mockReset();
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

function mount(): void {
  act(() => {
    root.render(<InsomniaSurvey onClose={onClose} />);
  });
}

/** Click the button whose visible text starts with `text`. */
function clickByText(text: string): void {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').trim().toLowerCase().startsWith(text.toLowerCase()),
  );
  if (!btn) throw new Error(`no button starting with "${text}"`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Click the Nth radio option in the current question (0-indexed). */
function clickOption(n: number): void {
  const radios = container.querySelectorAll('button[role="radio"]');
  const r = radios[n] as HTMLButtonElement | undefined;
  if (!r) throw new Error(`no radio option #${n}`);
  act(() => {
    r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

// ─── intro ─────────────────────────────────────────────────────────────────

describe('InsomniaSurvey · intro', () => {
  it('opens on the intro phase with a begin button', () => {
    mount();
    expect((container.textContent ?? '').toLowerCase()).toContain('seven questions');
    const begin = Array.from(container.querySelectorAll('button')).some((b) =>
      (b.textContent ?? '').trim() === 'begin',
    );
    expect(begin).toBe(true);
  });

  it('"not now" closes without writing answers', () => {
    mount();
    clickByText('not now');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(store.get('sleep', 'insomnia_survey_answers', null)).toBeNull();
  });
});

// ─── question flow ─────────────────────────────────────────────────────────

describe('InsomniaSurvey · question flow', () => {
  it('shows question 1 of 7 after begin, in canonical order', () => {
    mount();
    clickByText('begin');
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).toContain('question 1 of 7');
    expect(text).toContain(INSOMNIA_SURVEY_QUESTIONS[0].prompt.toLowerCase());
  });

  it('answering advances through all 7 questions', () => {
    mount();
    clickByText('begin');
    for (let q = 0; q < INSOMNIA_SURVEY_QUESTIONS.length; q++) {
      expect((container.textContent ?? '')).toContain(`question ${q + 1} of 7`);
      clickOption(0); // pick "none" / best each time
    }
    // After the 7th answer we land on the result phase.
    expect((container.textContent ?? '').toLowerCase()).toContain('what the answers say');
  });

  it('"back" steps the question index down', () => {
    mount();
    clickByText('begin');
    clickOption(2); // answer q1 → q2
    expect((container.textContent ?? '')).toContain('question 2 of 7');
    clickByText('back');
    expect((container.textContent ?? '')).toContain('question 1 of 7');
  });
});

// ─── store write ───────────────────────────────────────────────────────────

describe('InsomniaSurvey · store write', () => {
  it('writes a valid 7-element 0–4 answer array on completion', () => {
    mount();
    clickByText('begin');
    // Answer each question with option index 2 ("moderate"/"somewhat").
    for (let q = 0; q < INSOMNIA_SURVEY_QUESTIONS.length; q++) {
      clickOption(2);
    }
    const answers = store.get<number[] | null>('sleep', 'insomnia_survey_answers', null);
    expect(Array.isArray(answers)).toBe(true);
    expect(answers).toHaveLength(7);
    expect(answers!.every((a) => a === 2)).toBe(true);

    // The written array is exactly what the scorer accepts.
    const scored = scoreInsomniaSurvey(answers, 1_700_000_000_000);
    expect(scored).not.toBeNull();
    expect(scored!.score).toBe(14); // 7 × 2
    expect(scored!.band).toBe('subthreshold');
  });

  it('does not write answers until the final question is answered', () => {
    mount();
    clickByText('begin');
    // Answer only the first 6 of 7.
    for (let q = 0; q < 6; q++) clickOption(1);
    expect(store.get('sleep', 'insomnia_survey_answers', null)).toBeNull();
  });
});

// ─── result phase ──────────────────────────────────────────────────────────

describe('InsomniaSurvey · result', () => {
  it('renders the orchestrator-scored result when present', () => {
    // Pre-seed a result as the orchestrator would.
    store.set('sleep', 'insomnia_survey_result', {
      score: 4, band: 'none', answered: 7, scored_at: 1_700_000_000_000,
    });
    mount();
    clickByText('begin');
    for (let q = 0; q < INSOMNIA_SURVEY_QUESTIONS.length; q++) clickOption(0);

    const text = (container.textContent ?? '').toLowerCase();
    expect(text).toContain('4');
    expect(text).toContain('of 28');
    // Non-judgmental band copy.
    expect(text).toContain('sleeping fairly easily');
  });
});

// ─── banned-phrase smoke ───────────────────────────────────────────────────

describe('InsomniaSurvey · banned-phrase audit (smoke)', () => {
  it('intro + question copy carries no cheerleading or exclamations', () => {
    mount();
    clickByText('begin');
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toContain('great');
    expect(text).not.toContain('awesome');
    expect(text).not.toContain('good job');
    // notif-scope-allow — asserting the banned word is absent from copy
    expect(text).not.toContain('streak');
    expect(text).not.toContain('!');
  });
});
