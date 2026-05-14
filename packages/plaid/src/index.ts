/**
 * @ollie/plaid · public surface
 *
 * Read-only bank-data integration for ollie's finance module. Wraps
 * Plaid's Node SDK with a narrow set of helpers that:
 *
 *   1. create Link tokens (sandbox + production env-switched)
 *   2. exchange a public_token for an access_token (server-side only)
 *   3. fetch transactions and normalize them to ollie's FinanceRecord shape
 *   4. verify + route incoming Plaid webhooks
 *
 * Constitutional rules (locked):
 *   - READ-ONLY products only: transactions + auth + identity. NEVER
 *     request transfer / payment_initiation / signal — those move money.
 *   - access_token MUST be encrypted via @ollie/crypto with the user's
 *     key before being persisted. The token never lives in plaintext
 *     at rest. See PRODUCTION_CHECKLIST.md.
 *   - service-role Supabase key lives ONLY in the workers/plaid-sync
 *     Worker env. Never imported from this package.
 */

export {
  createPlaidClient,
  PLAID_READ_ONLY_PRODUCTS,
  type PlaidEnvName,
  type PlaidClientConfig,
} from './client';

export {
  createLinkToken,
  exchangePublicToken,
  type CreateLinkTokenInput,
  type LinkTokenResult,
  type ExchangePublicTokenResult,
} from './link';

export {
  fetchTransactions,
  normalizePlaidTransaction,
  syncTransactionsCursor,
  type FetchTransactionsInput,
  type FetchTransactionsResult,
  type PlaidTransaction,
} from './transactions';

export {
  verifyWebhook,
  routeWebhook,
  type PlaidWebhookEvent,
  type WebhookVerificationResult,
  type WebhookRouterResult,
} from './webhook';

export type {
  PlaidAccessToken,
  PlaidItemId,
  PlaidPublicToken,
  PlaidNormalizedTransaction,
} from './types';
