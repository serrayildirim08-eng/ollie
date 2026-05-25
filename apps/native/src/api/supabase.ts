/**
 * apps/native · api/supabase.ts
 *
 * Supabase client for the Tauri/React native app.
 *
 * Uses the Supabase JS SDK directly (same pattern as the web app) rather than
 * re-implementing auth over raw REST — Tauri provides a standard browser
 * environment so the SDK works without modification.
 *
 * Deps to install (do NOT install here — add to apps/native/package.json):
 *   @supabase/supabase-js  ^2.x
 *
 * Env vars (all required — see .env.example):
 *   VITE_SUPABASE_URL       — https://<project>.supabase.co
 *   VITE_SUPABASE_ANON_KEY  — public anon key (safe to expose in client)
 */

// NOTE: This import will error until `@supabase/supabase-js` is installed.
// Run: pnpm add @supabase/supabase-js  (from apps/native/)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── env validation ───────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const val = import.meta.env[key] as string | undefined;
  if (!val) {
    throw new Error(
      `[ollie/native] Missing required env var: ${key}. ` +
        'Check apps/native/.env.example and copy to .env.local.',
    );
  }
  return val;
}

// ─── singleton ────────────────────────────────────────────────────────────────

let _client: SupabaseClient | null = null;

/**
 * Returns the Supabase client singleton.
 * Throws on first call if env vars are missing — surfaces config errors early.
 */
export function getSupabaseClient(): SupabaseClient {
  if (_client) return _client;

  const url = requireEnv('VITE_SUPABASE_URL');
  const anonKey = requireEnv('VITE_SUPABASE_ANON_KEY');

  _client = createClient(url, anonKey, {
    auth: {
      // Tauri runs in a WebView — localStorage is available and correct.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  return _client;
}

/** Convenience re-export so callers can do: import { supabase } from '@/api/supabase' */
export const supabase: SupabaseClient = (() => {
  // Lazy proxy — evaluated on first property access, not at import time.
  // This prevents the env-missing throw from firing during tree-shaking / test imports.
  return new Proxy({} as SupabaseClient, {
    get(_target, prop) {
      return getSupabaseClient()[prop as keyof SupabaseClient];
    },
  });
})();
