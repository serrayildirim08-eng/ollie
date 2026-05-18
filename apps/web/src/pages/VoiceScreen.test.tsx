/**
 * VoiceScreen · voice notes · behavioral tests
 *
 * Covers:
 *   1. empty state when no transcripts exist
 *   2. a stored draft transcript renders with its text
 *   3. "send to ollie" calls onApply with the transcript text and
 *      marks the entry applied
 *   4. an applied transcript shows the applied confirmation
 *   5. back button calls onNavigate('home')
 *   6. unsupported platform shows the honest unavailable note (hide-not-lie)
 */

import { act } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storeData = new Map<string, unknown>();

vi.mock('../store', () => ({
  store: {
    get: vi.fn((mod: string, key: string, fallback: unknown) => {
      const k = `${mod}:${key}`;
      return storeData.has(k) ? storeData.get(k) : fallback;
    }),
  },
  useStoreSlice: vi.fn(
    <T,>(mod: string, key: string, defaultValue: T): [T, (v: T) => void] => {
      const k = `${mod}:${key}`;
      const val = (storeData.has(k) ? storeData.get(k) : defaultValue) as T;
      const setter = (v: T) => storeData.set(k, v);
      return [val, setter];
    },
  ),
}));

// voice-capture support is toggled per-test via this mutable flag.
let supported = true;
vi.mock('../lib/voice-capture', () => ({
  voiceCaptureSupported: () => supported,
  startVoiceCapture: vi.fn(async () => ({ stop: () => {}, active: () => false })),
}));

import { VoiceScreen } from './VoiceScreen';

let container: HTMLDivElement;
let root: Root;

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  storeData.clear();
  supported = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

describe('VoiceScreen', () => {
  it('shows the empty state when there are no transcripts', () => {
    act(() => { root.render(<VoiceScreen onNavigate={() => {}} onApply={() => {}} />); });
    expect(container.textContent).toContain('nothing spoken yet');
  });

  it('renders a stored draft transcript', () => {
    storeData.set('voice:transcripts', [
      { id: 'vt1', text: 'buy oat milk', ts: Date.now(), status: 'draft' },
    ]);
    act(() => { root.render(<VoiceScreen onNavigate={() => {}} onApply={() => {}} />); });
    expect(container.textContent).toContain('buy oat milk');
  });

  it('"send to ollie" applies the transcript and marks it applied', () => {
    const onApply = vi.fn();
    storeData.set('voice:transcripts', [
      { id: 'vt1', text: 'call the dentist', ts: Date.now(), status: 'draft' },
    ]);
    act(() => { root.render(<VoiceScreen onNavigate={() => {}} onApply={onApply} />); });
    const applyBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'send to ollie',
    ) as HTMLButtonElement;
    expect(applyBtn).not.toBeUndefined();
    click(applyBtn);
    expect(onApply).toHaveBeenCalledWith('call the dentist');
    const stored = storeData.get('voice:transcripts') as Array<{ status: string }>;
    expect(stored[0].status).toBe('applied');
  });

  it('shows the applied confirmation for an applied transcript', () => {
    storeData.set('voice:transcripts', [
      { id: 'vt1', text: 'done thing', ts: Date.now(), status: 'applied', applied_at: Date.now() },
    ]);
    act(() => { root.render(<VoiceScreen onNavigate={() => {}} onApply={() => {}} />); });
    expect(container.textContent).toContain('sent · ollie sorted it');
  });

  it('back button calls onNavigate("home")', () => {
    const onNavigate = vi.fn();
    act(() => { root.render(<VoiceScreen onNavigate={onNavigate} onApply={() => {}} />); });
    const back = container.querySelector('button[aria-label="home"]') as HTMLButtonElement;
    click(back);
    expect(onNavigate).toHaveBeenCalledWith('home');
  });

  it('shows the honest unavailable note when voice is unsupported', () => {
    supported = false;
    act(() => { root.render(<VoiceScreen onNavigate={() => {}} onApply={() => {}} />); });
    expect(container.textContent).toContain("voice isn't available here");
  });
});
