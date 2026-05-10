/**
 * @ollie/orchestrator · types
 */

export interface Orchestrator {
  /** Wire all subscriptions and run initial derivations. Idempotent. */
  init(): void;
  /** Unsubscribe everything and cancel timers. Safe to call multiple times. */
  teardown(): void;
}
