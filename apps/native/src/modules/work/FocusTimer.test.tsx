/**
 * FocusTimer · behavior tests
 *
 * Uses vi.useFakeTimers() for the countdown + setTimeout-based auto-reset.
 * No @testing-library — follows the createRoot + act pattern from
 * src/dump/NeedsConfirmCard.test.tsx.
 *
 * Layout + ui + theme deps are stubbed so no CSS modules or Tauri bindings
 * are exercised.
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── module mocks ──────────────────────────────────────────────────────────────
//
// IMPORTANT: vi.mock factories are hoisted before imports. The mock object is
// defined inside the factory so it's always available at hoist time. We expose
// it via the module's own mock shape so tests can reassert call counts.

vi.mock('./repo', () => {
  const addFocus = vi.fn().mockResolvedValue({ id: 'focus-id' });
  return {
    events: { addFocus },
    __mocks: { addFocus },
  };
});

vi.mock('../../layout', () => ({
  Stack: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-stack': true }, children),
  Row: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-row': true }, children),
}));

vi.mock('../../ui', () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('../../theme/tokens', () => ({
  colors: {
    ink: '#14140F',
    inkSoft: '#5A574E',
    inkFaint: '#9C9890',
    inkGhost: '#C8C4BA',
    sage: '#2E5D43',
    sageSoft: '#5A574E',
    hairline: 'rgba(20,20,15,0.10)',
    hairlineSoft: 'rgba(20,20,15,0.05)',
    paper: '#F4F1E8',
    cream: '#FAFAF7',
  },
  fonts: {
    serif: 'Georgia, serif',
    sans: 'sans-serif',
    mono: 'monospace',
  },
  fontSizes: {
    display: '64px',
    h2: '28px',
    body: '17px',
    small: '14px',
    caption: '13px',
  },
  fontWeights: { regular: 400, medium: 500, bold: 700 },
  letterSpacings: {
    display: '-0.025em',
    body: '0',
    caps: '0.10em',
  },
}));

import { FocusTimer } from './FocusTimer';
import * as repoMod from './repo';

// Cast so we can reach addFocus mock
const mockAddFocus = (repoMod.events.addFocus as ReturnType<typeof vi.fn>);

// ─── helpers ──────────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  mockAddFocus.mockClear();
  mockAddFocus.mockResolvedValue({ id: 'focus-id' });
  vi.spyOn(window, 'dispatchEvent');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderTimer(props: { onSessionLogged?: () => void } = {}): void {
  act(() => {
    root.render(React.createElement(FocusTimer, props));
  });
}

async function tickSeconds(n: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(n * 1000);
  });
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

function clickButton(ariaLabel: string): void {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === ariaLabel,
  ) as HTMLButtonElement | undefined;
  if (!btn) throw new Error(`button aria-label="${ariaLabel}" not found`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function clickButtonByText(text: string): void {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
  if (!btn) throw new Error(`button text="${text}" not found`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/**
 * Finds the time display span. Matches MM:SS or M:SS or any digit:digit
 * pattern (covers 180:00) as well as "complete".
 */
function getDisplay(): string {
  const spans = Array.from(container.querySelectorAll('span'));
  const timeSpan = spans.find(
    (s) => /^\d+:\d{2}$/.test(s.textContent?.trim() ?? '') ||
           s.textContent?.trim() === 'complete',
  );
  return timeSpan?.textContent?.trim() ?? '';
}

function setInputValue(ariaLabel: string, value: string): void {
  const input = container.querySelector(`[aria-label="${ariaLabel}"]`) as HTMLInputElement | null;
  if (!input) throw new Error(`input aria-label="${ariaLabel}" not found`);
  act(() => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function setProjectValue(value: string): void {
  // Project input is type="text" with placeholder "optional".
  // After selecting "custom", a type="number" input also appears — exclude it.
  const input = Array.from(container.querySelectorAll('input[type="text"]')).find(
    (i) => (i as HTMLInputElement).placeholder === 'optional',
  ) as HTMLInputElement | undefined;
  if (!input) throw new Error('project input not found');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// ─── preset selection ─────────────────────────────────────────────────────────

describe('preset selection', () => {
  it('defaults to 25:00 in idle', () => {
    renderTimer();
    expect(getDisplay()).toBe('25:00');
  });

  it('selecting 50 min chip shows 50:00', () => {
    renderTimer();
    // The 50-min chip has text "50 min". Click it directly.
    const chip50 = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '50 min',
    ) as HTMLButtonElement;
    act(() => {
      chip50.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(getDisplay()).toBe('50:00');
  });

  it('preset chips are disabled while running', async () => {
    renderTimer();
    clickButton('Start focus session');
    await tickSeconds(1);
    const chip50 = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '50 min',
    ) as HTMLButtonElement;
    expect(chip50.disabled).toBe(true);
  });

  it('selecting custom shows the custom number input', () => {
    renderTimer();
    clickButtonByText('custom');
    const customInput = container.querySelector('[aria-label="Custom duration in minutes"]');
    expect(customInput).not.toBeNull();
  });
});

// ─── custom duration bounds ───────────────────────────────────────────────────

describe('custom duration bounds (1–180 min)', () => {
  it('entering 45 shows 45:00', () => {
    renderTimer();
    clickButtonByText('custom');
    setInputValue('Custom duration in minutes', '45');
    expect(getDisplay()).toBe('45:00');
  });

  it('value 0 clamps to 01:00', () => {
    renderTimer();
    clickButtonByText('custom');
    setInputValue('Custom duration in minutes', '0');
    expect(getDisplay()).toBe('01:00');
  });

  it('value 999 clamps to 180:00', () => {
    renderTimer();
    clickButtonByText('custom');
    setInputValue('Custom duration in minutes', '999');
    expect(getDisplay()).toBe('180:00');
  });
});

// ─── state transitions ────────────────────────────────────────────────────────

describe('state transitions', () => {
  it('idle → running: display counts down after 1 second', async () => {
    renderTimer();
    clickButton('Start focus session');
    await tickSeconds(1);
    expect(getDisplay()).toBe('24:59');
  });

  it('running → paused: countdown stops', async () => {
    renderTimer();
    clickButton('Start focus session');
    await tickSeconds(2);
    clickButton('Pause focus session');
    const atPause = getDisplay();
    await tickSeconds(5);
    expect(getDisplay()).toBe(atPause);
  });

  it('paused → running: countdown resumes', async () => {
    renderTimer();
    clickButton('Start focus session');
    await tickSeconds(3);
    clickButton('Pause focus session');
    clickButton('Resume focus session');
    await tickSeconds(2);
    expect(getDisplay()).toBe('24:55');
  });

  it('running → stop → idle: resets to 25:00, no addFocus call', async () => {
    renderTimer();
    clickButton('Start focus session');
    await tickSeconds(5);
    clickButton('Stop and discard focus session');
    expect(getDisplay()).toBe('25:00');
    expect(mockAddFocus).not.toHaveBeenCalled();
  });

  it('paused → stop → idle: no addFocus call', async () => {
    renderTimer();
    clickButton('Start focus session');
    await tickSeconds(3);
    clickButton('Pause focus session');
    clickButton('Stop and discard focus session');
    expect(getDisplay()).toBe('25:00');
    expect(mockAddFocus).not.toHaveBeenCalled();
  });
});

// ─── on-finish ────────────────────────────────────────────────────────────────

describe('on finish', () => {
  it('completes a 1-min session: writes focus_session + fires ollie:notify', async () => {
    renderTimer();
    clickButtonByText('custom');
    setInputValue('Custom duration in minutes', '1');
    clickButton('Start focus session');

    await tickSeconds(60);
    // Flush async addFocus promise chain
    await act(async () => { await Promise.resolve(); });

    expect(mockAddFocus).toHaveBeenCalledOnce();
    expect(mockAddFocus).toHaveBeenCalledWith({ durationMin: 1, project: null });

    expect(window.dispatchEvent).toHaveBeenCalledOnce();
    const evt = vi.mocked(window.dispatchEvent).mock.calls[0]![0] as CustomEvent;
    expect(evt.type).toBe('ollie:notify');
    expect((evt.detail as { title: string }).title).toBe('focus complete');
    expect((evt.detail as { body: string }).body).toContain('1m');
  });

  it('includes project in focus_session write and notification body', async () => {
    renderTimer();
    clickButtonByText('custom');
    setInputValue('Custom duration in minutes', '1');
    setProjectValue('atelier');
    clickButton('Start focus session');
    await tickSeconds(60);
    await act(async () => { await Promise.resolve(); });

    expect(mockAddFocus).toHaveBeenCalledWith({ durationMin: 1, project: 'atelier' });
    const evt = vi.mocked(window.dispatchEvent).mock.calls[0]![0] as CustomEvent;
    expect((evt.detail as { body: string }).body).toContain('atelier');
  });

  it('calls onSessionLogged callback after write', async () => {
    const onLogged = vi.fn();
    renderTimer({ onSessionLogged: onLogged });
    clickButtonByText('custom');
    setInputValue('Custom duration in minutes', '1');
    clickButton('Start focus session');
    await tickSeconds(60);
    await act(async () => { await Promise.resolve(); });
    expect(onLogged).toHaveBeenCalledOnce();
  });

  it('shows "complete" text then auto-resets after 3s', async () => {
    renderTimer();
    clickButtonByText('custom');
    setInputValue('Custom duration in minutes', '1');
    clickButton('Start focus session');
    await tickSeconds(60);

    expect(getDisplay()).toBe('complete');

    await tick(3000);
    expect(getDisplay()).toBe('01:00');
  });
});

// ─── brown noise toggle ───────────────────────────────────────────────────────

describe('brown noise toggle', () => {
  it('noise toggle is NOT rendered when asset is unavailable', () => {
    renderTimer();
    const noiseBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('brown noise'),
    );
    expect(noiseBtn).toBeUndefined();
  });
});
