// @ts-nocheck — legacy auth provider, superseded by Clerk in main.tsx.
// Kept for reference until the auth/ folder is fully removed.
/**
 * AuthProvider · Ollie native (Tauri)
 *
 * Wraps the @ollie/auth client (Pattern A: passphrase-on-device, server-blind
 * for the user's secret) in a React context. The passphrase NEVER leaves the
 * device; Supabase only ever sees a random 32-byte serverPassword.
 *
 * Boot wiring lives here (single-call). Future modules read auth state via
 * the `useAuth()` hook — they should never instantiate AuthClient directly.
 *
 * --------------------------------------------------------------------------
 * DEPS TO INSTALL (do not run pnpm here — Serra does it):
 *   workspace deps (add to apps/native/package.json):
 *     "@ollie/auth":   "workspace:*"
 *     "@ollie/api":    "workspace:*"
 *     "@ollie/store":  "workspace:*"
 *   no new npm deps — everything is workspace-local.
 * --------------------------------------------------------------------------
 */

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createOllieAPI, type OllieAPI } from '@ollie/api';
import { browserAdapter, createStore, type Store } from '@ollie/store';
import {
  createAuthClient,
  type AuthClient,
  type AuthSession,
  type SignInResultLike,
  type SignUpResultLike,
} from '@ollie/auth';

// ──────────────────────────────────────────────────────────────────────────
// public surface
// ──────────────────────────────────────────────────────────────────────────

export interface AuthUser {
  user_id: string;
  email: string;
}

export interface AuthContextValue {
  /** Current authenticated user, or null when signed out. */
  user: AuthUser | null;
  /** Convenience boolean: a session AND an in-memory encryption key. */
  isAuthenticated: boolean;
  /** Last email used on this device — UI pre-fills with this. */
  cachedEmail: string | null;
  /** Sign in with passphrase + cached email. */
  signIn: (email: string, passphrase: string) => Promise<SignInResultLike>;
  /** Sign up. `invite` is gated client-side; backend re-verifies. */
  signUp: (
    email: string,
    passphrase: string,
    passphraseConfirm: string,
    invite: string,
  ) => Promise<SignUpResultLike>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

// ──────────────────────────────────────────────────────────────────────────
// env reader
// ──────────────────────────────────────────────────────────────────────────

interface ViteEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_ANTHROPIC_PROXY_URL?: string;
  VITE_API_WORKER_URL?: string;
  VITE_INVITE_CODES?: string;
}

function readEnv(): ViteEnv {
  // Vite injects import.meta.env at build time. Guard for tests / SSR.
  const meta = import.meta as unknown as { env?: ViteEnv };
  return meta.env ?? {};
}

/**
 * Invite code allow-list. Comma-separated codes in VITE_INVITE_CODES — for
 * alpha we client-gate; backend re-verifies via a dedicated worker route in
 * a future sprint. Returns true if no codes are configured (dev mode).
 */
function isInviteAccepted(invite: string, env: ViteEnv): boolean {
  const raw = env.VITE_INVITE_CODES?.trim();
  if (!raw) return true; // dev mode — gate is off
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(invite.trim());
}

// ──────────────────────────────────────────────────────────────────────────
// singletons (module-scope so HMR doesn't double-boot)
// ──────────────────────────────────────────────────────────────────────────

interface AuthHandles {
  store: Store;
  api: OllieAPI;
  auth: AuthClient;
}

let bootedHandles: AuthHandles | null = null;

function bootHandles(): AuthHandles {
  if (bootedHandles) return bootedHandles;
  const env = readEnv();
  const store = createStore(browserAdapter);
  const api = createOllieAPI({
    anthropicProxy: env.VITE_ANTHROPIC_PROXY_URL,
    supabaseUrl: env.VITE_SUPABASE_URL,
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY,
  });
  const accountDeleteUrl = env.VITE_API_WORKER_URL
    ? `${env.VITE_API_WORKER_URL.replace(/\/$/, '')}/account/delete`
    : undefined;
  const auth = createAuthClient({ store, api, accountDeleteUrl });
  bootedHandles = { store, api, auth };
  return bootedHandles;
}

// ──────────────────────────────────────────────────────────────────────────
// provider
// ──────────────────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  // Boot once. Refs let us survive React.StrictMode double-invoke without
  // re-creating the client.
  const handlesRef = useRef<AuthHandles>(bootHandles());
  const { store, auth } = handlesRef.current;

  // Hydrate from store — both session and cached login email.
  const initialSession = store.get<AuthSession | null>('shared', 'auth.session', null);
  const initialEmail = store.get<string | null>('shared', 'auth.email_for_login', null);

  const [session, setSession] = useState<AuthSession | null>(initialSession);
  const [cachedEmail, setCachedEmail] = useState<string | null>(initialEmail);
  // `unlocked` mirrors whether the encryption key is in-memory. Required
  // because a session can be hydrated from disk on cold start, but the
  // CryptoKey is never persisted — only signIn rebuilds it.
  const [unlocked, setUnlocked] = useState<boolean>(auth.state().unlocked);

  // Refresh local state from auth client. Cheap — pure store reads.
  const refresh = useCallback(() => {
    const s = auth.state();
    setSession(s.session);
    setUnlocked(s.unlocked);
    setCachedEmail(store.get<string | null>('shared', 'auth.email_for_login', null));
  }, [auth, store]);

  // signIn / signUp / signOut wrappers — keep ergonomic shape for the UI
  // while preserving the AuthClient's typed result envelopes.
  const signIn = useCallback<AuthContextValue['signIn']>(
    async (email, passphrase) => {
      const r = await auth.signIn({ email, passphrase });
      if (r.ok) refresh();
      return r;
    },
    [auth, refresh],
  );

  const signUp = useCallback<AuthContextValue['signUp']>(
    async (email, passphrase, passphraseConfirm, invite) => {
      const env = readEnv();
      if (!isInviteAccepted(invite, env)) {
        return {
          ok: false,
          code: 'no-consent',
          message: 'invite code not recognised',
        };
      }
      const r = await auth.signUp({
        email,
        passphrase,
        passphraseConfirm,
        acknowledged_unrecoverable: true,
      });
      if (r.ok) refresh();
      return r;
    },
    [auth, refresh],
  );

  const signOut = useCallback<AuthContextValue['signOut']>(async () => {
    await auth.signOut();
    refresh();
  }, [auth, refresh]);

  // Re-sync once on mount in case another tab / window changed state.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const user = useMemo<AuthUser | null>(() => {
    if (!session) return null;
    return { user_id: session.user_id, email: session.email };
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      // "isAuthenticated" requires BOTH a session and an unlocked key.
      // A hydrated-from-disk session without unlock means the user must
      // re-enter their passphrase — we don't show authed UI until then.
      isAuthenticated: user !== null && unlocked,
      cachedEmail,
      signIn,
      signUp,
      signOut,
    }),
    [user, unlocked, cachedEmail, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
