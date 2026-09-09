/**
 * BrainDumpInput · draft-persistence behavior tests
 *
 * The core ADHD-safety guarantee: a brain dump is never lost.
 *   1. Restore — a draft saved on disk is loaded into the textarea on mount.
 *   2. Failed submit KEEPS the draft on disk (kv.delete is NOT called) so a
 *      crash / app close / offline retry preserves the user's words.
 *   3. Successful submit CLEARS the draft (kv.delete called).
 *
 * UI/layout/CSS deps are stubbed with plain HTML; kv + routeDump are mocked.
 */

import React, { act } from 'react';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

// jsdom may not ship URL.createObjectURL; PhotoIntake reaches for it.
// Stash refs at module load and restore in afterAll-equivalent (the file
// runs in its own worker via vitest forks pool, so module-level reassign
// is acceptable here).
URL.createObjectURL = vi.fn(() => 'blob:mock');
URL.revokeObjectURL = vi.fn();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── stub layout + ui primitives as plain HTML ──────────────────────────────
vi.mock('../layout', () => ({
  Stack: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
  Row: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../ui', () => ({
  Textarea: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) =>
    React.createElement('textarea', {
      'data-testid': 'ta',
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    }),
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) =>
    React.createElement('button', { 'data-testid': 'send', onClick, disabled }, children),
  Text: ({ children }: { children: React.ReactNode }) =>
    React.createElement('span', null, children),
}));

vi.mock('./BrainDumpInput.module.css', () => ({ default: {} }));

// ── stub the first-dump whisper (has its own tests; needs Router context) ──
vi.mock('./FirstDumpWhisper', () => ({
  FirstDumpWhisper: () => null,
  shouldShowFirstDumpWhisper: async () => false,
  markFirstDumpWhisperShown: async () => {},
  WHISPER_GENERIC_MODULES: new Set(['dump_only', 'journal', 'crisis', '']),
}));

// ── mock kv with an in-memory store + spies ────────────────────────────────
const memStore = new Map<string, unknown>();
const kvSet = vi.fn(async (k: string, v: unknown) => void memStore.set(k, v));
const kvGet = vi.fn(async (k: string) => (memStore.has(k) ? memStore.get(k) : null));
const kvDelete = vi.fn(async (k: string) => void memStore.delete(k));
vi.mock('../storage', () => ({
  kv: {
    set: (k: string, v: unknown) => kvSet(k, v),
    get: (k: string) => kvGet(k),
    delete: (k: string) => kvDelete(k),
  },
}));

// ── mock routeDump (controllable per test) ─────────────────────────────────
const routeDump = vi.fn();
vi.mock('../api', () => ({ routeDump: (...a: unknown[]) => routeDump(...a) }));

// ── mock compressImage so PhotoIntake can stage images without a canvas ──
const compressImage = vi.fn();
vi.mock('./compressImage', () => ({
  compressImage: (...a: unknown[]) => compressImage(...a),
  MAX_DIM: 1280,
  MAX_B64_BYTES: 900 * 1024,
}));

import { BrainDumpInput } from './BrainDumpInput';
import { detectCrisis } from '@ollie/logic/crisis';

const KEY = 'pending_dump';
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  memStore.clear();
  kvSet.mockClear();
  kvGet.mockClear();
  kvDelete.mockClear();
  routeDump.mockReset();
  compressImage.mockReset();
  compressImage.mockResolvedValue({
    ok: true,
    image: { mime: 'image/jpeg', data: 'AAAA' },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = () => act(async () => { await Promise.resolve(); });

it('restores a saved draft into the textarea on mount', async () => {
  memStore.set(KEY, { text: 'buy oat milk', ts: 1 });
  await act(async () => {
    root.render(React.createElement(BrainDumpInput, { getBearer: () => 'tok' }));
  });
  await flush();
  const ta = container.querySelector('[data-testid="ta"]') as HTMLTextAreaElement;
  expect(ta.value).toBe('buy oat milk');
});

it('KEEPS the draft on a failed submit', async () => {
  routeDump.mockResolvedValue({ ok: false, error: { code: 'network' } });
  await act(async () => {
    root.render(
      React.createElement(BrainDumpInput, { getBearer: () => 'tok', initialValue: 'something' }),
    );
  });
  await flush();
  const btn = container.querySelector('[data-testid="send"]') as HTMLButtonElement;
  await act(async () => { btn.click(); });
  await flush();
  // Persisted before the network call; NOT cleared because the route failed.
  expect(kvSet).toHaveBeenCalledWith(KEY, expect.objectContaining({ text: 'something' }));
  expect(kvDelete).not.toHaveBeenCalled();
});

it('reuses the SAME dumpId across retries, then mints a fresh one after success', async () => {
  // First two submits fail (timeout/network) → both must carry the same dumpId
  // so a server that already routed the first attempt can dedupe the retry.
  routeDump.mockResolvedValue({ ok: false, error: { code: 'timeout', message: 't' } });
  await act(async () => {
    root.render(
      React.createElement(BrainDumpInput, { getBearer: () => 'tok', initialValue: 'buy milk' }),
    );
  });
  await flush();
  const btn = container.querySelector('[data-testid="send"]') as HTMLButtonElement;

  await act(async () => { btn.click(); });
  await flush();
  await act(async () => { btn.click(); });
  await flush();

  const id1 = (routeDump.mock.calls[0]![0] as Record<string, unknown>).dumpId;
  const id2 = (routeDump.mock.calls[1]![0] as Record<string, unknown>).dumpId;
  expect(typeof id1).toBe('string');
  expect(id1).toBe(id2); // retry reuses the id → server-side idempotency works

  // Now the retry finally succeeds. The NEXT (different) dump must mint a new id.
  routeDump.mockResolvedValue({ ok: true, data: { fragments: [] } });
  await act(async () => { btn.click(); });
  await flush();
  const id3 = (routeDump.mock.calls[2]![0] as Record<string, unknown>).dumpId;
  expect(id3).toBe(id1); // still the same attempt (succeeded this time)

  const ta = container.querySelector('[data-testid="ta"]') as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    setter.call(ta, 'second thought');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
  await act(async () => { btn.click(); });
  await flush();
  const id4 = (routeDump.mock.calls[3]![0] as Record<string, unknown>).dumpId;
  expect(typeof id4).toBe('string');
  expect(id4).not.toBe(id1); // a new thought → a fresh idempotency key
});

it('CLEARS the draft on a successful submit', async () => {
  routeDump.mockResolvedValue({ ok: true, data: { fragments: [] } });
  memStore.set(KEY, { text: 'walked the dog', ts: 1 });
  await act(async () => {
    root.render(React.createElement(BrainDumpInput, { getBearer: () => 'tok' }));
  });
  await flush();
  const btn = container.querySelector('[data-testid="send"]') as HTMLButtonElement;
  await act(async () => { btn.click(); });
  await flush();
  expect(kvDelete).toHaveBeenCalledWith(KEY);
});

// ── photo-intake additions ───────────────────────────────────────────────

it('submits an image-only dump (no typed text)', async () => {
  routeDump.mockResolvedValue({
    ok: true,
    data: { fragments: [], visionUsed: true },
  });
  await act(async () => {
    root.render(React.createElement(BrainDumpInput, { getBearer: () => 'tok' }));
  });
  await flush();
  // stage a photo via the hidden picker input
  const file = new File([new Uint8Array([1])], 'r.jpg', { type: 'image/jpeg' });
  const input = container.querySelector(
    '[data-testid="photo-intake-file"]',
  ) as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
  const btn = container.querySelector('[data-testid="send"]') as HTMLButtonElement;
  expect(btn.disabled).toBe(false);
  await act(async () => { btn.click(); });
  await flush();
  expect(routeDump).toHaveBeenCalledTimes(1);
  const body = routeDump.mock.calls[0]![0] as Record<string, unknown>;
  expect(body.image).toEqual({ mime: 'image/jpeg', data: 'AAAA' });
  expect(body.text).toBeUndefined();
});

it('#33: a second submit while one is in flight does NOT double-dispatch', async () => {
  // Hold the route open so the first submit stays "in flight" while we fire a
  // second one (simulating a double Cmd+Enter / button + voice race that
  // bypasses the disabled button).
  let resolveRoute!: (v: unknown) => void;
  routeDump.mockReturnValue(new Promise((res) => { resolveRoute = res; }));
  await act(async () => {
    root.render(
      React.createElement(BrainDumpInput, { getBearer: () => 'tok', initialValue: 'buy milk' }),
    );
  });
  await flush();
  const btn = container.querySelector('[data-testid="send"]') as HTMLButtonElement;

  // Fire twice back-to-back, both before the in-flight route resolves.
  await act(async () => {
    btn.click();
    btn.click();
  });
  await flush();

  // Only ONE route call should have been dispatched — the guard blocked the
  // re-entry.
  expect(routeDump).toHaveBeenCalledTimes(1);

  // Release the route + let a NEW submit through to prove the guard cleared.
  routeDump.mockResolvedValue({ ok: true, data: { fragments: [] } });
  await act(async () => { resolveRoute({ ok: true, data: { fragments: [] } }); });
  await flush();
});

it('#88: a local-crisis FALSE-POSITIVE that the server clears still fires the ack', async () => {
  // This hyperbolic phrasing trips the offline ideation matcher ("want to die")
  // but the authoritative server verdict (with full context) is NOT a crisis.
  // The optimistic ack was withheld on submit; it must be recovered on result
  // so the dump doesn't read as silently dropped.
  const phrase = 'this traffic is so bad i want to die lol';
  // Guard the test's own premise: the local matcher must actually trip here,
  // otherwise the ack would fire normally on submit and the test proves nothing.
  expect(detectCrisis(phrase).match).toBe(true);
  routeDump.mockResolvedValue({ ok: true, data: { fragments: [], crisis: null } });
  const onSubmitted = vi.fn();
  const onCrisis = vi.fn();
  await act(async () => {
    root.render(
      React.createElement(BrainDumpInput, {
        getBearer: () => 'tok',
        initialValue: phrase,
        onSubmitted,
        onCrisis,
      }),
    );
  });
  await flush();
  const btn = container.querySelector('[data-testid="send"]') as HTMLButtonElement;
  await act(async () => { btn.click(); });
  await flush();

  // The ack fires exactly once — recovered post-route (it was suppressed on
  // submit because the local matcher tripped). Server said no crisis, so the
  // crisis callback never fires.
  expect(onSubmitted).toHaveBeenCalledTimes(1);
  expect(onCrisis).not.toHaveBeenCalled();
});

it('submit no-ops when there is neither text nor image', async () => {
  await act(async () => {
    root.render(React.createElement(BrainDumpInput, { getBearer: () => 'tok' }));
  });
  await flush();
  const btn = container.querySelector('[data-testid="send"]') as HTMLButtonElement;
  // disabled when empty — clicking is a no-op
  expect(btn.disabled).toBe(true);
  await act(async () => { btn.click(); });
  await flush();
  expect(routeDump).not.toHaveBeenCalled();
});
