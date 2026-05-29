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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

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

import { BrainDumpInput } from './BrainDumpInput';

const KEY = 'pending_dump';
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  memStore.clear();
  kvSet.mockClear();
  kvGet.mockClear();
  kvDelete.mockClear();
  routeDump.mockReset();
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
