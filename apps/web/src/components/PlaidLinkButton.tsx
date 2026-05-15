/**
 * apps/web · PlaidLinkButton
 *
 * Optional bank-link button shown on a single onboarding screen +
 * later in Settings. Read-only by design — we request transactions +
 * auth + identity from Plaid, nothing that can move money.
 *
 * Access-token flow (audit trail):
 *
 *   1. Component mounts, requests a link_token from the plaid-sync
 *      Worker. The Worker calls Plaid server-side using PLAID_SECRET.
 *      Token round-trip: Worker → client (short-lived, ≤ 4 hours).
 *
 *   2. User clicks "connect a bank account". react-plaid-link opens
 *      Plaid's hosted UI with the link_token.
 *
 *   3. User picks a bank, authenticates inside Plaid's UI.
 *      Plaid's UI returns a one-shot public_token to our onSuccess.
 *
 *   4. onSuccess POSTs publicToken to the plaid-sync Worker /exchange
 *      endpoint with the user's Supabase JWT for proof-of-identity.
 *      The Worker exchanges public_token → access_token server-side.
 *      Access_token transits Worker → client ONCE in plaintext over TLS.
 *
 *   5. The client immediately encrypts access_token with
 *      @ollie/crypto.encryptData(userKey, accessToken). The plaintext
 *      string is never persisted, never logged.
 *
 *   6. The client inserts a row into plaid_items with
 *      encrypted_access_token + iv. RLS scopes to auth.uid().
 *
 *   7. Plaid pushes webhooks to the Worker. The Worker stages
 *      encrypted markers in plaid_inbox (server-side key). Client
 *      drains plaid_inbox on next session.
 *
 * Consent gate: button renders nothing unless
 *   shared.consent.necessary === true
 * Even though the ConsentScreen enforces this at app entry, we double-
 * check here so an accidental render in a different surface (Settings)
 * also respects the gate.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import type { PlaidLinkOnSuccessMetadata } from 'react-plaid-link';
import { encryptData, bytesToBase64 } from '@ollie/crypto';
import { hasNecessaryConsent } from '@ollie/consent';
import { store } from '../store';
import { getAccount } from '../lib/account-boot';

interface ViteEnv {
  VITE_PLAID_SYNC_WORKER_URL?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}
const env: ViteEnv = (import.meta as unknown as { env?: ViteEnv }).env ?? {};

export interface PlaidLinkButtonProps {
  /** Called after the access_token has been successfully encrypted + persisted. */
  onLinked?: (institutionName: string | null) => void;
  /** Called on cancel or error. */
  onSkip?: () => void;
}

type Phase = 'idle' | 'fetching_link_token' | 'ready' | 'exchanging' | 'storing' | 'error';

export function PlaidLinkButton({ onLinked, onSkip }: PlaidLinkButtonProps): JSX.Element | null {
  const [phase, setPhase] = useState<Phase>('idle');
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Consent gate. Defense in depth — ConsentScreen already enforces.
  // Reads the canonical @ollie/consent state (consent.state row).
  const consentGiven = hasNecessaryConsent(store);
  if (!consentGiven) return null;

  // No-op render if the worker URL is unset (dev environment, no
  // production Plaid yet). The build does not break, but the button
  // is hidden so users don't see a non-functional CTA.
  if (!env.VITE_PLAID_SYNC_WORKER_URL) {
    return null;
  }

  // Fetch link_token from the worker on mount. The token is one-shot
  // and short-lived; we fetch fresh per visit rather than caching.
  useEffect(() => {
    let cancelled = false;
    async function fetchLinkToken(): Promise<void> {
      const account = getAccount();
      const session = account?.auth.state().session ?? null;
      const userId = session?.user_id;
      const jwt = session?.access_token;
      if (!userId || !jwt) {
        setErrMsg('not_signed_in');
        setPhase('error');
        return;
      }
      setPhase('fetching_link_token');
      try {
        const r = await fetch(`${env.VITE_PLAID_SYNC_WORKER_URL}/link/token/create`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({ userId }),
        });
        if (!r.ok) {
          if (!cancelled) {
            setErrMsg(`link_token_fetch_${r.status}`);
            setPhase('error');
          }
          return;
        }
        const body = (await r.json()) as { link_token?: string };
        if (cancelled) return;
        if (!body.link_token) {
          setErrMsg('missing_link_token');
          setPhase('error');
          return;
        }
        setLinkToken(body.link_token);
        setPhase('ready');
      } catch (err) {
        if (cancelled) return;
        console.warn('[PlaidLinkButton] link_token fetch failed', err);
        setErrMsg('link_token_fetch_threw');
        setPhase('error');
      }
    }
    void fetchLinkToken();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── handle successful Plaid Link completion ─────────────────────────
  const handleSuccess = useCallback(
    async (publicToken: string, _metadata: PlaidLinkOnSuccessMetadata) => {
      setPhase('exchanging');
      const account = getAccount();
      const session = account?.auth.state().session ?? null;
      const userId = session?.user_id;
      const jwt = session?.access_token;
      const userKey = account?.auth.encryptionKey() ?? null;
      if (!userId || !jwt || !userKey) {
        setErrMsg('not_signed_in');
        setPhase('error');
        return;
      }

      // 1. Exchange public_token for access_token (worker-side).
      let exchangeResp: { accessToken: string; itemId: string; institutionName: string | null };
      try {
        const r = await fetch(`${env.VITE_PLAID_SYNC_WORKER_URL}/exchange`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({ publicToken, userId }),
        });
        if (!r.ok) {
          setErrMsg(`exchange_${r.status}`);
          setPhase('error');
          return;
        }
        exchangeResp = (await r.json()) as {
          accessToken: string;
          itemId: string;
          institutionName: string | null;
        };
      } catch (err) {
        console.warn('[PlaidLinkButton] exchange failed', err);
        setErrMsg('exchange_threw');
        setPhase('error');
        return;
      }

      // 2. Encrypt the access_token with the user's key BEFORE persisting.
      //    plaintext access_token lives in this scope and is gone the
      //    moment this function returns.
      setPhase('storing');
      let encryptedAccessTokenB64: string;
      let ivB64: string;
      try {
        const enc = await encryptData(userKey, exchangeResp.accessToken);
        encryptedAccessTokenB64 = bytesToBase64(enc.ciphertext);
        ivB64 = bytesToBase64(enc.iv);
      } catch (err) {
        console.error('[PlaidLinkButton] encrypt failed', err);
        setErrMsg('encrypt_failed');
        setPhase('error');
        return;
      }

      // 3. Insert into plaid_items via Supabase REST with the user's
      //    JWT (RLS enforces user_id = auth.uid()).
      if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
        setErrMsg('supabase_not_configured');
        setPhase('error');
        return;
      }
      try {
        const insertResp = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/plaid_items`, {
          method: 'POST',
          headers: {
            apikey: env.VITE_SUPABASE_ANON_KEY,
            authorization: `Bearer ${jwt}`,
            'content-type': 'application/json',
            prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify([
            {
              user_id: userId,
              item_id: exchangeResp.itemId,
              institution_name: exchangeResp.institutionName,
              encrypted_access_token: `\\x${bytesToHex(encryptedAccessTokenB64)}`,
              iv: `\\x${bytesToHex(ivB64)}`,
              status: 'active',
            },
          ]),
        });
        if (!insertResp.ok) {
          console.error('[PlaidLinkButton] plaid_items insert failed', insertResp.status, await insertResp.text());
          setErrMsg(`store_${insertResp.status}`);
          setPhase('error');
          return;
        }
      } catch (err) {
        console.error('[PlaidLinkButton] store failed', err);
        setErrMsg('store_threw');
        setPhase('error');
        return;
      }

      setPhase('idle');
      // notif-scope-allow — confirmation toast, not a push notification.
      onLinked?.(exchangeResp.institutionName);
    },
    [onLinked],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: () => {
      onSkip?.();
    },
  });

  const disabled = phase !== 'ready' || !ready;
  const label = labelForPhase(phase);

  return (
    <div style={{ marginTop: '24px' }}>
      <button
        type="button"
        onClick={() => open()}
        disabled={disabled}
        aria-disabled={disabled}
        style={{
          padding: '14px 24px',
          minHeight: '48px',
          border: '1px solid var(--ink)',
          borderRadius: '24px',
          background: 'transparent',
          color: 'var(--ink)',
          fontFamily: "'DM Mono', monospace",
          fontSize: 'var(--t-caption)',
          letterSpacing: '0.08em',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {label}
      </button>
      <p
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 'var(--t-meta)',
          color: 'var(--ink-faint)',
          marginTop: '12px',
          maxWidth: '40ch',
        }}
      >
        read-only. you can disconnect anytime in settings.
      </p>
      {phase === 'error' && errMsg ? (
        <p
          role="alert"
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 'var(--t-meta)',
            color: 'var(--ink-soft)',
            marginTop: '8px',
          }}
        >
          {humanError(errMsg)}
        </p>
      ) : null}
    </div>
  );
}

function labelForPhase(p: Phase): string {
  switch (p) {
    case 'idle':
    case 'fetching_link_token':
      return 'loading…';
    case 'ready':
      return 'connect a bank account (optional)';
    case 'exchanging':
      return 'connecting…';
    case 'storing':
      return 'saving…';
    case 'error':
      return 'try again';
  }
}

function humanError(code: string): string {
  if (code.startsWith('exchange_')) return 'could not connect. try again or skip.';
  if (code.startsWith('store_')) return 'could not save. try again or skip.';
  if (code === 'encrypt_failed') return 'something went wrong on this device. try again.';
  return 'something went wrong. try again or skip.';
}

// Supabase REST accepts bytea fields as hex strings with `\x` prefix.
// We pass through base64 → hex here so the column can be queried back
// the same way @ollie/sync does for finance_records.
function bytesToHex(b64: string): string {
  const bin = atob(b64);
  let out = '';
  for (let i = 0; i < bin.length; i++) {
    out += bin.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return out;
}
