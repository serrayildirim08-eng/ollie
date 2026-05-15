/**
 * apps/web · label client
 *
 * HTTP wrapper around the ai-proxy worker's `POST /label` endpoint. This is
 * the app-layer half of the Sprint B' research pipeline: the orchestrator
 * (`@ollie/orchestrator` · research) owns scrub + batch + consent gating;
 * this file owns the worker URL + the wire format.
 *
 * Contract — implements `LabelClient` from
 * `packages/orchestrator/src/research.ts`:
 *
 *   postLabel({ scrubbed_text, sector_hint?, locale }) → { corpus_id }
 *
 * Wire format (see workers/ai-proxy/src/label.ts · handleLabel):
 *   - Method: POST
 *   - URL:    `${VITE_AI_WORKER_URL}/label`
 *   - Headers: `content-type: application/json` ONLY. The /label route in
 *     workers/ai-proxy/src/index.ts does NOT participate in the per-user
 *     rate limit and requires NO bearer token or x-user-id header — the
 *     worker holds ANTHROPIC_API_KEY + SUPABASE_SERVICE_ROLE server-side
 *     and the research row is anonymized at write (no user identifier is
 *     ever sent here). Adding auth headers would be dead weight.
 *   - Body: `{ scrubbed_text, sector_hint?, locale }`
 *   - Response 200: `{ corpus_id, label }` — we only surface corpus_id.
 *   - Non-200: throws. The orchestrator swallows + reports via onError;
 *     it never retries (avoids duplicate corpus rows + double billing).
 *
 * Privacy: `scrubbed_text` arrives already PII-scrubbed by the orchestrator.
 * The worker re-scrubs server-side as belt-and-suspenders. This client adds
 * nothing identifying.
 */

import type { LabelClient } from '@ollie/orchestrator';

/**
 * The exact `postLabel` payload shape, sourced from the orchestrator's
 * `LabelClient` interface so this file carries no direct dependency on
 * `@ollie/pii-scrub` just for the `Locale` type.
 */
type LabelPayload = Parameters<LabelClient['postLabel']>[0];

export interface LabelClientDeps {
  /** Base URL of the ai-proxy worker, e.g. https://ollie-ai-proxy.workers.dev */
  workerUrl: string;
  /** Injected for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface LabelOkResponse {
  corpus_id?: unknown;
}

/**
 * Build a `LabelClient` bound to a concrete worker URL. Throws from
 * `postLabel` on any non-2xx / malformed response so the orchestrator's
 * `onError` hook fires and the row is dropped (best-effort corpus).
 */
export function createLabelClient(deps: LabelClientDeps): LabelClient {
  const fetchImpl =
    deps.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const endpoint = `${deps.workerUrl.replace(/\/$/, '')}/label`;

  return {
    async postLabel(payload: LabelPayload): Promise<{ corpus_id: string }> {
      if (!fetchImpl) {
        throw new Error('label-client: no fetch implementation available');
      }

      const body: Record<string, unknown> = {
        scrubbed_text: payload.scrubbed_text,
        locale: payload.locale,
      };
      // Only include sector_hint when present — the worker rejects an
      // explicit invalid value, and `undefined` would serialize away anyway.
      if (payload.sector_hint !== undefined) {
        body.sector_hint = payload.sector_hint;
      }

      const resp = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        let detail = '';
        try {
          detail = await resp.text();
        } catch {
          /* ignore — status alone is enough signal */
        }
        throw new Error(
          `label-client: /label responded ${resp.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`,
        );
      }

      let parsed: LabelOkResponse;
      try {
        parsed = (await resp.json()) as LabelOkResponse;
      } catch {
        throw new Error('label-client: /label returned non-JSON body');
      }

      if (typeof parsed.corpus_id !== 'string' || parsed.corpus_id.length === 0) {
        throw new Error('label-client: /label response missing corpus_id');
      }

      return { corpus_id: parsed.corpus_id };
    },
  };
}
