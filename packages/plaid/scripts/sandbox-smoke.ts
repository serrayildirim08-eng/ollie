#!/usr/bin/env tsx
/**
 * @ollie/plaid · sandbox smoke test
 *
 * Runs the full Plaid sandbox flow end-to-end against real Plaid
 * infrastructure. No mocks, no fakes — this is the script Serra runs
 * after pasting sandbox credentials into .env.local to confirm:
 *
 *   1. PLAID_CLIENT_ID + PLAID_SECRET are valid
 *   2. /link/token/create works with our read-only product list
 *   3. /sandbox/public_token/create bypasses the UI for testing
 *   4. /item/public_token/exchange returns an access_token
 *   5. /transactions/get returns a non-empty result
 *   6. our normalizer produces well-shaped FinanceRecord-ish rows
 *
 * Usage:
 *   PLAID_CLIENT_ID=... PLAID_SECRET=... pnpm -F @ollie/plaid smoke
 *
 * NEVER commit your sandbox secret. The .env.local file is gitignored.
 *
 * Sandbox credentials for the institution login step (when running the
 * full UI flow via PlaidLinkButton):
 *   username: user_good
 *   password: pass_good
 */

import { createPlaidClient, PLAID_READ_ONLY_PRODUCTS } from '../src/client';
import { fetchTransactions } from '../src/transactions';
import { Products } from 'plaid';

async function main(): Promise<void> {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    console.error('missing PLAID_CLIENT_ID or PLAID_SECRET in env');
    console.error('grab sandbox values from https://dashboard.plaid.com/team/keys');
    process.exit(1);
  }

  const plaid = createPlaidClient({ env: 'sandbox', clientId, secret });

  console.log('[1/5] creating link token...');
  const linkResp = await plaid.linkTokenCreate({
    user: { client_user_id: 'ollie_sandbox_smoke_user' },
    client_name: 'ollie',
    products: [...PLAID_READ_ONLY_PRODUCTS],
    country_codes: ['US'] as never,
    language: 'en',
  });
  console.log(`      link_token (truncated): ${linkResp.data.link_token.slice(0, 24)}...`);

  console.log('[2/5] creating sandbox public_token (bypassing Link UI)...');
  const sandboxResp = await plaid.sandboxPublicTokenCreate({
    institution_id: 'ins_109508',
    initial_products: [Products.Transactions],
  });
  const publicToken = sandboxResp.data.public_token;
  console.log(`      public_token (truncated): ${publicToken.slice(0, 24)}...`);

  console.log('[3/5] exchanging public_token for access_token...');
  const exchResp = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  const accessToken = exchResp.data.access_token;
  const itemId = exchResp.data.item_id;
  console.log(`      access_token (REDACTED), item_id=${itemId}`);

  console.log('[4/5] fetching transactions (this may take ~10s while Plaid generates fixtures)...');
  // Plaid sandbox needs a moment to produce transactions after the
  // item is created. Poll up to 30s.
  const start = Date.now();
  let result = null as Awaited<ReturnType<typeof fetchTransactions>> | null;
  let lastErr: unknown = null;
  while (Date.now() - start < 30_000) {
    try {
      result = await fetchTransactions(plaid, { accessToken });
      if (result.transactions.length > 0) break;
    } catch (err) {
      lastErr = err;
      // PRODUCT_NOT_READY → wait + retry
    }
    await sleep(2000);
  }
  if (!result || result.transactions.length === 0) {
    console.error('no transactions came back from sandbox');
    if (lastErr) console.error('last error:', lastErr);
    process.exit(2);
  }
  console.log(`      got ${result.transactions.length} transactions (raw_count=${result.raw_count})`);

  console.log('[5/5] sample normalized row:');
  const first = result.transactions[0];
  console.log({
    id: first.id,
    event_date: first.event_date,
    amount: first.amount,
    currency: first.currency,
    direction: first.direction,
    merchant: first.merchant,
    merchant_normalized: first.merchant_normalized,
    category: first.category,
    source: first.source,
  });

  console.log('\nsmoke OK · sandbox round trip succeeded.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

main().catch((err) => {
  console.error('smoke FAILED:', err);
  process.exit(1);
});
