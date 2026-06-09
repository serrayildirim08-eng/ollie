# Reminder push — remaining native work (app-closed delivery)

_Last updated: 2026-05-30_

## What already works after this commit

Time-deferred reminders ("remind me to call mama in 1 minute", "take my
zoloft in 30 min") now schedule **two ways** for the same fire time, both
keyed on a stable `dedupe_key` (`reminder:<taskId>`) so they can never
double-fire:

1. **Client timer** — `scheduleAt()` in `apps/native/src/notify/systemNotify.ts`
   arms an in-process `setTimeout`. Fires correctly while the app is open or
   minimised, identically on macOS desktop + iPhone. Dies on app QUIT (and
   iOS freezes JS timers when backgrounded).

2. **Server job (durable, app-closed)** — the reminder handlers
   (`apps/native/src/modules/admin/handler.ts`,
   `apps/native/src/modules/work/handler.ts`) also call
   `scheduleServerReminder(spec, fireAt)` via the injectable seam in
   `apps/native/src/notify/serverReminder.ts`. The real implementation is
   installed by `useServerReminderBridge()`
   (`apps/native/src/notify/serverReminderBridge.ts`, mounted in
   `navigation/Router.tsx` under `<SignedIn>`). It resolves
   `{ api, authJwt, userId, budget }` from Clerk + the native env + the
   encrypted store and calls `scheduleServerJob()`
   (`packages/notifications/src/server-schedule.ts`), which writes a
   Supabase `scheduled_jobs` row. The 5-min cron
   (`workers/cron/src/flush-notifications.ts`) drains pending rows, looks up
   the user's device tokens in the `push_tokens` table, and POSTs each to
   `workers/apns-push`.

This entire server path is **wired and live the moment a device push token
exists in `push_tokens` for the signed-in user.**

## The one remaining gap: native device-token registration

The Tauri shell (`apps/native`) registers **no APNs / push token on either
platform** today. The only code that writes `push_tokens` is the Capacitor
backend (`packages/notifications/src/backends/capacitor.ts`), which the
Tauri shell does not use. So `scheduledJobs` rows are written but the cron's
`tokensForUser()` JOIN finds nothing → no push is delivered. Closing this
gap is native (Rust/Swift/entitlement) work that cannot be done in TS.

### Where the token must be POSTed (reuse the existing endpoint)

`apps/api/src/worker.ts` already exposes `POST /register-token`
(`VITE_APNS_PUSH_URL` is wired in `apps/native/.env.example` as
`https://ollie-apns.ollieapp.workers.dev` — **confirm the register route is
on that same worker/host**). It:

- authenticates with `Authorization: Bearer <REGISTER_SHARED_SECRET>`;
- accepts JSON `{ token, platform: 'ios' | 'macos', device_id?, user_id? }`;
- writes KV **and**, when `user_id` is present, mirrors into the Postgres
  `push_tokens` table (`device_token` unique, idempotent rebind).

So the native shell just needs to capture its OS push token and POST it to
that endpoint with the **Clerk `user_id`** (the same id
`useServerReminderBridge` uses) so the cron JOIN matches. Re-POST on
sign-in (token may arrive before auth) — mirror the Capacitor backend's
`postRegistration()` / `auth:signed_in` re-POST logic.

> NOTE / DECISION FOR SERRA: the register endpoint is gated on a shared
> secret (`REGISTER_SHARED_SECRET`), not the user JWT. The Capacitor backend
> takes it as `pushRegisterAuth`. The Tauri client will need that secret at
> build time (Vite env) OR — cleaner — the register route should be changed
> to verify the Clerk JWT instead of a shared secret so we don't ship a
> static secret in the desktop/iOS bundle. **Recommend the JWT path.**

### iPhone (Tauri iOS)

- Add the **Push Notifications** capability + APNs entitlement to the iOS
  target (Apple Developer account is approved per memory).
- Register for remote notifications at app launch
  (`UIApplication.registerForRemoteNotifications()`), capture the device
  token in `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
- Bridge the token from Swift → JS (a Tauri command / plugin) OR POST it to
  `/register-token` directly from the Rust/Swift layer with
  `platform: 'ios'` + the current Clerk `user_id`.
- The APNs push worker (`workers/apns-push`) already signs + sends to APNs.

### macOS (Tauri desktop)

- macOS push requires the **APNs entitlement** (`aps-environment`) and the
  app to be **signed with a provisioning profile** that includes the Push
  Notifications capability (this is the part that needs an Apple paid
  membership + a configured App ID — confirm the desktop bundle id is
  registered for push).
- Register via `NSApplication.registerForRemoteNotifications()`, capture the
  token in `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`,
  POST with `platform: 'macos'` + Clerk `user_id`.
- Tauri exposes this through a small Rust plugin or a native macOS shim;
  there is no first-party Tauri plugin for remote APNs today, so this is a
  custom `tauri::plugin` wrapping the AppKit calls.

> DECISION FOR SERRA: macOS remote push is genuinely heavier than iOS (code
> signing + provisioning + a custom Rust/AppKit plugin). If desktop
> app-closed delivery is lower priority than iPhone, the client `setTimeout`
> already covers desktop while the app is open/minimised — the durable macOS
> push could be a fast-follow. **Confirm whether macOS app-closed push is a
> launch blocker or a fast-follow.**

## Verification once tokens land

1. Sign in on a real device, grant push permission, confirm a row appears in
   `push_tokens` (correct `user_id`, `device_token`, `platform`).
2. Dump "remind me to test push in 2 minutes", fully quit the app.
3. Confirm the APNs push arrives ~2 min later (cron runs every 5 min, so
   allow up to ~7 min worst case).
4. Re-open the app within the window and confirm the client timer's fire and
   the push do **not** both display — `dedupe_key` (`reminder:<taskId>`)
   must suppress the duplicate.
