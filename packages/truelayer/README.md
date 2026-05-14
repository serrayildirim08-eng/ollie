# @ollie/truelayer · scaffold

EU/UK Open Banking sibling of `@ollie/plaid`. Directory exists so the
build graph stays stable; implementation is **not started**.

## When to implement

1. Plaid production keys received + integration shipped + smoke-tested
   in real production traffic for ≥ 2 weeks.
2. EU/UK user demand confirmed via beta feedback.
3. TrueLayer production keys received (apply at https://console.truelayer.com/).
4. Serra greenlights the EU rollout.

## Parallel pattern

Mirror `@ollie/plaid` exactly:

- `client.ts` — `createTrueLayerClient(cfg)` env-switched factory
- `link.ts` — TrueLayer auth-link helper (their equivalent of Link)
- `transactions.ts` — `fetchTransactions`, `normalizeTrueLayerTransaction`
- `webhook.ts` — HMAC-SHA256 verification (NOT JWT like Plaid)
- `types.ts` — narrow types, do NOT pull whole `truelayer-client` types
- `PRODUCTION_CHECKLIST.md` — TrueLayer-side rotation/dashboard list

## Differences from Plaid (gotchas)

- **Sign convention**: TrueLayer is credit-positive (positive = money
  IN). Plaid is debit-positive. The normalizer's direction logic flips.
- **Webhook auth**: HMAC-SHA256 over raw body with a per-tenant signing
  secret in headers. No JWT.
- **OAuth-first**: TrueLayer is OAuth from the start; users always go
  to their bank's login page. Plaid has institution-direct flows for
  US banks that don't require OAuth.
- **Scopes**: TrueLayer scopes are granular (`info`, `accounts`,
  `transactions`, `balance`, `direct_debits`, `standing_orders`).
  Request ONLY `info`, `accounts`, `transactions`, `balance`. Never
  `payments` or anything that moves money.

## Why we ship the scaffold now

Keeping the package in the workspace forces us to plan for it during
the Plaid integration (e.g. the FinanceRecord normalizer in
`@ollie/plaid` should map cleanly to a TrueLayer normalizer that
produces the same shape). When implementation starts the structural
work is already done.
