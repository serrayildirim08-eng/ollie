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
 *   - Headers: `content-type: application/json` AND
 *     `authorization: Bearer <supabase-user-jwt>`. As of the 2026-05-17
 *     security fix the /label route in workers/ai-proxy REQUIRES a verified
 *     Supabase user JWT — the endpoint uses ANTHROPIC_API_KEY +
 *     SUPABASE_SERVICE_ROLE server-side, so leaving it open let anyone burn
 *     the Anthropic budget. The JWT only authenticates the caller; the
 *     research_corpus row itself is still anonymized at write (no user
 *     identifier is persisted), so the privacy posture is unchanged.
 *   - Body: `{ scrubbed_text, sector_hint?, locale }`
 *   - Response 200: `{ corpus_id, label }` — we only surface corpus_id.
 *   - Non-200: throws. The orchestrator swallows + reports via onError;
 *     it never retries (avoids duplicate corpus rows + double billing).
 *
 * Privacy: `scrubbed_text` arrives already PII-scrubbed by the orchestrator.
 * The worker re-scrubs server-side as belt-and-suspenders. This client adds
 * nothing identifying — the JWT is an auth credential, not corpus data.
 */

import type { LabelClient } from '@ollie/orchestrator';
import { getAuthJwt } from './account-boot';

/**
 * Default JWT source — the Supabase access token off the booted auth
 * client. Same access path as lib/invite.ts · getJwt().
 */
function defaultGetJwt(): string | null {
  // Phase 1 (Clerk migration): no Supabase-accepted JWT — /label calls are
  // skipped. Re-wired to the Clerk session token in Phase 3.
  return getAuthJwt();
}

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
  /**
   * Injectable JWT source. Defaults to the booted auth client's Supabase
   * access token. The /label endpoint rejects calls without it.
   */
  getJwt?: () => string | null;
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
  const getJwt = deps.getJwt ?? defaultGetJwt;
  const endpoint = `${deps.workerUrl.replace(/\/$/, '')}/label`;

  return {
    async postLabel(payload: LabelPayload): Promise<{ corpus_id: string }> {
      if (!fetchImpl) {
        throw new Error('label-client: no fetch implementation available');
      }

      // The worker requires a verified Supabase JWT. Throw on a missing
      // session so the orchestrator's onError fires and the row is dropped
      // (rather than firing a POST that 401s).
      const jwt = getJwt();
      if (!jwt) {
        throw new Error('label-client: no Supabase session — cannot call /label');
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
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${jwt}`,
        },
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
