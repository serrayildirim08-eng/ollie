/**
 * apps/web · device + build identifiers
 *
 * `device_id` — random UUID, persisted to the local store, regenerated only
 *               if the user clears storage. NOT linked to user_hash; one
 *               user_hash can have many device_ids over time.
 *
 * `app_version` — build version baked in via Vite env. Falls back to
 *                 'dev' so tests and local dev still work.
 */

import { store } from '../store';

const NS = 'shared';
const K_DEVICE_ID = 'telemetry.device_id';

interface ViteEnv {
  VITE_APP_VERSION?: string;
}

const env: ViteEnv = (import.meta as unknown as { env?: ViteEnv }).env ?? {};

export function getDeviceId(): string {
  const existing = store.get<string>(NS, K_DEVICE_ID, '');
  if (existing) return existing;
  const id = randomUuid();
  store.set(NS, K_DEVICE_ID, id);
  return id;
}

export function getAppVersion(): string {
  return env.VITE_APP_VERSION ?? 'dev';
}

function randomUuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback for very old runtimes.
  const bytes = new Uint8Array(16);
  g.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
