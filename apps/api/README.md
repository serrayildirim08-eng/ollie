# @ollie/api-worker — Cloudflare Worker for APNs

Two endpoints:

- `POST /register-token` — iOS client posts its APNs device token after
  Capacitor PushNotifications fires the `registration` listener.
- `POST /send` — server-side trigger that pushes a `NotificationSpec`
  to one or more device tokens via APNs (ES256-signed JWT).

## Setup (Serra one-time, ~15 min)

1. **Apple Developer Portal** → Certificates, Identifiers & Profiles → Keys → `+`
   - "Apple Push Notifications service (APNs)" → Continue → Register
   - Download `AuthKey_<KEY_ID>.p8` (one-time download)
   - Note the **Key ID** (10 chars) shown next to the file — never displayed again
2. **Membership page** → note the **Team ID** (10 chars)
3. **App ID config** for `app.ollie.ollie` → enable **Push Notifications** capability
4. Install wrangler if not already: `pnpm dlx wrangler login`
5. Create the KV namespace:
   ```sh
   pnpm dlx wrangler kv:namespace create DEVICE_TOKENS
   ```
   paste the returned `id` into `wrangler.toml` (replacing the placeholder).
6. Set secrets:
   ```sh
   pnpm dlx wrangler secret put APNS_KEY_ID         # the 10-char key id
   pnpm dlx wrangler secret put APNS_TEAM_ID        # the 10-char team id
   pnpm dlx wrangler secret put APNS_BUNDLE_ID      # app.ollie.ollie
   pnpm dlx wrangler secret put APNS_AUTH_KEY       # paste the .p8 file contents (BEGIN to END)
   pnpm dlx wrangler secret put REGISTER_SHARED_SECRET   # a long random string
   ```
7. Deploy:
   ```sh
   pnpm dlx wrangler deploy
   ```
8. iOS app config (`apps/web/src/lib/push-register.ts`):
   - Set `PUSH_REGISTER_ENDPOINT` to your worker URL + `/register-token`
   - Set `PUSH_REGISTER_AUTH` to `REGISTER_SHARED_SECRET`

## Smoke test

```sh
curl -X POST https://ollie-notifications.<your-subdomain>.workers.dev/send \
  -H "authorization: Bearer $REGISTER_SHARED_SECRET" \
  -H "content-type: application/json" \
  -d '{
    "tokens": ["<your-device-apns-token-from-Xcode-console>"],
    "spec": {
      "title": "rent due in 3 days",
      "body": "just saying.",
      "category": "REMINDER",
      "dedupe_key": "test-1"
    }
  }'
```

Should return `{ "ok": true, "delivered": 1, "total": 1, ... }` and the
device should receive a native APNs push within ~2s.
