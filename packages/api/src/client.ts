/**
 * @ollie/api · client (C6)
 *
 * Centralised fetch wrapper used by every HTTP-touching surface in
 * the app. One place to set timeouts, retries, auth headers, and the
 * error envelope shape that callers consume.
 *
 * Usage:
 *   import { createOllieAPI } from '@ollie/api';
 *   const api = createOllieAPI({
 *     anthropicProxy: 'https://...workers.dev/anthropic',
 *     supabaseUrl:    'https://...supabase.co',
 *     supabaseAnonKey: '...',
 *   });
 *   const r = await api.supabase.rest.get('/encrypted_state', { authJwt });
 *   if (!r.ok) toast('couldn\'t sync — offline?');
 *
 * Constitutional: every external HTTP call goes through this client.
 * Modules MUST NOT import `fetch` directly for production paths.
 */

export interface OllieApiError {
  /** Stable code callers can branch on. */
  code:
    | 'network'        // fetch threw / no connection
    | 'timeout'        // request exceeded timeoutMs
    | 'http'           // server returned non-2xx
    | 'parse'          // response body failed to JSON.parse
    | 'aborted'        // caller aborted via AbortSignal
    | 'unauthorized';  // 401 — refresh token path
  /** HTTP status code, when applicable. */
  status?: number;
  /** Short human-readable summary. Brand voice: lowercase, factual. */
  message: string;
  /** Raw response body (string) on http errors. Useful for debugging. */
  body?: string;
}

export type OllieApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: OllieApiError };

export interface RequestOptions {
  /** Bearer auth token (Supabase JWT, etc.). Authorization header injected automatically. */
  authJwt?: string;
  /** Extra headers merged in. */
  headers?: Record<string, string>;
  /** Request body — JSON-serialized if not a string / FormData / Uint8Array. */
  body?: unknown;
  /** ms. Default 15000. */
  timeoutMs?: number;
  /** Retry policy. Default { max: 2, baseDelayMs: 250 } for GETs, 0 for non-GETs. */
  retry?: { max: number; baseDelayMs: number };
  /** Caller-provided abort signal. */
  signal?: AbortSignal;
  /** When `false`, response is returned as text instead of parsed JSON. */
  parseJson?: boolean;
}

export interface OllieApiConfig {
  /** Cloudflare Worker URL that proxies Anthropic Haiku. */
  anthropicProxy?: string;
  /** Supabase project URL — e.g. https://ykxzfzkfsolwgmheiwpx.supabase.co */
  supabaseUrl?: string;
  /** Supabase anon key — sent as `apikey` header. */
  supabaseAnonKey?: string;
  /** Default timeout for any request. */
  defaultTimeoutMs?: number;
  /** Default retry for GETs. */
  defaultGetRetry?: { max: number; baseDelayMs: number };
  /** Injected fetch — defaults to globalThis.fetch. Used by tests. */
  fetchImpl?: typeof fetch;
}

interface PreparedRequest {
  url: string;
  init: RequestInit;
  timeoutMs: number;
  retry: { max: number; baseDelayMs: number };
  parseJson: boolean;
}

// ──────────────────────────────────────────────────────────────────────────
// the singleton factory
// ──────────────────────────────────────────────────────────────────────────

export function createOllieAPI(cfg: OllieApiConfig = {}) {
  const defaultTimeout = cfg.defaultTimeoutMs ?? 15_000;
  const defaultGetRetry = cfg.defaultGetRetry ?? { max: 2, baseDelayMs: 250 };
  const fetchImpl: typeof fetch = cfg.fetchImpl ?? (globalThis.fetch.bind(globalThis));

  function prepare(
    method: string,
    url: string,
    opts: RequestOptions = {},
  ): PreparedRequest {
    const headers: Record<string, string> = {
      'accept': 'application/json',
      ...(opts.headers ?? {}),
    };
    if (opts.authJwt) headers['authorization'] = `Bearer ${opts.authJwt}`;

    let bodyOut: BodyInit | undefined;
    if (opts.body != null) {
      if (
        typeof opts.body === 'string'
        || (typeof FormData !== 'undefined' && opts.body instanceof FormData)
        || opts.body instanceof Uint8Array
        || opts.body instanceof ArrayBuffer
      ) {
        bodyOut = opts.body as BodyInit;
      } else {
        bodyOut = JSON.stringify(opts.body);
        if (!headers['content-type']) headers['content-type'] = 'application/json';
      }
    }

    const retry = opts.retry ?? (method === 'GET' ? defaultGetRetry : { max: 0, baseDelayMs: 0 });

    return {
      url,
      init: {
        method,
        headers,
        body: bodyOut,
        signal: opts.signal,
      },
      timeoutMs: opts.timeoutMs ?? defaultTimeout,
      retry,
      parseJson: opts.parseJson ?? true,
    };
  }

  async function doFetch<T>(req: PreparedRequest, attempt: number): Promise<OllieApiResult<T>> {
    // Retry telemetry: `attempt` is 0 on the first try. Anything higher
    // means a prior attempt failed retriably and we're now re-issuing
    // the request. Log it so retry storms are visible in the console.
    // Lightweight on purpose — matches the `console.warn('[prefix] …')`
    // pattern already used across the codebase; no metrics sink exists.
    if (attempt > 0) {
      const method = req.init.method ?? 'GET';
      console.warn(`[api] retry attempt ${attempt}/${req.retry.max} — ${method} ${req.url}`);
    }
    // Compose abort: caller signal + our timeout signal.
    const controller = new AbortController();
    const onCallerAbort = () => controller.abort('caller-aborted');
    const callerSignal = (req.init.signal ?? null) as AbortSignal | null;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort('caller-aborted');
      else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }

    // Promise.race between the actual fetch and our timeout. We don't
    // rely on fetch honoring the AbortSignal — some fetch impls (and
    // test fakes) don't. The signal is still passed so well-behaved
    // implementations can release resources.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort('timeout');
        reject(Object.assign(new Error('timeout'), { name: 'AbortError', __timeout: true }));
      }, req.timeoutMs);
    });

    try {
      const res = await Promise.race([
        fetchImpl(req.url, { ...req.init, signal: controller.signal }),
        timeoutPromise,
      ]);

      if (res.status === 401) {
        return {
          ok: false,
          error: { code: 'unauthorized', status: 401, message: 'unauthorized' },
        };
      }

      if (!res.ok) {
        const body = await safeText(res);
        return {
          ok: false,
          error: {
            code: 'http',
            status: res.status,
            message: `http ${res.status}`,
            body,
          },
        };
      }

      if (!req.parseJson) {
        const data = (await res.text()) as unknown as T;
        return { ok: true, data, status: res.status };
      }

      try {
        const data = (await res.json()) as T;
        return { ok: true, data, status: res.status };
      } catch (err) {
        return {
          ok: false,
          error: { code: 'parse', status: res.status, message: `parse failed: ${(err as Error).message}` },
        };
      }
    } catch (err) {
      const e = err as Error & { name?: string; __timeout?: boolean };
      if (timedOut || e?.__timeout) {
        return { ok: false, error: { code: 'timeout', message: `timeout after ${req.timeoutMs}ms` } };
      }
      if (e?.name === 'AbortError') {
        return { ok: false, error: { code: 'aborted', message: 'aborted' } };
      }
      return { ok: false, error: { code: 'network', message: e?.message ?? 'network error' } };
    } finally {
      if (timer) clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }

  async function executeWithRetry<T>(req: PreparedRequest): Promise<OllieApiResult<T>> {
    let lastError: OllieApiError | undefined;
    for (let attempt = 0; attempt <= req.retry.max; attempt++) {
      const result = await doFetch<T>(req, attempt);
      if (result.ok) {
        // Telemetry: a retry that eventually succeeded is worth a line —
        // it means the network/server was flaky but the request landed.
        if (attempt > 0) {
          console.warn(`[api] recovered after ${attempt} retr${attempt === 1 ? 'y' : 'ies'} — ${req.init.method ?? 'GET'} ${req.url}`);
        }
        return result;
      }
      lastError = result.error;
      // Retry only network / timeout / 5xx. Never retry 4xx, parse, or aborted.
      const retriable =
        result.error.code === 'network'
        || result.error.code === 'timeout'
        || (result.error.code === 'http' && (result.error.status ?? 0) >= 500);
      if (!retriable) return result;
      if (attempt === req.retry.max) break;
      const delay = req.retry.baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
    // Telemetry: all retries exhausted — surface the give-up point.
    if (req.retry.max > 0) {
      console.warn(`[api] gave up after ${req.retry.max + 1} attempts — ${req.init.method ?? 'GET'} ${req.url} (${lastError?.code ?? 'unknown'})`);
    }
    return { ok: false, error: lastError ?? { code: 'network', message: 'unknown failure' } };
  }

  async function request<T>(
    method: string,
    url: string,
    opts?: RequestOptions,
  ): Promise<OllieApiResult<T>> {
    const req = prepare(method, url, opts);
    return executeWithRetry<T>(req);
  }

  // ── Supabase REST helpers ──────────────────────────────────────────────
  const supabaseHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {};
    if (cfg.supabaseAnonKey) h['apikey'] = cfg.supabaseAnonKey;
    return h;
  };

  function supabaseRestUrl(pathOrTable: string, params?: Record<string, string>): string {
    if (!cfg.supabaseUrl) throw new Error('@ollie/api: supabaseUrl not configured');
    const base = cfg.supabaseUrl.replace(/\/$/, '');
    const path = pathOrTable.startsWith('/') ? pathOrTable : `/rest/v1/${pathOrTable}`;
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return base + path + q;
  }

  return {
    /** Generic — escape hatch for callers that need direct control. */
    request,

    /** Anthropic Haiku proxy (existing path — wraps the Worker). */
    anthropic: {
      proxyUrl: cfg.anthropicProxy ?? null,
      route<T>(body: unknown, opts: RequestOptions = {}): Promise<OllieApiResult<T>> {
        if (!cfg.anthropicProxy) {
          return Promise.resolve({ ok: false, error: { code: 'network', message: 'anthropicProxy not configured' } });
        }
        return request<T>('POST', cfg.anthropicProxy, { ...opts, body });
      },
    },

    /** Supabase REST + Auth helpers. Sync uses `rest.upsert`; auth uses `auth.signUp`. */
    supabase: {
      url: cfg.supabaseUrl ?? null,
      anonKey: cfg.supabaseAnonKey ?? null,

      rest: {
        get<T>(table: string, opts: RequestOptions & { params?: Record<string, string> } = {}): Promise<OllieApiResult<T>> {
          return request<T>('GET', supabaseRestUrl(table, opts.params), {
            ...opts,
            headers: { ...supabaseHeaders(), ...(opts.headers ?? {}) },
          });
        },
        /**
         * Call a Postgres function via PostgREST's RPC surface
         * (`POST /rest/v1/rpc/<fn>`). `args` becomes the JSON request body —
         * named arguments map 1:1 to the function's parameter names.
         *
         * Used for SECURITY DEFINER functions that must be reachable with
         * only the anon key but without granting table-level SELECT — e.g.
         * `profile_recovery_lookup` for the new-device sign-in path. Pass
         * `authJwt` when the function should run as an authed user.
         */
        rpc<T>(fn: string, args: Record<string, unknown> = {}, opts: RequestOptions = {}): Promise<OllieApiResult<T>> {
          return request<T>('POST', supabaseRestUrl(`/rest/v1/rpc/${fn}`), {
            ...opts,
            body: args,
            headers: { ...supabaseHeaders(), ...(opts.headers ?? {}) },
          });
        },
        upsert<T>(table: string, rows: unknown, opts: RequestOptions = {}): Promise<OllieApiResult<T>> {
          return request<T>('POST', supabaseRestUrl(table), {
            ...opts,
            body: rows,
            headers: {
              ...supabaseHeaders(),
              ...(opts.headers ?? {}),
              'prefer': 'resolution=merge-duplicates,return=representation',
            },
          });
        },
        delete<T>(table: string, opts: RequestOptions & { params?: Record<string, string> } = {}): Promise<OllieApiResult<T>> {
          return request<T>('DELETE', supabaseRestUrl(table, opts.params), {
            ...opts,
            headers: { ...supabaseHeaders(), ...(opts.headers ?? {}) },
          });
        },
      },

      auth: {
        signUp(email: string, password: string): Promise<OllieApiResult<{ user: unknown; session: unknown }>> {
          return request('POST', `${cfg.supabaseUrl}/auth/v1/signup`, {
            body: { email, password },
            headers: supabaseHeaders(),
            retry: { max: 0, baseDelayMs: 0 },
          });
        },
        signInWithPassword(email: string, password: string): Promise<OllieApiResult<{ user: unknown; session: { access_token: string; refresh_token: string } }>> {
          return request('POST', `${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
            body: { email, password },
            headers: supabaseHeaders(),
            retry: { max: 0, baseDelayMs: 0 },
          });
        },
        refresh(refreshToken: string): Promise<OllieApiResult<{ access_token: string; refresh_token: string }>> {
          return request('POST', `${cfg.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
            body: { refresh_token: refreshToken },
            headers: supabaseHeaders(),
            retry: { max: 1, baseDelayMs: 500 },
          });
        },
        signOut(authJwt: string): Promise<OllieApiResult<unknown>> {
          return request('POST', `${cfg.supabaseUrl}/auth/v1/logout`, {
            authJwt,
            headers: supabaseHeaders(),
            retry: { max: 0, baseDelayMs: 0 },
          });
        },
      },
    },
  };
}

export type OllieAPI = ReturnType<typeof createOllieAPI>;

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string | undefined> {
  try { return await res.text(); } catch { return undefined; }
}
