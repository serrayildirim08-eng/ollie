/**
 * apps/web · user_hash derivation
 *
 * SHA-256(email + VITE_USER_HASH_SALT). Irreversible. Same hash from
 * any device the user signs in on; new hash if they ever change email.
 * This is the only identifier sent with telemetry rows — there is NO
 * mapping back to email/passphrase/user_id in any Supabase table.
 *
 * If the salt is missing (e.g. dev environment), we fall back to an
 * empty string. That makes the hash technically deterministic for any
 * given email but breaks isolation if anyone outside the team can
 * generate the same hash — so prod env MUST set VITE_USER_HASH_SALT.
 */

interface ViteEnv {
  VITE_USER_HASH_SALT?: string;
}

const env: ViteEnv = (import.meta as unknown as { env?: ViteEnv }).env ?? {};

// In-memory cache so we don't re-hash on every retention emit.
let cachedEmail: string | null = null;
let cachedHash: string | null = null;

export async function deriveUserHash(email: string): Promise<string> {
  if (!email) return '';
  if (cachedEmail === email && cachedHash) return cachedHash;
  const salt = env.VITE_USER_HASH_SALT ?? '';
  const input = `${email.trim().toLowerCase()}${salt}`;
  const hash = await sha256Hex(input);
  cachedEmail = email;
  cachedHash = hash;
  return hash;
}

/** Synchronous accessor — returns the last derived hash, or null. */
export function readUserHash(): string | null {
  return cachedHash;
}

/** For tests + sign-out. */
export function resetUserHash(): void {
  cachedEmail = null;
  cachedHash = null;
}

async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}
