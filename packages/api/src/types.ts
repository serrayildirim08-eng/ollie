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
}
