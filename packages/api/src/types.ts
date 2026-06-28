/**
 * @ollie/api · types
 */

export type { Action, AnswerRoute, Route } from '@ollie/logic/dissection';

export interface RouteViaHaikuOpts {
  /** Override the worker endpoint. Useful in tests. */
  endpoint?: string;
  /** Fetch timeout in ms. Default: 10000. */
  timeoutMs?: number;
  /** Minimum gap between calls in ms (token-bucket gate). Default: 3000. */
  minGapMs?: number;
  /**
   * Clerk session JWT. The ai-proxy worker now requires a verified Bearer
   * token on /brain-dump + /v1/messages and derives the rate-limit key from
   * the verified `sub`; without it the request 401s. (No live caller today —
   * the real flow uses the Clerk-authed /route/dump endpoint.)
   */
  bearer?: string;
}
