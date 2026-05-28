/**
 * @ollie/orchestrator · cadence-scanner tests
 *
 * Covers:
 *   - no-op when no overdue entries
 *   - fires exactly once per (module, key, day)
 *   - dedupes across two scans inside the same session (in-process Set)
 *   - dedupes across a "reload" using the persisted store map
 *   - re-fires on the next calendar day (key embeds YYYY-MM-DD)
 *   - copy variant is module-correct + deterministic
 *   - idempotent registerSource (re-registering overwrites)
 *   - errors in one source don't kill the scan
 *   - notify() never called when isOverdue returns false / null
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStore, createMemoryAdapter } from '@ollie/store';
import {
  _resetForTests as resetNotifications,
  installBackend,
  installStore as installNotificationStore,
} from '@ollie/notifications';
import type {
  NotificationBackend,
  NotificationSpec,
} from '@ollie/notifications';
import { computeCadence, type CadenceEstimate } from '@ollie/cadence';
import {
  buildDedupeKey,
  createCadenceScanner,
  DEFAULT_CADENCE_COPY,
  localDayKey,
  pickCopyVariant,
  type CadenceTrackedEntry,
} from '../src/cadence-scanner';

const DAY_MS = 86_400_000;

// 2026-05-09T12:00:00Z — a Saturday noon (UTC). Tests pass this through
// `now()` directly so they don't depend on local timezone.
const NOW = new Date('2026-05-09T12:00:00Z').getTime();
const NEXT_DAY = NOW + DAY_MS;

interface CapturedSpec extends NotificationSpec {}

function makeBackend(): { backend: NotificationBackend; calls: CapturedSpec[] } {
  const calls: CapturedSpec[] = [];
  const backend: NotificationBackend = {
    name: 'noop',
    deliver(spec) {
      calls.push(spec);
      return undefined;
    },
    schedule(spec) {
      calls.push(spec);
      return undefined;
    },
    cancel() {
      /* no-op */
    },
  };
  return { backend, calls };
}

/**
 * Build a cadence estimate that is OVERDUE relative to `now` by `overshoot`
 * past one full median interval. medianIntervalMs = `intervalMs`.
 * Two events spaced `intervalMs` apart give the simplest valid estimate.
 */
function makeOverdueEstimate(intervalMs: number, now: number, overshoot: number): CadenceEstimate {
  const lastTs = now - intervalMs - overshoot;
  return computeCadence([
    { ts: lastTs - intervalMs, label: 'x' },
    { ts: lastTs, label: 'x' },
  ]);
}

/** A cadence estimate that is NOT overdue — last event was just now. */
function makeFreshEstimate(intervalMs: number, now: number): CadenceEstimate {
  return computeCadence([
    { ts: now - intervalMs, label: 'x' },
    { ts: now, label: 'x' },
  ]);
}

describe('@ollie/orchestrator · CadenceScanner', () => {
  beforeEach(() => {
    resetNotifications();
  });
  afterEach(() => {
    resetNotifications();
    vi.restoreAllMocks();
  });

  it('no fires when no entries are overdue', async () => {
    const { backend, calls } = makeBackend();
    installBackend(backend);
    const store = createStore(createMemoryAdapter());
    installNotificationStore(store);

    const scanner = createCadenceScanner(store, { now: () => NOW });
    scanner.registerSource('grocery', () => [
      {
        module: 'grocery',
        key: 'coffee',
        label: 'coffee',
        estimate: makeFreshEstimate(7 * DAY_MS, NOW),
      },
    ]);

    const result = await scanner.scanNow();
    expect(result.fired).toEqual([]);
    expect(result.enumeratedByModule['grocery']).toBe(1);
    // Tick microtasks so notify()'s async pipeline settles.
    await Promise.resolve();
    expect(calls).toHaveLength(0);
  });

  it('fires exactly one notification per overdue entry', async () => {
    const { backend, calls } = makeBackend();
    installBackend(backend);
    const store = createStore(createMemoryAdapter());
    installNotificationStore(store);

    const scanner = createCadenceScanner(store, { now: () => NOW });
    scanner.registerSource('grocery', () => [
      {
        module: 'grocery',
        key: 'coffee',
        label: 'coffee',
        estimate: makeOverdueEstimate(7 * DAY_MS, NOW, 2 * DAY_MS),
      },
    ]);

    const result = await scanner.scanNow();
    expect(result.fired).toHaveLength(1);
    expect(result.fired[0]?.module).toBe('grocery');
    expect(result.fired[0]?.key).toBe('coffee');
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.title).toMatch(/coffee/);
    expect(calls[0]?.dedupe_key).toBe(buildDedupeKey('grocery', 'coffee', NOW));
  });

  it('dedupes across two scans on the same day (in-process Set + store map)', async () => {
    const { backend, calls } = makeBackend();
    installBackend(backend);
    const store = createStore(createMemoryAdapter());
    installNotificationStore(store);

    const scanner = createCadenceScanner(store, { now: () => NOW });
    scanner.registerSource('grocery', () => [
      {
        module: 'grocery',
        key: 'coffee',
        label: 'coffee',
        estimate: makeOverdueEstimate(7 * DAY_MS, NOW, 2 * DAY_MS),
      },
    ]);

    const first = await scanner.scanNow();
    const second = await scanner.scanNow();
    expect(first.fired).toHaveLength(1);
    expect(second.fired).toHaveLength(0);
    expect(second.skippedDedupe).toContain(buildDedupeKey('grocery', 'coffee', NOW));
    await Promise.resolve();
    expect(calls).toHaveLength(1);
  });

  it('dedupes across a simulated reload via the persisted store map', async () => {
    const { backend, calls } = makeBackend();
    installBackend(backend);
    const store = createStore(createMemoryAdapter());
    installNotificationStore(store);

    const sourceFn = () => [
      {
        module: 'grocery',
        key: 'coffee',
        label: 'coffee',
        estimate: makeOverdueEstimate(7 * DAY_MS, NOW, 2 * DAY_MS),
      },
    ];

    // First scanner instance — fires.
    const a = createCadenceScanner(store, { now: () => NOW });
    a.registerSource('grocery', sourceFn);
    const r1 = await a.scanNow();
    expect(r1.fired).toHaveLength(1);

    // Fresh scanner reading the same store — in-process Set is empty,
    // but persisted map should still suppress.
    const b = createCadenceScanner(store, { now: () => NOW });
    b.registerSource('grocery', sourceFn);
    const r2 = await b.scanNow();
    expect(r2.fired).toHaveLength(0);
    expect(r2.skippedDedupe).toContain(buildDedupeKey('grocery', 'coffee', NOW));
    await Promise.resolve();
    expect(calls).toHaveLength(1);
  });

  it('fires once again the next calendar day (dedupe key rotates)', async () => {
    const { backend, calls } = makeBackend();
    installBackend(backend);
    const store = createStore(createMemoryAdapter());
    installNotificationStore(store);

    let clock = NOW;
    const scanner = createCadenceScanner(store, { now: () => clock });
    scanner.registerSource('grocery', () => [
      {
        module: 'grocery',
        key: 'coffee',
        label: 'coffee',
        estimate: makeOverdueEstimate(7 * DAY_MS, clock, 2 * DAY_MS),
      },
    ]);

    const day1 = await scanner.scanNow();
    expect(day1.fired).toHaveLength(1);
    expect(day1.fired[0]?.dedupeKey).toContain(localDayKey(NOW));

    // Advance one day — key suffix changes so dedupe doesn't suppress.
    clock = NEXT_DAY;
    const day2 = await scanner.scanNow();
    expect(day2.fired).toHaveLength(1);
    expect(day2.fired[0]?.dedupeKey).toContain(localDayKey(NEXT_DAY));
    expect(day1.fired[0]?.dedupeKey).not.toBe(day2.fired[0]?.dedupeKey);
    await Promise.resolve();
    expect(calls).toHaveLength(2);
  });

  it('picks the right copy template per module', async () => {
    const { backend, calls } = makeBackend();
    installBackend(backend);
    const store = createStore(createMemoryAdapter());
    installNotificationStore(store);

    const scanner = createCadenceScanner(store, { now: () => NOW });
    const overdue: CadenceTrackedEntry[] = [
      {
        module: 'grocery',
        key: 'coffee',
        label: 'coffee',
        estimate: makeOverdueEstimate(7 * DAY_MS, NOW, 2 * DAY_MS),
      },
      {
        module: 'body',
        key: 'yoga',
        label: 'yoga',
        estimate: makeOverdueEstimate(3 * DAY_MS, NOW, 2 * DAY_MS),
      },
      {
        module: 'habits',
        key: 'h-1',
        label: 'meditation',
        estimate: makeOverdueEstimate(2 * DAY_MS, NOW, 2 * DAY_MS),
      },
    ];
    for (const e of overdue) {
      scanner.registerSource(e.module, () => [e]);
    }
    const result = await scanner.scanNow();
    expect(result.fired.map((f) => f.module).sort()).toEqual(['body', 'grocery', 'habits']);

    const titleByModule = new Map(result.fired.map((f) => [f.module, f.title]));
    expect(titleByModule.get('grocery')).toMatch(/coffee/);
    expect(titleByModule.get('body')).toMatch(/yoga/);
    expect(titleByModule.get('habits')).toMatch(/meditation/);
    // Spot-check the registered copy templates actually contain those words.
    expect(DEFAULT_CADENCE_COPY['grocery']?.variants).toBeDefined();
    expect(DEFAULT_CADENCE_COPY['body']?.variants).toBeDefined();
    expect(DEFAULT_CADENCE_COPY['habits']?.variants).toBeDefined();
  });

  it('copy variant pick is deterministic per (module, key)', () => {
    const templates = DEFAULT_CADENCE_COPY['grocery']!;
    const a = pickCopyVariant(templates, 'grocery', 'coffee', 'coffee');
    const b = pickCopyVariant(templates, 'grocery', 'coffee', 'coffee');
    expect(a.title).toBe(b.title);
  });

  it('idempotent registerSource — re-registering overwrites', async () => {
    const { backend } = makeBackend();
    installBackend(backend);
    const store = createStore(createMemoryAdapter());
    installNotificationStore(store);

    const scanner = createCadenceScanner(store, { now: () => NOW });

    let calls = 0;
    scanner.registerSource('grocery', () => {
      calls += 1;
      return [];
    });
    scanner.registerSource('grocery', () => {
      // overwrites the first one — first should NOT run after this.
      return [
        {
          module: 'grocery',
          key: 'tea',
          label: 'tea',
          estimate: makeOverdueEstimate(7 * DAY_MS, NOW, 2 * DAY_MS),
        },
      ];
    });
    const result = await scanner.scanNow();
    expect(calls).toBe(0); // first source was replaced
    expect(result.fired).toHaveLength(1);
    expect(result.fired[0]?.key).toBe('tea');
  });

  it('one source throwing does not kill the rest of the scan', async () => {
    const { backend } = makeBackend();
    installBackend(backend);
    const store = createStore(createMemoryAdapter());
    installNotificationStore(store);

    const scanner = createCadenceScanner(store, { now: () => NOW });
    scanner.registerSource('grocery', () => {
      throw new Error('boom');
    });
    scanner.registerSource('habits', () => [
      {
        module: 'habits',
        key: 'h-1',
        label: 'meditation',
        estimate: makeOverdueEstimate(2 * DAY_MS, NOW, 2 * DAY_MS),
      },
    ]);

    const result = await scanner.scanNow();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.module).toBe('grocery');
    expect(result.fired).toHaveLength(1);
    expect(result.fired[0]?.module).toBe('habits');
  });

  it('skips entries whose isOverdue returns null (no cadence yet)', async () => {
    const { backend, calls } = makeBackend();
    installBackend(backend);
    const store = createStore(createMemoryAdapter());
    installNotificationStore(store);

    const scanner = createCadenceScanner(store, { now: () => NOW });
    // Single-event series — low-data, no nextExpectedTs, isOverdue → null.
    const lowData = computeCadence([{ ts: NOW - DAY_MS, label: 'x' }]);
    scanner.registerSource('grocery', () => [
      { module: 'grocery', key: 'coffee', label: 'coffee', estimate: lowData },
    ]);

    const result = await scanner.scanNow();
    expect(result.fired).toEqual([]);
    await Promise.resolve();
    expect(calls).toHaveLength(0);
  });

  it('drops entries from a module with no registered copy template', async () => {
    const { backend, calls } = makeBackend();
    installBackend(backend);
    const store = createStore(createMemoryAdapter());
    installNotificationStore(store);

    const scanner = createCadenceScanner(store, { now: () => NOW });
    scanner.registerSource('moonbase', () => [
      {
        module: 'moonbase',
        key: 'oxygen',
        label: 'oxygen',
        estimate: makeOverdueEstimate(DAY_MS, NOW, 2 * DAY_MS),
      },
    ]);

    const result = await scanner.scanNow();
    expect(result.fired).toEqual([]);
    await Promise.resolve();
    expect(calls).toHaveLength(0);
  });

  describe('copy templates for the 8 native modules', () => {
    const cases: Array<{
      module: string;
      key: string;
      label: string;
      intervalMs: number;
      /** Substring or regex that the fired title must contain. */
      mustMatch: RegExp;
    }> = [
      { module: 'sleep', key: 'nightly', label: 'nightly', intervalMs: DAY_MS, mustMatch: /(sleep|short|nightly)/i },
      { module: 'pets', key: 'pet-1', label: 'Mochi', intervalMs: DAY_MS, mustMatch: /Mochi/ },
      { module: 'finance', key: 'rent', label: 'rent', intervalMs: 30 * DAY_MS, mustMatch: /rent/ },
      { module: 'work', key: 'matter-1', label: 'OPT case', intervalMs: 3 * DAY_MS, mustMatch: /(OPT case|focus|deep work)/ },
      { module: 'goals', key: 'goal-1', label: 'novel draft', intervalMs: 7 * DAY_MS, mustMatch: /novel draft/ },
      { module: 'admin', key: 'passport', label: 'passport', intervalMs: 365 * DAY_MS, mustMatch: /passport/ },
      { module: 'cycle', key: 'period', label: 'period', intervalMs: 28 * DAY_MS, mustMatch: /period/ },
      { module: 'medication', key: 'med-1', label: 'vitamin D', intervalMs: DAY_MS, mustMatch: /vitamin D/ },
    ];

    for (const c of cases) {
      it(`${c.module}: fires non-shaming copy for overdue ${c.label}`, async () => {
        const { backend, calls } = makeBackend();
        installBackend(backend);
        const store = createStore(createMemoryAdapter());
        installNotificationStore(store);

        const scanner = createCadenceScanner(store, { now: () => NOW });
        scanner.registerSource(c.module, () => [
          {
            module: c.module,
            key: c.key,
            label: c.label,
            estimate: makeOverdueEstimate(c.intervalMs, NOW, 2 * DAY_MS),
          },
        ]);

        const result = await scanner.scanNow();
        expect(result.fired).toHaveLength(1);
        expect(result.fired[0]?.module).toBe(c.module);
        expect(result.fired[0]?.title).toMatch(c.mustMatch);

        // Tone guard: none of the new copy may contain banned shame /
        // streak / alarm patterns.
        const title = result.fired[0]?.title ?? '';
        expect(title).not.toMatch(/streak/i);
        expect(title).not.toMatch(/!/);
        expect(title).not.toMatch(/missed/i);
        expect(title).not.toMatch(/failed/i);
        expect(title).not.toMatch(/broken/i);

        await Promise.resolve();
        await Promise.resolve();
        expect(calls).toHaveLength(1);
        expect(DEFAULT_CADENCE_COPY[c.module]?.variants).toHaveLength(3);
      });
    }
  });

  it('init() runs a debounced boot scan + recurring foreground interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const { backend, calls } = makeBackend();
    installBackend(backend);
    const store = createStore(createMemoryAdapter());
    installNotificationStore(store);

    let foreground = true;
    const scanner = createCadenceScanner(store, {
      now: () => NOW,
      isForeground: () => foreground,
      bootDelayMs: 100,
      intervalMs: 1000,
    });
    scanner.registerSource('grocery', () => [
      {
        module: 'grocery',
        key: 'coffee',
        label: 'coffee',
        estimate: makeOverdueEstimate(7 * DAY_MS, NOW, 2 * DAY_MS),
      },
    ]);

    scanner.init();
    // Before debounce window — no scan yet.
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toHaveLength(0);

    // Cross the boot debounce.
    await vi.advanceTimersByTimeAsync(60);
    // Boot scan fired exactly once.
    expect(calls).toHaveLength(1);

    // Interval tick — dedupe should suppress same-day re-fire.
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);

    // Background tab — interval is skipped entirely.
    foreground = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toHaveLength(1);

    scanner.teardown();
    vi.useRealTimers();
  });
});
