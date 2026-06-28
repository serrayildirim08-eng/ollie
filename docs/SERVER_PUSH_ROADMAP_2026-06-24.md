# Server Push & Reminder-Backup (path C) — Roadmap (2026-06-24)

## Goal
Make the **server** able to push Serra proactively: (a) the reminder backup that fires when the app is fully closed / on another device, AND (b) the broader Layer-2 "assistant notices something and pushes you" vision. These all ride the same rails: a row in `scheduled_jobs` (or a cron-detected cue) → `apns-push` worker → APNs → device.

## Why it matters (beyond redundant reminders)
Local reminders already work (on-device OS scheduler). The real prize here is **server-initiated push at all** — today the server can push Serra **nothing**, because there is no registered device. So this track is the gateway to every proactive notification, not just the reminder backup.

## Honest headline blocker (most likely)
`push_tokens` is **empty** in prod. A server push needs a device APNs token. The iOS app most likely has **no push capability** — the audit found the iOS entitlements file is empty (`<dict/>`, no `aps-environment`). No entitlement → iOS never issues a push token → `push_tokens` stays empty → the server can never push anything. **Everything else is downstream of this.**

## The gaps (to be confirmed by the P0 diagnosis workflow)
- **G1 — iOS push capability:** is `aps-environment` in the entitlements + Push Notifications enabled on the Apple Developer App ID + provisioning profile? (Suspected MISSING.)
- **G2 — token registration:** is there code that, on launch, gets the APNs token and writes `push_tokens` (with the Clerk identity)? Is it wired + running? (`push_tokens` empty ⇒ not working.)
- **G3 — reminder write firing:** why does `scheduleServerReminder` → `scheduleServerJob` never POST `scheduled_jobs`? (logs show zero ever.) Is `taskReminder.scheduleAt` even called for a "remind me" dump, or does the bridge silently no-op?
- **G4 — cron → APNs delivery:** does `workers/cron` drain due `scheduled_jobs` and call `apns-push`? Is `apns-push` deployed with valid APNs creds?

## CORRECTED APPROACH (verified 2026-06-24)
The diagnosis workflow assumed `installCapacitorBackend()` — WRONG: apps/native has NO Capacitor (it's Tauri + objc2 local notifications only). Confirmed there is also no native remote-push registration code. BUT a ready-made plugin exists: **`tauri-plugin-mobile-push`** (Tauri v2) — calls `registerForRemoteNotifications()`, injects APNs handlers into the Tao AppDelegate at runtime via ObjC runtime (NO AppDelegate edits, no swizzling), returns the device token as hex. So we do NOT hand-write objc2. Sending side is already built: `/register-token` (apps/api/src/worker.ts:296 → push_tokens), `apns-push` worker (needs APNS_AUTH_KEY/.p8 + KEY_ID/TEAM_ID/BUNDLE_ID=app.ollie.ollie set as secrets), and push_tokens RLS is correct post-identity-migration.

## Phases
- **P1 — Apple groundwork (SERRA, hard blocker, nothing testable without it):** in Apple Developer portal: (a) enable **Push Notifications** capability on App ID `app.ollie.ollie`; (b) create an **APNs Auth Key (.p8)** → note the Key ID + Team ID. In Xcode: add the Push Notifications capability (writes `aps-environment` to the entitlement).
- **P2 — add the plugin + wire token upload (CODE, me, isolated worktree):** add `tauri-plugin-mobile-push` (Cargo + JS); on token-received, POST to the existing `/register-token` worker endpoint with the Clerk bearer. *Done = a row appears in `push_tokens`.* (Vet the third-party plugin first — it injects ObjC at runtime; check maintenance/source.)
- **P3 — configure APNs secrets (Serra provides .p8, me/her set):** set APNS_AUTH_KEY/KEY_ID/TEAM_ID/BUNDLE_ID on the apns-push + apps/api workers.
- **P4 — reminder write + cron→APNs (verify):** confirm a timed reminder writes `scheduled_jobs` (also finally PROVES today's identity/RLS path) and that cron drains it → `apns-push` → device.
- **P5 — end-to-end:** set a reminder, fully close the app → push arrives.

Dependency order: **P1 (Serra) unblocks everything** — code (P2) can be written in parallel but is untestable until P1 + P3.

## Done-definition (path C)
1. A device token row exists in `push_tokens` for Serra.
2. Creating a timed reminder writes a `scheduled_jobs` row (Clerk id, RLS-allowed).
3. With the app fully closed, the reminder fires as an APNs push on her phone.
4. (Bonus) the same rails are confirmed usable for a Layer-2 server cue.

## Collision note
P2/P3 may touch `apps/native` files; some live in the active olive-neumorphic redesign hot zone. Any app-code change runs in an **isolated git worktree** + branch, reviewed before merge — never directly in `~/ollie`.

## Cost/benefit framing (for the bigger #1 decision this feeds)
This track only delivers value if the app should do **server-initiated push**. If Ollie stays single-device with on-device reminders only, P1–P5 are optional. They become necessary the moment we want proactive push / cross-device / the watcher-offer vision.
