/**
 * PhotoIntake · entry-path tests.
 *
 * Three entry paths must all route to the same `setFile` and stage an image:
 *   1. file picker (click → hidden input → onChange)
 *   2. drag-and-drop (onDrop with dataTransfer.files)
 *   3. paste (onPaste with clipboardData.items)
 *
 * Plus:
 *   4. plain-text paste does NOT trigger the photo pipeline.
 *   5. clear() empties the staged image.
 *
 * compressImage is mocked — we're testing the wiring, not the encoder.
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── mock compressImage so canvas/decoding isn't needed ─────────────────────
const compressImage = vi.fn();
vi.mock('./compressImage', () => ({
  compressImage: (...a: unknown[]) => compressImage(...a),
}));

// ── ensure jsdom has a no-op URL.createObjectURL/revokeObjectURL ──────────
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
beforeEach(() => {
  // jsdom ≥21 ships these; older may not. Stub defensively.
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

import { usePhotoIntake, PhotoIntakeBar, type PhotoIntakeState } from './PhotoIntake';

// ── tiny harness so we can drive the hook + render the bar ────────────────
function Harness({ onState }: { onState: (s: PhotoIntakeState) => void }): JSX.Element {
  const intake = usePhotoIntake();
  onState(intake);
  return React.createElement(PhotoIntakeBar, { intake });
}

let container: HTMLDivElement;
let root: Root;
let last: PhotoIntakeState | null;

beforeEach(() => {
  compressImage.mockReset();
  compressImage.mockResolvedValue({
    ok: true,
    image: { mime: 'image/jpeg', data: 'AAAA' },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  last = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = () => act(async () => { await Promise.resolve(); });

async function mount() {
  await act(async () => {
    root.render(React.createElement(Harness, { onState: (s) => { last = s; } }));
  });
  await flush();
}

describe('PhotoIntake entry paths', () => {
  it('picker: selecting a file calls compressImage and stages the image', async () => {
    await mount();
    const file = new File([new Uint8Array([1, 2, 3])], 'r.jpg', { type: 'image/jpeg' });
    const input = container.querySelector(
      '[data-testid="photo-intake-file"]',
    ) as HTMLInputElement;
    // jsdom does not let you set `files` directly; redefine the prop.
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(compressImage).toHaveBeenCalledTimes(1);
    expect(last?.image).toEqual({ mime: 'image/jpeg', data: 'AAAA' });
    expect(last?.error).toBeNull();
  });

  it('drag-and-drop: onDrop with dataTransfer.files stages the image', async () => {
    await mount();
    const file = new File([new Uint8Array([1, 2])], 'r.png', { type: 'image/png' });
    // Synthesize a React DragEvent. We call the hook's handler directly via
    // the captured state, which is closer to how Stack's wrapper element
    // dispatches the event in production.
    const fakeDT = {
      files: [file] as unknown as FileList,
      types: ['Files'],
      dropEffect: '',
    };
    const ev = {
      preventDefault: vi.fn(),
      dataTransfer: fakeDT,
    } as unknown as React.DragEvent<HTMLElement>;
    await act(async () => {
      last!.onDrop(ev);
    });
    await flush();
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(compressImage).toHaveBeenCalledTimes(1);
    expect(last?.image).not.toBeNull();
  });

  it('paste: image clipboard item stages the image', async () => {
    await mount();
    const file = new File([new Uint8Array([1])], 'x.webp', { type: 'image/webp' });
    const item = {
      kind: 'file',
      type: 'image/webp',
      getAsFile: () => file,
    };
    const ev = {
      preventDefault: vi.fn(),
      clipboardData: { items: [item] },
    } as unknown as React.ClipboardEvent<HTMLElement>;
    await act(async () => {
      last!.onPaste(ev);
    });
    await flush();
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(compressImage).toHaveBeenCalledTimes(1);
  });

  it('paste: plain-text clipboard does NOT trigger compression', async () => {
    await mount();
    const item = {
      kind: 'string',
      type: 'text/plain',
      getAsFile: () => null,
    };
    const ev = {
      preventDefault: vi.fn(),
      clipboardData: { items: [item] },
    } as unknown as React.ClipboardEvent<HTMLElement>;
    await act(async () => {
      last!.onPaste(ev);
    });
    await flush();
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(compressImage).not.toHaveBeenCalled();
    expect(last?.image).toBeNull();
  });

  it('clear() drops the staged image', async () => {
    await mount();
    const file = new File([new Uint8Array([1])], 'x.jpg', { type: 'image/jpeg' });
    await act(async () => { await last!.setFile(file); });
    await flush();
    expect(last?.image).not.toBeNull();

    await act(async () => { last!.clear(); });
    await flush();
    expect(last?.image).toBeNull();
    expect(last?.previewUrl).toBeNull();
    expect(last?.error).toBeNull();
  });

  it('surfaces a quiet error when compressImage reports unsupported_mime', async () => {
    compressImage.mockResolvedValueOnce({ ok: false, reason: 'unsupported_mime' });
    await mount();
    const file = new File([new Uint8Array([1])], 'x.gif', { type: 'image/gif' });
    await act(async () => { await last!.setFile(file); });
    await flush();
    expect(last?.image).toBeNull();
    expect(last?.error).toMatch(/isn't supported/i);
  });
});
