/**
 * Audit H1 — the raw Anthropic proxy (/v1/messages + /brain-dump) forwards the
 * client-controlled body verbatim, so an authenticated user could request the
 * most expensive model with a huge max_tokens. This suite pins the cost guard:
 * disallowed models are rejected before any upstream call, and max_tokens is
 * clamped down on allowed models.
 *
 * Strategy: T0_JWT_ENFORCED='0' + x-user-id (no JWKS mocking). Stub global
 * fetch so no real Anthropic call happens and we can inspect the forwarded body.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/index';

type WorkerEnv = Parameters<typeof worker.fetch>[1];

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true } as unknown as KVNamespaceListResult<unknown>;
    },
  } as unknown as KVNamespace;
}

function makeEnv(): WorkerEnv {
  return {
    ANTHROPIC_API_KEY: 'sk-ant-fake',
    CACHE_KV: makeKv(),
    RATE_KV: makeKv(),
    T0_JWT_ENFORCED: '0',
  } as unknown as WorkerEnv;
}

function makeReq(body: unknown): Request {
  return new Request('https://worker.dev/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'h1-user' },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.restoreAllMocks());

describe('audit H1 · proxy cost caps', () => {
  it('rejects an Opus request with 400 and never calls upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const resp = await worker.fetch(
      makeReq({ model: 'claude-opus-4-8', max_tokens: 1000, messages: [] }),
      makeEnv(),
    );
    expect(resp.status).toBe(400);
    expect(await resp.json()).toMatchObject({ error: 'model_not_allowed' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an unknown model', async () => {
    const resp = await worker.fetch(
      makeReq({ model: 'gpt-4o', max_tokens: 500, messages: [] }),
      makeEnv(),
    );
    expect(resp.status).toBe(400);
  });

  it('clamps max_tokens on an allowed model before forwarding', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const resp = await worker.fetch(
      makeReq({ model: 'claude-haiku-4-5-20251001', max_tokens: 64000, messages: [] }),
      makeEnv(),
    );
    expect(resp.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const forwarded = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(forwarded.max_tokens).toBe(2048);
    expect(forwarded.model).toBe('claude-haiku-4-5-20251001');
  });

  it('passes an in-budget allowed request through unchanged', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const resp = await worker.fetch(
      makeReq({ model: 'claude-haiku-4-5-20251001', max_tokens: 250, messages: [] }),
      makeEnv(),
    );
    expect(resp.status).toBe(200);
    const forwarded = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(forwarded.max_tokens).toBe(250);
  });
});
