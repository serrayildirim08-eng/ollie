/**
 * GoalCreateModal · required-field gating + cap-refusal behavior tests
 *
 * The contract this file guards:
 *   1. Save is DISABLED until every required field (what / why / obstacle /
 *      premortem / ulysses contract) is non-empty. target date is optional —
 *      filling everything-but-date still enables Save.
 *   2. Whitespace-only text does NOT satisfy a required field.
 *   3. A successful save calls goals.create with the trimmed draft, then fires
 *      onCreated + onClose.
 *   4. A GoalCapError is caught and surfaced as a gentle inline refusal — NOT
 *      thrown, and the modal stays open.
 *
 * UI/layout/theme deps are stubbed with plain HTML so the test needs no CSS
 * module transforms or Tauri native bindings. The repo is mocked.
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── stub layout + ui primitives as plain, testable HTML ────────────────────
vi.mock('../../layout', () => ({
  Stack: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  Row: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../ui', () => ({
  // Inputs/Textareas surface a data-field via label so tests can target them.
  Input: ({
    label,
    value,
    onChange,
  }: {
    label?: string;
    value?: string;
    onChange?: (v: string) => void;
  }) =>
    React.createElement('input', {
      'data-field': label,
      value: value ?? '',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value),
    }),
  Textarea: ({
    label,
    value,
    onChange,
  }: {
    label?: string;
    value?: string;
    onChange?: (v: string) => void;
  }) =>
    React.createElement('textarea', {
      'data-field': label,
      value: value ?? '',
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
    }),
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) =>
    React.createElement(
      'button',
      { onClick, disabled, 'aria-label': ariaLabel },
      children,
    ),
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('../../theme/tokens', () => ({
  colors: {
    cream: '#FAFAF7',
    paper: '#F4F1E8',
    ink: '#14140F',
    inkSoft: '#5A574E',
    inkFaint: '#9C9890',
    sageDeep: '#2E5D43',
    hairline: 'rgba(20,20,15,0.10)',
  },
  fonts: { serif: 'serif', sans: 'sans' },
  fontWeights: { regular: 400 },
  zIndex: { modal: 200 },
}));

// ── mock the repo: create() + a GoalCapError class ──────────────────────────
// The factory is hoisted above all module code, so the class must be DEFINED
// inside it (no outer reference). We re-import GoalCapError below for use in
// the rejection test.
const create = vi.fn();
vi.mock('./repo', () => {
  class GoalCapError extends Error {
    code = 'goal_cap' as const;
    constructor() {
      super('goal cap');
      this.name = 'GoalCapError';
    }
  }
  return {
    goals: { create: (...a: unknown[]) => create(...a) },
    GoalCapError,
  };
});

import { GoalCreateModal } from './GoalCreateModal';
import { GoalCapError } from './repo';

const REQUIRED = ['what', 'why', 'the obstacle', 'premortem', 'ulysses contract'];

let container: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn>;
let onCreated: ReturnType<typeof vi.fn>;

beforeEach(() => {
  create.mockReset();
  onClose = vi.fn();
  onCreated = vi.fn();
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

const flush = () => act(async () => { await Promise.resolve(); });

function mount() {
  return act(async () => {
    root.render(
      React.createElement(GoalCreateModal, { onClose, onCreated }),
    );
  });
}

function field(label: string): HTMLInputElement | HTMLTextAreaElement {
  return container.querySelector(`[data-field="${label}"]`) as
    | HTMLInputElement
    | HTMLTextAreaElement;
}

function saveBtn(): HTMLButtonElement {
  return container.querySelector(
    '[aria-label="save this goal"]',
  ) as HTMLButtonElement;
}

function type(label: string, value: string) {
  const el = field(label);
  const proto =
    el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function fillAllRequired() {
  for (const label of REQUIRED) {
    await act(async () => {
      type(label, `text for ${label}`);
    });
  }
}

describe('GoalCreateModal — required-field gating', () => {
  it('disables Save when no fields are filled', async () => {
    await mount();
    await flush();
    expect(saveBtn().disabled).toBe(true);
  });

  it('keeps Save disabled until ALL required fields are non-empty', async () => {
    await mount();
    await flush();
    // fill all but the last required field — still disabled
    for (const label of REQUIRED.slice(0, -1)) {
      await act(async () => {
        type(label, 'x');
      });
    }
    expect(saveBtn().disabled).toBe(true);
    // fill the final required field — now enabled
    await act(async () => {
      type(REQUIRED[REQUIRED.length - 1]!, 'x');
    });
    expect(saveBtn().disabled).toBe(false);
  });

  it('enables Save with all required filled even when target date is empty', async () => {
    await mount();
    await flush();
    await fillAllRequired();
    // target date deliberately left blank
    expect(field('target date').value).toBe('');
    expect(saveBtn().disabled).toBe(false);
  });

  it('treats whitespace-only text as empty (Save stays disabled)', async () => {
    await mount();
    await flush();
    for (const label of REQUIRED) {
      await act(async () => {
        type(label, '   ');
      });
    }
    expect(saveBtn().disabled).toBe(true);
  });
});

describe('GoalCreateModal — save flow', () => {
  it('calls goals.create with the trimmed draft, then onCreated + onClose', async () => {
    create.mockResolvedValue({ id: 'g1' });
    await mount();
    await flush();
    await fillAllRequired();
    await act(async () => {
      saveBtn().click();
    });
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    const draft = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(draft.name).toBe('text for what');
    expect(draft.why).toBe('text for why');
    expect(draft.obstacle).toBe('text for the obstacle');
    expect(draft.premortem).toBe('text for premortem');
    expect(draft.ulyssesContract).toBe('text for ulysses contract');
    expect(draft.targetDate).toBeNull();
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('catches GoalCapError and shows a gentle inline refusal, staying open', async () => {
    create.mockRejectedValue(new GoalCapError());
    await mount();
    await flush();
    await fillAllRequired();
    await act(async () => {
      saveBtn().click();
    });
    await flush();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain('five active goals is the ceiling');
  });
});
