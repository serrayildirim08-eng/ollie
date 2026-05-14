# @ollie/plaid · production cutover checklist

Status: **SANDBOX**. Production keys not yet issued. Estimated approval
window: ~2 weeks from application submission.

This checklist must be completed in order. Each step that touches a
secret or a URL is one-way — verify twice before flipping.

---

## 1. Plaid Dashboard prep

- [ ] Apply for Plaid production access at https://dashboard.plaid.com/overview/production
- [ ] Choose the **Limited Production** plan if available (free up to a
      cap, sufficient for beta) — otherwise standard production tier.
- [ ] Submit the company / compliance questionnaire. Requires:
  - Privacy Policy URL (must be live at submission time)
  - Terms of Service URL
  - Stated data-retention policy
  - Statement that ollie uses transactions + auth + identity only
  - Statement that ollie does NOT request transfer / payment_initiation / signal
- [ ] Wait for approval email. Plaid typically responds within
      5–10 business days but can stretch to 2 weeks.

## 2. Pre-deploy configuration

Once production keys are issued:

- [ ] Add **production redirect URI** in Plaid Dashboard:
      `https://ollie-app.com/onboarding/bank-link/return`
      _(blocker · Serra: confirm final production domain. Until then,
      keep this as a placeholder string in the worker .env so the
      switch is mechanical.)_
- [ ] Register **webhook URL** in Plaid Dashboard:
      `https://ollie-plaid-sync.<workers-subdomain>.workers.dev/webhook`
      (or the custom domain bound to the worker)
- [ ] Whitelist any **OAuth bank domains** that ollie will support on
      first launch (BofA, Chase, Wells Fargo, Citi, Capital One). Each
      bank is its own allowlist entry in the dashboard.
- [ ] Confirm **Privacy Policy + Terms of Service** are reachable from
      the ConsentScreen and from the marketing site footer.

## 3. Secret rotation

- [ ] In Cloudflare Workers (`workers/plaid-sync`):
  - `wrangler secret put PLAID_CLIENT_ID` (production value)
  - `wrangler secret put PLAID_SECRET` (production value)
  - `wrangler secret put PLAID_WEBHOOK_VERIFICATION_AUDIENCE` (optional;
    advanced JWT validation if Plaid enables it for our account)
  - `wrangler secret put SUPABASE_SERVICE_ROLE` (already set; verify
    it's the PROD project's service-role, not staging)
  - `wrangler secret put PLAID_INBOX_ENCRYPTION_KEY` (32-byte base64;
    generated locally + stored only here — see worker README)
- [ ] In `wrangler.toml`, flip:
  ```toml
  [vars]
  PLAID_ENV = "production"   # was "sandbox"
  ```
- [ ] In `apps/web/src/components/PlaidLinkButton.tsx`, no client-side
      change required (Link token comes from the worker, env-switched
      there).

## 4. Database

- [ ] Confirm `plaid_items` and `plaid_inbox` migrations are applied to
      the production Supabase project. Run `supabase db diff` to verify
      no drift.
- [ ] Run a 1-row RLS smoke test:
  ```sql
  set role authenticated;
  select set_config('request.jwt.claims', '{"sub":"<not-your-uid>"}', true);
  select count(*) from plaid_items;   -- expect 0 (RLS blocks)
  reset role;
  ```

## 5. Deploy

- [ ] `pnpm -F @ollie/worker-plaid-sync deploy`
- [ ] Hit `/health` on the deployed worker — expect `{ ok: true, env: "production" }`
- [ ] Trigger a synthetic webhook from Plaid Dashboard to confirm
      signature verification works in production.

## 6. Monitor for 48 hours

- [ ] Watch worker logs for `verified=false` rejections (forged or
      replayed webhooks). Spike = investigate.
- [ ] Watch `plaid_inbox` row count — should drain within minutes of
      arriving (clients pull + ack on next session).
- [ ] Watch Sentry for `plaid:exchange_failed`, `plaid:sync_failed`,
      `plaid:decrypt_failed`.

---

## Permanent constraints (do not relax)

- READ-ONLY product list is locked in `packages/plaid/src/client.ts`
  as `PLAID_READ_ONLY_PRODUCTS`. Adding `Transfer` or any money-moving
  product requires:
  1. senior-engineer + Serra sign-off
  2. legal review (we're in B2C health-adjacent territory)
  3. an updated Privacy Policy + Terms of Service
  4. a fresh Plaid product approval cycle

- access_tokens are NEVER stored plaintext. The encryption happens
  via `@ollie/crypto` with the user's derived key BEFORE the row
  hits `plaid_items.encrypted_access_token`. Audit trail: see the
  flow comment at the top of `apps/web/src/components/PlaidLinkButton.tsx`.

- Supabase service-role key lives ONLY in
  `workers/plaid-sync/wrangler.toml` secrets. Never in the client
  bundle. Never in `packages/plaid/*`.

- Consent gate: the PlaidLinkButton renders only when
  `shared.consent.necessary === true`. Defense in depth — the
  ConsentScreen already enforces this, but the button double-checks.
