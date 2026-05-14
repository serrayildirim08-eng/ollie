/**
 * @ollie/plaid · client wrapper
 *
 * Thin factory around Plaid's official Node SDK. Forces the env (sandbox
 * vs. production) to come from a single typed input so:
 *
 *   - tests cannot accidentally hit production
 *   - the Worker that picks up real webhooks reads PLAID_ENV at boot,
 *     not from process-env-string-comparison sprinkled around the code
 *
 * READ-ONLY HARD GATE:
 *   The exported PLAID_READ_ONLY_PRODUCTS list is what every link-token
 *   request must pass. We do NOT expose a "products" parameter — callers
 *   cannot opt into transfer / payment_initiation / signal.
 */

import { Configuration, PlaidApi, PlaidEnvironments, Products } from 'plaid';

/**
 * The ONLY products ollie ever requests. Adding to this list requires:
 *   1. a senior-engineer review
 *   2. an updated PRODUCTION_CHECKLIST.md
 *   3. explicit confirmation that the new product is read-only
 *
 * Banned in perpetuity: TRANSFER, PAYMENT_INITIATION, SIGNAL.
 */
export const PLAID_READ_ONLY_PRODUCTS: ReadonlyArray<Products> = Object.freeze([
  Products.Transactions,
  Products.Auth,
  Products.Identity,
]);

export type PlaidEnvName = 'sandbox' | 'development' | 'production';

export interface PlaidClientConfig {
  env: PlaidEnvName;
  clientId: string;
  secret: string;
  /** Plaid API version pin. */
  version?: '2020-09-14';
}

/**
 * Build a configured PlaidApi instance. Caller owns its lifecycle —
 * for Workers, build once per request; for long-running Node, build
 * once at boot.
 */
export function createPlaidClient(cfg: PlaidClientConfig): PlaidApi {
  if (!cfg.clientId) {
    throw new Error('@ollie/plaid: clientId is required');
  }
  if (!cfg.secret) {
    throw new Error('@ollie/plaid: secret is required');
  }
  const basePath = pickBasePath(cfg.env);
  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': cfg.clientId,
        'PLAID-SECRET': cfg.secret,
        'Plaid-Version': cfg.version ?? '2020-09-14',
      },
    },
  });
  return new PlaidApi(configuration);
}

function pickBasePath(env: PlaidEnvName): string {
  switch (env) {
    case 'sandbox':
      return PlaidEnvironments.sandbox;
    case 'development':
      // Development env is sunset by Plaid for new accounts as of 2024 —
      // we keep it routable but the README + CHECKLIST steer to sandbox
      // for testing and production for live data.
      return PlaidEnvironments.development;
    case 'production':
      return PlaidEnvironments.production;
    default: {
      const _exhaustive: never = env;
      throw new Error(`@ollie/plaid: unknown env ${String(_exhaustive)}`);
    }
  }
}
