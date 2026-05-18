/**
 * @ollie/truelayer · client (stub)
 *
 * Approval pending. Do not implement until Plaid production has
 * shipped and Serra confirms EU rollout. See sibling package
 * @ollie/plaid for the working pattern.
 */

// TODO: env: 'sandbox' | 'production'
// TODO: clientId, secret
export type TrueLayerClientConfig = Record<string, unknown>;

export function createTrueLayerClient(_cfg: TrueLayerClientConfig): never {
  throw new Error('@ollie/truelayer: not implemented (scaffold only). See packages/plaid/.');
}
