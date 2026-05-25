/**
 * apps/web · shared ID generator
 *
 * Single source of truth for client-side entity IDs. Previously ~20 call
 * sites rolled their own `Date.now() + Math.random()` scheme — that pattern
 * collides under rapid creates (two items made in the same millisecond can
 * land the same `Math.random().slice()` suffix), and the timestamp leaks
 * creation order into the ID.
 *
 * `mkId()` uses `crypto.randomUUID()` — 122 bits of entropy, collision-free
 * for any realistic workload. The `getRandomValues` fallback mirrors the
 * pattern already proven in `lib/device.ts` for runtimes without
 * `randomUUID` (very old WebViews).
 *
 * @param prefix optional short tag (e.g. 'g', 'task', 'bill'). When given,
 *               the returned ID is `${prefix}-${uuid}` so existing IDs stay
 *               human-scannable and per-type. Omit it for an opaque UUID.
 */
export function mkId(prefix?: string): string {
  const uuid = randomUuid();
  return prefix ? `${prefix}-${uuid}` : uuid;
}

function randomUuid(): string {
  const g = globalThis as {
    crypto?: {
      randomUUID?: () => string;
      getRandomValues?: (a: Uint8Array) => Uint8Array;
    };
  };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback for very old runtimes — RFC 4122 v4 layout.
  const bytes = new Uint8Array(16);
  g.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
