/**
 * @ollie/orchestrator · research
 *
 * Sprint B' pivot 2026-05-14. This orchestrator wires the opt-in research
 * data-collection pipeline:
 *
 *   user writes to a scrubbable table
 *     ↓
 *   batched (60s) → check `hasResearchConsent(userId)`
 *     ↓ opt-in
 *   scrubPII(text, locale) → POST /label → research_corpus row
 *     ↓
 *   research-cache invalidates the per-sector pattern cache
 *
 *   ↓ opt-out
 *   nothing leaves the device. user row was already written by the upstream
 *   module orchestrator; this orchestrator simply no-ops.
 *
 * Scrubbable tables (text fields enumerated below):
 *   - brain_dump_log               full text
 *   - finance_records.description
 *   - body_records.note
 *   - home_records.note
 *   - work_records.description
 *
 * Failure mode: silent. We log to sentry-tunnel via the optional `onError`
 * hook and never block the user's write.
 *
 * Idempotency: the batch buffer dedupes on (table, row_id) so re-emitting
 * the same event twice doesn't double-label or double-bill.
 */

import type { Store } from '@ollie/store';
import type { Unsubscribe } from '@ollie/events';
import * as events from '@ollie/events';
import { hasResearchConsent } from '@ollie/consent';
import { scrubPII, type Locale } from '@ollie/pii-scrub';
import type { Orchestrator } from './types';

export const SCRUBBABLE_TABLES = [
  'brain_dump_log',
  'finance_records',
  'body_records',
  'home_records',
  'work_records',
] as const;

export type ScrubbableTable = (typeof SCRUBBABLE_TABLES)[number];

export interface ScrubbableWrite {
  /** Stable identifier for this row in its source table — used for dedupe. */
  row_id: string;
  table: ScrubbableTable;
  /** The text field to scrub + label. Caller decides which field. */
  text: string;
  /** Locale of the text — drives wordlist selection. */
  locale: Locale;
  /** Optional sector hint to pin the corpus row to a specific sector. */
  sector_hint?: string;
  /** ms epoch — for observability only, not persisted to corpus. */
  ts: number;
}

export interface LabelClient {
  /**
   * POST {AI_PROXY_URL}/label with the scrubbed text. Returns the corpus_id
   * on success or throws on failure (orchestrator swallows + reports).
   */
  postLabel(payload: {
    scrubbed_text: string;
    sector_hint?: string;
    locale: Locale;
  }): Promise<{ corpus_id: string }>;
}

export interface ResearchOrchestratorOptions {
  /** Stable per-user identifier. Used only by consent reader; never sent
   *  to /label. */
  userId: string;
  /** HTTP client wrapping /label. App-layer responsibility because the
   *  worker URL + auth headers live there. */
  labelClient: LabelClient;
  /** Batch flush interval. Default 60s per Sprint B' brief. */
  batchIntervalMs?: number;
  /** Sentry-tunnel hook for silent failures. Stays no-op in tests. */
  onError?: (err: unknown, context: { table: ScrubbableTable; row_id: string }) => void;
  /** Cache invalidation hook — orchestrator calls this with the sector
   *  written after each successful label. Lets the research-cache layer
   *  evict its 1h cache for that sector if it cares about freshness. */
  onCorpusAppended?: (sector: string, corpusId: string) => void;
  /** Test override for the clock. */
  now?: () => number;
}

/**
 * Event name the upstream module orchestrators emit when they write a
 * scrubbable row. Buffer lives in-orchestrator; nothing is persisted
 * outside the 60s window.
 */
export const RESEARCH_INTAKE_EVENT = 'research:row_written';

export function createResearchOrchestrator(
  _store: Store,
  opts: ResearchOrchestratorOptions,
): Orchestrator {
  const {
    userId,
    labelClient,
    batchIntervalMs = 60_000,
    onError = () => {},
    onCorpusAppended = () => {},
    now = () => Date.now(),
  } = opts;

  let initialized = false;
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  const unsubs: Unsubscribe[] = [];

  /** Pending writes keyed by `${table}:${row_id}` — last write wins. */
  const pending = new Map<string, ScrubbableWrite>();

  /** Track row keys we've already shipped to corpus this session, so the
   *  same event re-emitted is a no-op. Cleared on teardown. */
  const shipped = new Set<string>();

  function onIntake(payload: ScrubbableWrite): void {
    if (!isScrubbableTable(payload.table)) return;
    if (typeof payload.text !== 'string' || payload.text.length === 0) return;
    const key = `${payload.table}:${payload.row_id}`;
    if (shipped.has(key)) return;
    pending.set(key, payload);
  }

  async function flush(): Promise<void> {
    if (pending.size === 0) return;
    // Consent is a per-user gate — re-check every flush so a mid-session
    // opt-out stops the pipeline immediately on the next tick.
    let optedIn: boolean;
    try {
      optedIn = await hasResearchConsent(userId);
    } catch (err) {
      onError(err, { table: 'brain_dump_log', row_id: '<consent-check>' });
      return;
    }

    if (!optedIn) {
      // Opt-out path: drop everything. User row was already persisted by the
      // upstream orchestrator. Nothing leaves the device.
      pending.clear();
      return;
    }

    // Drain the buffer into a local array so re-entry from new emits during
    // the await doesn't get processed twice.
    const drain = Array.from(pending.values());
    pending.clear();

    for (const write of drain) {
      const key = `${write.table}:${write.row_id}`;
      try {
        const scrubResult = scrubPII(write.text, write.locale);
        // Skip if scrubbing left only PII tokens — no signal worth labeling.
        const stripped = scrubResult.scrubbed.replace(/\[(EMAIL|PHONE|ADDRESS|URL|GPS|NUMERIC|NAME)\]/g, '').trim();
        if (stripped.length < 3) {
          shipped.add(key);
          continue;
        }

        const resp = await labelClient.postLabel({
          scrubbed_text: scrubResult.scrubbed,
          sector_hint: write.sector_hint,
          locale: write.locale,
        });

        shipped.add(key);

        // Best-effort cache invalidation. We don't know the inferred sector
        // unless caller hinted, so emit the hint if present, else 'other'.
        onCorpusAppended(write.sector_hint ?? 'other', resp.corpus_id);
      } catch (err) {
        onError(err, { table: write.table, row_id: write.row_id });
        // Drop on failure — corpus is best-effort. Don't retry (would risk
        // duplicate writes + cost). Operator can re-seed from the source
        // table if needed.
        shipped.add(key);
      }
    }
  }

  function startTimer(): void {
    if (flushTimer) return;
    flushTimer = setInterval(() => {
      void flush().catch((err) => onError(err, { table: 'brain_dump_log', row_id: '<flush>' }));
    }, batchIntervalMs);
  }

  function stopTimer(): void {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  }

  return {
    init(): void {
      if (initialized) return;
      initialized = true;

      const off = events.on(RESEARCH_INTAKE_EVENT, (payload: unknown) => {
        if (!isScrubbableWrite(payload)) return;
        onIntake(payload);
      });
      unsubs.push(off);

      startTimer();
      // Also nudge a recompute for observability — does nothing if pending
      // is empty. Useful in tests + after a hot reload.
      void Promise.resolve().then(() => {
        if (now() > 0) {
          /* placeholder so `now` stays meaningful for tests; real flush
             waits for the interval */
        }
      });
    },
    teardown(): void {
      stopTimer();
      for (const off of unsubs) {
        try {
          off();
        } catch {
          /* ignore */
        }
      }
      unsubs.length = 0;
      pending.clear();
      shipped.clear();
      initialized = false;
    },
  };
}

// ─── exports for direct invocation (test + integration paths) ─────────────────

/**
 * Synchronous helper used by tests + the future cron worker. Runs the full
 * pipeline once for a single write, bypassing the batch buffer. Returns
 * `{ skipped: true, reason }` for the opt-out path so callers can assert
 * on it.
 */
export async function runResearchPipeline(input: {
  userId: string;
  write: ScrubbableWrite;
  labelClient: LabelClient;
}): Promise<
  | { ok: true; corpus_id: string }
  | { ok: false; skipped: 'opt_out' | 'empty_after_scrub' | 'invalid_table' }
> {
  if (!isScrubbableTable(input.write.table)) {
    return { ok: false, skipped: 'invalid_table' };
  }
  const consented = await hasResearchConsent(input.userId);
  if (!consented) return { ok: false, skipped: 'opt_out' };

  const { scrubbed } = scrubPII(input.write.text, input.write.locale);
  const stripped = scrubbed.replace(/\[(EMAIL|PHONE|ADDRESS|URL|GPS|NUMERIC|NAME)\]/g, '').trim();
  if (stripped.length < 3) return { ok: false, skipped: 'empty_after_scrub' };

  const resp = await input.labelClient.postLabel({
    scrubbed_text: scrubbed,
    sector_hint: input.write.sector_hint,
    locale: input.write.locale,
  });
  return { ok: true, corpus_id: resp.corpus_id };
}

// ─── guards ───────────────────────────────────────────────────────────────────

function isScrubbableTable(t: unknown): t is ScrubbableTable {
  return typeof t === 'string' && (SCRUBBABLE_TABLES as readonly string[]).includes(t);
}

function isScrubbableWrite(p: unknown): p is ScrubbableWrite {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.row_id === 'string' &&
    isScrubbableTable(o.table) &&
    typeof o.text === 'string' &&
    typeof o.locale === 'string' &&
    (o.sector_hint === undefined || typeof o.sector_hint === 'string') &&
    typeof o.ts === 'number'
  );
}
