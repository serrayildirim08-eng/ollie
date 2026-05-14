# @ollie/worker-sentry-tunnel

Cloudflare Worker that forwards Sentry SDK envelopes from the app to
Sentry's ingest endpoint. Built because Turkish ISP DPI blocks TLS
to `*.sentry.io`; Cloudflare's `*.workers.dev` hostnames are not
blocked, and the worker itself reaches Sentry from Cloudflare edge
without any ISP-level filtering.

The same hop also helps beta users behind restrictive corporate
networks or other DPI regimes.

## How it works

1. App's Sentry SDK is configured with `tunnel: <worker_url>` instead
   of sending events directly to `*.sentry.io`.
2. SDK POSTs an envelope (line-delimited JSON) whose first line
   declares the project DSN.
3. Worker parses the DSN, validates it against an allow-list, and
   proxies the raw body to `https://${SENTRY_HOST}/api/${projectId}/envelope/`.
4. Worker returns Sentry's response status to the SDK.

## Deploy

```bash
cd workers/sentry-tunnel
pnpm install
wrangler login          # one-time per machine
wrangler deploy
```

Wrangler will print the worker URL, e.g.:
```
https://ollie-sentry-tunnel.<your-cf-subdomain>.workers.dev
```

Paste it into `.env.local` at the repo root:
```
VITE_SENTRY_TUNNEL_URL=https://ollie-sentry-tunnel.xxx.workers.dev
```

Rebuild apps/web (`pnpm build`) — Vite bakes the env into the bundle.

## No secrets

The worker doesn't need any `wrangler secret put` calls. The SDK
envelope embeds its own DSN, which the worker validates against
the hard-coded allow-list in `src/index.ts`. This avoids leaking
the DSN as a CF secret and keeps the worker stateless.

## Updating the allowed project

If the Sentry project changes (new DSN), update both:
- `SENTRY_HOST` (the `oNNN.ingest.us.sentry.io` host segment)
- `ALLOWED_PROJECT_IDS` (the numeric project id after `/`)

in `src/index.ts`, then redeploy.
