# @ollie/plaid

Read-only Plaid integration for ollie's finance module. Sandbox-functional
today; production keys pending (see `PRODUCTION_CHECKLIST.md`).

## Surface

- `createPlaidClient(cfg)` — env-switched `PlaidApi` factory.
- `createLinkToken(plaid, input)` — `/link/token/create` wrapper.
- `exchangePublicToken(plaid, publicToken)` — `/item/public_token/exchange`.
- `fetchTransactions(plaid, input)` — bounded-window pull (smoke + tests).
- `syncTransactionsCursor(plaid, input)` — cursor-based incremental pull
  (used by the worker).
- `normalizePlaidTransaction(t, itemId)` — Plaid `Transaction` → ollie's
  `FinanceRecord`-shaped row.
- `verifyWebhook(opts)` — ES256 JWT verification per Plaid spec.
- `routeWebhook(event)` — pure event → action mapping.

## Read-only invariant

`PLAID_READ_ONLY_PRODUCTS` in `src/client.ts` is the single source of
truth for the products list. It is frozen at module load. Adding to it
requires a senior review and an updated PRODUCTION_CHECKLIST.

## Tests

```
pnpm -F @ollie/plaid test
```

## Sandbox smoke

```
PLAID_CLIENT_ID=... PLAID_SECRET=... pnpm -F @ollie/plaid smoke
```

Test user credentials in Plaid's sandbox UI: `user_good` / `pass_good`.

## Where the access_token lives

```
Plaid Link UI (browser, ephemeral)
        ↓ onSuccess → public_token (one-shot, ≤30 min lifetime)
apps/web · PlaidLinkButton onSuccess handler
        ↓ POSTs public_token to workers/plaid-sync /exchange
workers/plaid-sync · exchange route
        ↓ calls exchangePublicToken() server-side
        ↓ gets access_token + item_id
        ↓ returns them to the client BUT wrapped via the client's
          @ollie/crypto encryptData() before persisting
apps/web · PlaidLinkButton encrypts + inserts plaid_items row
        ↓ encrypted_access_token (bytea) + iv (bytea)
Supabase · plaid_items table (RLS-gated)
```

The plaintext `access_token` is touched only in:
- worker memory during `/exchange` (request-scoped)
- client memory during the encrypt step (request-scoped)

It is never logged, never serialized to disk plaintext, never returned
to the client outside the encrypt-here-then-store envelope.
