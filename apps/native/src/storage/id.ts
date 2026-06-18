/**
 * Shared id generator for module repositories.
 *
 * Prefers a real UUID via Web Crypto; falls back to a timestamp + random
 * suffix string (prefixed per-module so collisions across modules stay
 * unlikely) when `crypto.randomUUID` is unavailable.
 *
 * Extracted from 12 verbatim per-repo copies — keep behavior identical.
 */
export function newId(prefix = ''): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
