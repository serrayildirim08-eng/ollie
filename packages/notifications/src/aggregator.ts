/**
 * @ollie/notifications · aggregator
 *
 * NL4. When multiple notifications land inside the same aggregation
 * window (default 30 min), coalesce them into a single digest push.
 *
 * Algorithm:
 *   - Each non-immediate `notify()` call enters a per-aggregation_group
 *     buffer with a flush timer set to `aggregation_window_ms` from the
 *     FIRST item in the group.
 *   - When the timer fires, the buffer is drained and one digest spec
 *     is produced (title = "today:", body = newline-joined entries) and
 *     handed to the backend.
 *   - Immediate notifications (schedule_at omitted AND no
 *     aggregation_group) bypass the buffer.
 *
 * Pure where possible — `now` and timer scheduling are injected for tests.
 */

import type { NotificationSpec } from './types';

export interface BufferedNotification {
  spec: NotificationSpec;
  enqueuedAt: number;
}

export interface AggregatorDeps {
  /** ms wall clock. */
  now: () => number;
  /** schedule a flush at the given local ts. */
  scheduleFlush: (group: string, fireAt: number, flush: () => void) => void;
  /** cancel a pending flush. */
  cancelFlush: (group: string) => void;
  /** deliver the produced digest immediately. */
  deliver: (spec: NotificationSpec) => void | Promise<void>;
}

export function createAggregator(
  windowMs: number,
  deps: AggregatorDeps,
) {
  const buffers = new Map<string, BufferedNotification[]>();

  function buildDigest(group: string, items: BufferedNotification[]): NotificationSpec {
    const titles = items.map((b) => b.spec.title);
    const summary =
      items.length === 1
        ? items[0].spec.title
        : `today: ${titles.join(' · ')}`;
    const earliest = items.reduce((m, b) => Math.min(m, b.enqueuedAt), Infinity);
    return {
      title: summary,
      body: items.length > 1 ? titles.map((t) => `• ${t}`).join('\n') : items[0].spec.body,
      category: items[0].spec.category,
      dedupe_key: `digest:${group}:${earliest}`,
      aggregation_group: group,
      extra: { aggregated_count: items.length, source_keys: items.map((b) => b.spec.dedupe_key) },
    };
  }

  function flush(group: string): void {
    const items = buffers.get(group);
    if (!items || items.length === 0) {
      buffers.delete(group);
      return;
    }
    const digest = buildDigest(group, items);
    buffers.delete(group);
    deps.cancelFlush(group);
    void deps.deliver(digest);
  }

  function enqueue(spec: NotificationSpec): void {
    const group = spec.aggregation_group ?? spec.category;
    const arr = buffers.get(group) ?? [];
    arr.push({ spec, enqueuedAt: deps.now() });
    buffers.set(group, arr);
    if (arr.length === 1) {
      // Schedule a flush for windowMs after the first item.
      deps.scheduleFlush(group, deps.now() + windowMs, () => flush(group));
    }
  }

  function flushAll(): void {
    for (const group of Array.from(buffers.keys())) {
      flush(group);
    }
  }

  function size(group?: string): number {
    if (group) return buffers.get(group)?.length ?? 0;
    let n = 0;
    for (const arr of buffers.values()) n += arr.length;
    return n;
  }

  return { enqueue, flush, flushAll, size };
}
