/**
 * @ollie/plaid · Link token + public_token exchange
 *
 * Plaid Link flow (vanilla, no OAuth redirects on first pass):
 *
 *   1. server creates a `link_token` for a given user id            (this file)
 *   2. client opens Plaid Link with that token                      (apps/web · PlaidLinkButton.tsx)
 *   3. user picks a bank, logs in, Plaid returns a `public_token`   (client side)
 *   4. server exchanges public_token → access_token + item_id       (this file)
 *   5. access_token is encrypted with the user's key and stored     (apps/web · onSuccess handler)
 *
 * The access_token MUST NEVER round-trip back to the client in plaintext.
 * The exchange happens server-side (CF Worker or trusted server route);
 * the encrypted-at-rest envelope is what crosses back to the client to
 * land in the `plaid_items` row.
 *
 * READ-ONLY enforcement: the products list is sourced from
 * PLAID_READ_ONLY_PRODUCTS in client.ts. Callers cannot override.
 */

import type { PlaidApi, CountryCode } from 'plaid';
import { CountryCode as CountryCodeEnum } from 'plaid';
import { PLAID_READ_ONLY_PRODUCTS } from './client';
import type {
  PlaidAccessToken,
  PlaidItemId,
  PlaidPublicToken,
} from './types';

export interface CreateLinkTokenInput {
  /**
   * Stable, opaque user id. We pass the Supabase auth.uid() — Plaid
   * uses this only for fraud signals; ollie uses it to scope the
   * resulting access_token on our side.
   */
  userId: string;
  /**
   * ISO 3166-1 alpha-2 country codes. ollie ships US + ES first; EU
   * deferred behind TrueLayer sibling pattern. Default ['US'].
   */
  countryCodes?: Array<'US' | 'CA' | 'GB' | 'IE' | 'FR' | 'ES' | 'NL' | 'DE'>;
  /**
   * Locale shown inside Plaid Link's UI. ollie supports en + es —
   * fallback to 'en' for anything else.
   */
  language?: 'en' | 'es';
  /**
   * Optional webhook URL — when set, Plaid will POST transaction
   * update notifications here. In production this is the deployed
   * `workers/plaid-sync` worker URL. Sandbox can pass undefined.
   */
  webhookUrl?: string;
  /**
   * Redirect URI for OAuth banks. Must be pre-whitelisted in the
   * Plaid Dashboard before production. Sandbox can pass undefined.
   */
  redirectUri?: string;
}

export interface LinkTokenResult {
  link_token: string;
  expiration: string;
  request_id: string;
}

/**
 * Create a Plaid Link token for the given user. The token is short-
 * lived (≤ 4 hours) and one-shot — refresh on every onboarding visit
 * rather than caching across sessions.
 */
export async function createLinkToken(
  plaid: PlaidApi,
  input: CreateLinkTokenInput,
): Promise<LinkTokenResult> {
  if (!input.userId) {
    throw new Error('@ollie/plaid · createLinkToken: userId required');
  }
  const countries: CountryCode[] = (input.countryCodes ?? ['US']).map((c) => {
    return CountryCodeEnum[c as keyof typeof CountryCodeEnum];
  });
  const language = input.language === 'es' ? 'es' : 'en';

  const r = await plaid.linkTokenCreate({
    user: { client_user_id: input.userId },
    client_name: 'ollie',
    products: [...PLAID_READ_ONLY_PRODUCTS],
    country_codes: countries,
    language,
    webhook: input.webhookUrl,
    redirect_uri: input.redirectUri,
  });

  return {
    link_token: r.data.link_token,
    expiration: r.data.expiration,
    request_id: r.data.request_id,
  };
}

export interface ExchangePublicTokenResult {
  access_token: PlaidAccessToken;
  item_id: PlaidItemId;
  request_id: string;
}

/**
 * Exchange a one-time public_token (from the client after Plaid Link
 * onSuccess) for a long-lived access_token + item_id. MUST run server-
 * side — the secret used here never reaches the browser.
 *
 * The returned access_token is intended to be encrypted with the
 * user's @ollie/crypto key BEFORE landing on disk or in Supabase. See
 * apps/web/src/components/PlaidLinkButton.tsx for the call site.
 */
export async function exchangePublicToken(
  plaid: PlaidApi,
  publicToken: PlaidPublicToken | string,
): Promise<ExchangePublicTokenResult> {
  if (!publicToken) {
    throw new Error('@ollie/plaid · exchangePublicToken: publicToken required');
  }
  const r = await plaid.itemPublicTokenExchange({
    public_token: String(publicToken),
  });
  return {
    access_token: r.data.access_token as PlaidAccessToken,
    item_id: r.data.item_id as PlaidItemId,
    request_id: r.data.request_id,
  };
}
