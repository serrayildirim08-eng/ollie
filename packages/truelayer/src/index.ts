/**
 * @ollie/truelayer · placeholder
 *
 * TrueLayer is the EU/UK sibling of Plaid. Their Open Banking API
 * covers banks Plaid does not reach. Same constitutional rules apply:
 *
 *   - READ-ONLY scope: data / accounts / transactions / balance only.
 *     NO payments, NO sweeps, NO money movement of any kind.
 *   - Access tokens encrypted client-side with @ollie/crypto before
 *     persistence.
 *   - service-role Supabase key only in the worker, never in client.
 *
 * Approval timeline: ~2 weeks, parallel to Plaid production. This
 * package is scaffolded so the directory exists in PRs but is NOT
 * implemented yet. Implementation lands when Serra greenlights EU
 * rollout.
 *
 * See packages/plaid/ for the working sibling.
 */

export const TRUELAYER_SCAFFOLD_VERSION = 0;

// TODO(@ollie/truelayer): port createPlaidClient → createTrueLayerClient
// TODO(@ollie/truelayer): port createLinkToken → TrueLayer auth-link
// TODO(@ollie/truelayer): port normalizePlaidTransaction → TrueLayer
//   transaction normalizer (different sign convention: TrueLayer is
//   credit-positive vs Plaid which is debit-positive)
// TODO(@ollie/truelayer): port webhook verifier (TrueLayer uses HMAC-SHA256
//   over the raw body with a per-tenant secret, NOT JWT like Plaid).
export {};
