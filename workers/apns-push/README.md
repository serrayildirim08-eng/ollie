# ollie · apns-push worker

Cloudflare Worker that signs Apple JWTs and forwards push payloads to
`api.push.apple.com`. The p8 key never leaves Cloudflare.

## Endpoint

```
POST /push
Content-Type: application/json

{
  "deviceToken": "abcd...",        // hex APNs device token
  "payload":     { "aps": { ... } },
  "userId":      "uuid",           // optional · used for rate-limit key
  "topic":       "app.ollie.ollie" // optional · defaults to APPLE_BUNDLE_ID
}
```

Rate-limit: 5 req/sec per `userId` (or per device token if userId omitted).
Returns 429 when exceeded.

## Secrets to set with `wrangler secret put`

```
wrangler secret put APPLE_AUTH_KEY    # paste full p8 PEM contents
wrangler secret put APPLE_KEY_ID      # 10-char Key ID
wrangler secret put APPLE_TEAM_ID     # 10-char Team ID
wrangler secret put APPLE_BUNDLE_ID   # app.ollie.ollie
```

## Bindings

Run once before first deploy:

```
wrangler kv:namespace create RATE_KV
```

Paste the returned id into `wrangler.toml` under `[[kv_namespaces]] id`.

## Deploy

```
pnpm install
pnpm deploy
```

The deployed URL goes into the app's `.env.local` as `VITE_APNS_WORKER_URL`.

## Local dev

```
pnpm dev
```

(Note: `wrangler dev` needs `wrangler login` first if you want a real
public preview. Otherwise it runs against a local miniflare.)
