import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryAdapter, createStore } from '@ollie/store';
import * as events from '@ollie/events';
import {
  CONSENT_STORE_KEY,
  CONSENT_STORE_MODULE,
  type ConsentState,
  type ConsentStoreAdapter,
  configureConsent,
  setConsent,
  _resetConsent,
} from '@ollie/consent';
import {
  RESEARCH_INTAKE_EVENT,
  createResearchOrchestrator,
  runResearchPipeline,
  type LabelClient,
  type ScrubbableWrite,
} from '../src/research';

function consentAdapter(): ConsentStoreAdapter {
  const m = new Map<string, unknown>();
  const key = (mod: string, k: string) => `${mod}.${k}`;
  return {
    get<T>(mod: string, k: string, defaultValue?: T): T {
      const v = m.get(key(mod, k));
      return (v === undefined ? (defaultValue as T) : (v as T));
    },
    set<T>(mod: string, k: string, value: T): void {
      m.set(key(mod, k), value);
    },
  };
}

const sampleWrite = (overrides: Partial<ScrubbableWrite> = {}): ScrubbableWrite => ({
  row_id: 'row-1',
  table: 'brain_dump_log',
  text: 'meeting with sarah johnson at the office, email me sarah@example.com',
  locale: 'en',
  sector_hint: 'tech',
  ts: Date.now(),
  ...overrides,
});

describe('@ollie/orchestrator · research (runResearchPipeline)', () => {
  beforeEach(() => {
    _resetConsent();
  });
  afterEach(() => {
    _resetConsent();
    vi.useRealTimers();
  });

  it('skips when user has opted out', async () => {
    const store = consentAdapter();
    configureConsent({ store });
    await setConsent('u1', { research_optin: false });

    const client: LabelClient = {
      postLabel: vi.fn(),
    };

    const result = await runResearchPipeline({
      userId: 'u1',
      write: sampleWrite(),
      labelClient: client,
    });

    expect(result).toEqual({ ok: false, skipped: 'opt_out' });
    expect(client.postLabel).not.toHaveBeenCalled();
  });

  it('opt-in: scrubs PII and posts to /label', async () => {
    const store = consentAdapter();
    configureConsent({ store });
    await setConsent('u1', { research_optin: true });

    const postLabel = vi
      .fn()
      .mockResolvedValue({ corpus_id: 'corpus-abc' });
    const client: LabelClient = { postLabel };

    const write = sampleWrite();
    const result = await runResearchPipeline({
      userId: 'u1',
      write,
      labelClient: client,
    });

    expect(result).toEqual({ ok: true, corpus_id: 'corpus-abc' });
    expect(postLabel).toHaveBeenCalledTimes(1);
    const arg = postLabel.mock.calls[0][0];
    // PII must have been scrubbed before leaving device
    expect(arg.scrubbed_text).not.toContain('sarah@example.com');
    expect(arg.scrubbed_text).toContain('[EMAIL]');
    expect(arg.scrubbed_text).not.toContain('sarah johnson');
    expect(arg.scrubbed_text).toContain('[NAME]');
    expect(arg.sector_hint).toBe('tech');
    expect(arg.locale).toBe('en');
  });

  it('opt-in: skips when scrub leaves only redaction tokens', async () => {
    const store = consentAdapter();
    configureConsent({ store });
    await setConsent('u1', { research_optin: true });

    const postLabel = vi.fn();
    const client: LabelClient = { postLabel };

    // Pure PII: every word gets scrubbed → empty after stripping tokens
    const result = await runResearchPipeline({
      userId: 'u1',
      write: sampleWrite({ text: 'mike johnson sarah smith' }),
      labelClient: client,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.skipped).toBe('empty_after_scrub');
    expect(postLabel).not.toHaveBeenCalled();
  });

  it('rejects invalid table', async () => {
    const store = consentAdapter();
    configureConsent({ store });
    await setConsent('u1', { research_optin: true });

    const result = await runResearchPipeline({
      userId: 'u1',
      // @ts-expect-error — invalid table on purpose
      write: { ...sampleWrite(), table: 'bogus' },
      labelClient: { postLabel: vi.fn() },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.skipped).toBe('invalid_table');
  });
});

describe('@ollie/orchestrator · research (createResearchOrchestrator batch)', () => {
  beforeEach(() => {
    _resetConsent();
    vi.useFakeTimers();
  });
  afterEach(() => {
    _resetConsent();
    vi.useRealTimers();
  });

  it('batches RESEARCH_INTAKE_EVENT emits and flushes on the interval', async () => {
    const store = consentAdapter();
    configureConsent({ store });
    await setConsent('u1', { research_optin: true });

    const postLabel = vi
      .fn()
      .mockResolvedValue({ corpus_id: 'cid' });
    const client: LabelClient = { postLabel };

    const _adapter = createMemoryAdapter();
    const fakeStore = createStore(_adapter);

    const onCorpusAppended = vi.fn();
    const orch = createResearchOrchestrator(fakeStore, {
      userId: 'u1',
      labelClient: client,
      batchIntervalMs: 60_000,
      onCorpusAppended,
    });
    orch.init();

    // emit three intakes
    events.emit(RESEARCH_INTAKE_EVENT, sampleWrite({ row_id: 'r1' }));
    events.emit(RESEARCH_INTAKE_EVENT, sampleWrite({ row_id: 'r2' }));
    events.emit(RESEARCH_INTAKE_EVENT, sampleWrite({ row_id: 'r3' }));

    // nothing should have fired yet — batch interval hasn't elapsed
    expect(postLabel).not.toHaveBeenCalled();

    // advance the timer
    await vi.advanceTimersByTimeAsync(60_000);
    // flush is async — drain microtasks
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(postLabel).toHaveBeenCalledTimes(3);
    expect(onCorpusAppended).toHaveBeenCalledTimes(3);

    orch.teardown();
  });

  it('opt-out path: never calls labelClient even when intake events fire', async () => {
    const store = consentAdapter();
    configureConsent({ store });
    await setConsent('u1', { research_optin: false });

    const postLabel = vi.fn();
    const client: LabelClient = { postLabel };

    const fakeStore = createStore(createMemoryAdapter());
    const orch = createResearchOrchestrator(fakeStore, {
      userId: 'u1',
      labelClient: client,
      batchIntervalMs: 60_000,
    });
    orch.init();

    events.emit(RESEARCH_INTAKE_EVENT, sampleWrite({ row_id: 'r1' }));
    events.emit(RESEARCH_INTAKE_EVENT, sampleWrite({ row_id: 'r2' }));

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(postLabel).not.toHaveBeenCalled();
    orch.teardown();
  });

  it('idempotent: same row_id emitted twice still posts once', async () => {
    const store = consentAdapter();
    configureConsent({ store });
    await setConsent('u1', { research_optin: true });

    const postLabel = vi
      .fn()
      .mockResolvedValue({ corpus_id: 'cid' });
    const client: LabelClient = { postLabel };

    const fakeStore = createStore(createMemoryAdapter());
    const orch = createResearchOrchestrator(fakeStore, {
      userId: 'u1',
      labelClient: client,
      batchIntervalMs: 60_000,
    });
    orch.init();

    events.emit(RESEARCH_INTAKE_EVENT, sampleWrite({ row_id: 'dup' }));

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    // re-emit after flush — should be ignored by `shipped` dedupe
    events.emit(RESEARCH_INTAKE_EVENT, sampleWrite({ row_id: 'dup' }));
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(postLabel).toHaveBeenCalledTimes(1);
    orch.teardown();
  });

  it('silent fail to sentry-tunnel hook on labelClient error', async () => {
    const store = consentAdapter();
    configureConsent({ store });
    await setConsent('u1', { research_optin: true });

    const postLabel = vi.fn().mockRejectedValue(new Error('boom'));
    const client: LabelClient = { postLabel };

    const onError = vi.fn();
    const fakeStore = createStore(createMemoryAdapter());
    const orch = createResearchOrchestrator(fakeStore, {
      userId: 'u1',
      labelClient: client,
      batchIntervalMs: 60_000,
      onError,
    });
    orch.init();

    events.emit(RESEARCH_INTAKE_EVENT, sampleWrite({ row_id: 'r1' }));
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toEqual({ table: 'brain_dump_log', row_id: 'r1' });
    orch.teardown();
  });
});
