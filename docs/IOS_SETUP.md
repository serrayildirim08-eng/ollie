# Getting Ollie onto your iPhone — a setup runbook

_Last updated: 2026-05-30_

This is the step-by-step guide for running the Ollie native app (`apps/native`,
a Tauri v2 app) on iOS — first in the **Simulator** (zero Apple account), then on
**your real iPhone** with a **free** Apple ID, and finally what the **paid**
$99/yr program unlocks later.

**ELI5 of the whole thing:** an iPhone will only run an app if Apple has
"stamped" it (this is _code signing_). The Simulator runs on your Mac and needs
no stamp at all. Your real phone needs a stamp, but Apple gives you a free
7-day stamp just for having an Apple ID. The $99/yr program gives you a 1-year
stamp plus TestFlight (the way you hand the app to other testers). You do **not**
need the $99 program yet.

### Assumptions / things already true on your Mac
- Xcode 26.5 installed and opened at least once (so its command-line tools are active)
- CocoaPods 1.16.2 (`pod --version`)
- tauri-cli 2.11.2, Rust toolchain
- The iOS Rust targets and `tauri ios init` have already been run, so the
  generated Xcode project exists at `apps/native/src-tauri/gen/apple/`
- The app's bundle identifier is **`com.ollie.app`** (from `tauri.conf.json`)

All commands below assume you run them from the repo root (`~/ollie`). The
`pnpm --filter native exec tauri …` form runs the repo's pinned tauri-cli, so
you don't depend on a global install.

---

## 1. Run in the iOS Simulator (no Apple account needed)

This is the **"see it today"** path. The Simulator is a fake iPhone running on
your Mac. **No Apple Developer enrollment, no Apple ID, no signing.** If you
just want to look at Ollie on an iPhone-shaped screen, do this.

### Steps

1. Make sure a Simulator runtime exists. Xcode 26.5 ships one, but confirm:
   ```bash
   xcrun simctl list devices available | grep iPhone
   ```
   You should see entries like `iPhone 16 Pro`. If the list is empty, open
   Xcode → Settings → Components and install an iOS Simulator runtime.

2. Launch the app on a Simulator:
   ```bash
   pnpm --filter native exec tauri ios dev
   ```
   With **no device plugged in**, Tauri falls back to letting you **pick a
   Simulator** from a list — use the arrow keys, hit Enter.

3. To skip the picker and name a Simulator directly:
   ```bash
   pnpm --filter native exec tauri ios dev 'iPhone 16 Pro'
   ```
   (Use a name that appeared in the `simctl list` output above.)

### What to expect
- The first run is slow: it compiles the Rust core for the iOS Simulator
  target and bundles the web frontend. Later runs are much faster.
- The Simulator window opens automatically and Ollie boots inside it.
- Hot-reload works like the desktop dev server — edit frontend code and it
  refreshes in the Simulator.
- Leave the terminal command **running**. Killing it stops the dev session.

> Caveat: the Simulator is great for UI, but some hardware-ish things behave
> differently than a real phone (notification timing, biometrics, etc.). For
> anything notification-related, test on the real device (Section 2).

---

## 2. Run on your own physical iPhone with a FREE Apple ID

Apple lets anyone with a plain Apple ID (the one you use for iCloud / the App
Store — **no $99 needed**) sign an app onto **their own** devices using a
**Personal Team**. The catch: the signature **expires after 7 days**, so you
re-install weekly. Perfect for dogfooding Ollie on your own phone.

### One-time setup in Xcode

1. Plug your iPhone into the Mac with a cable. On the iPhone, tap **Trust** if
   it asks whether to trust this computer. (First time only, you may also need
   to enable **Developer Mode**: iPhone → Settings → Privacy & Security →
   Developer Mode → on → restart.)

2. Open the generated Xcode project:
   ```bash
   open apps/native/src-tauri/gen/apple/*.xcodeproj
   ```
   (Tauri generates the Xcode project here during `tauri ios init`. You can also
   run `pnpm --filter native exec tauri ios dev --open` to have Tauri open it
   for you — but if you use `--open`, **leave the terminal running**, it must
   stay alive.)

3. In Xcode's left sidebar, click the **blue project icon** at the top → select
   the app **target** → open the **Signing & Capabilities** tab.

4. Check **"Automatically manage signing."**

5. In the **Team** dropdown, choose your Apple ID. If it's not listed:
   - Click **Add an Account…**, sign in with your normal Apple ID.
   - Your free team appears as **"Your Name (Personal Team)."** Select it.

6. Xcode will now generate a free provisioning profile for `com.ollie.app`
   targeting your specific iPhone. If you see a red error like _"Failed to
   register bundle identifier,"_ it usually means the ID is taken on Apple's
   side; the quick fix is to temporarily tweak the bundle id in Xcode (e.g.
   `com.ollie.app.serra`) just for local free-signing — **don't commit that
   change**. (See Section 4 for where the real id lives.)

### Launch it

- Easiest: with the project open in Xcode and your iPhone selected as the run
  destination (top toolbar device dropdown), press the **▶ Run** button.
- Or from the CLI, with the phone connected:
  ```bash
  pnpm --filter native exec tauri ios dev --open --host
  ```
  `--host` is needed for physical devices so the phone can reach the dev server
  over the network. If it can't pick the right network address, add
  `--force-ip-prompt` and choose your Mac's IP.

### Trust the developer certificate on the iPhone (first install only)

The first time you launch a free-signed build, the iPhone refuses to open it
("Untrusted Developer"). Fix it once:

1. On the iPhone: **Settings → General → VPN & Device Management**.
2. Under **Developer App**, tap your Apple ID email.
3. Tap **Trust "…"** and confirm.
4. Re-open Ollie from the home screen. It launches.

### The 7-day limit (read this)

Free Personal Team signing is valid for **7 days**. After that:
- The app on your phone **won't launch** — it just bounces / shows a signing
  error. Your data isn't deleted, the signature simply expired.
- **To re-sign:** plug the phone back in and re-run / re-press ▶ in Xcode
  (or re-run the `tauri ios dev --open --host` command). That mints a fresh
  7-day profile and reinstalls. Takes a minute.
- Other free-tier limits: max ~3 apps signed at once per Apple ID, and the
  profile is tied to the specific devices you registered.

> If weekly re-signing gets annoying, that's exactly the pain the **paid**
> program (Section 3) removes — its certs last a year.

---

## 3. Paid Apple Developer Program ($99/yr) — when and why

**You do NOT need this now.** Skip it until you're ready to put Ollie in front
of **beta testers** or **launch**. The free path (Section 2) covers your own
phone fine.

### What the $99/yr unlocks
- **TestFlight** — the only sane way to send builds to other people's iPhones
  (up to 10,000 external testers) without plugging in their phones.
- **App Store** distribution.
- **1-year signing certs** — no more weekly 7-day re-signing.
- **Push entitlements** — required only if Ollie ever does **remote/APNs push**
  (app-closed delivery from a server). Ollie's current notifications are
  **local** and need none of this — see `docs/REMINDER_PUSH_TODO.md`, which
  describes the remaining native device-token / APNs work that becomes relevant
  only once you go down the remote-push road. Until then, no push entitlement
  is needed.
- Background modes, associated domains, and other capabilities that require a
  real team.

### Enrollment outline (for later)
1. Go to <https://developer.apple.com/programs/> and click **Enroll**.
2. Sign in with the **same Apple ID** you'll use for signing.
3. As an individual: confirm your legal name + agree to the agreements, pay
   **$99/yr**. (Enrolling as an _organization_ requires a D-U-N-S number and
   takes longer — individual is fine to start.)
4. Apple verifies (minutes to a couple of days). Once active, your **Team ID**
   (a 10-character code like `AB12CD34EF`) appears in your account at
   <https://developer.apple.com/account> under Membership.
5. Plug that Team ID into the signing config (Section 4) and switch Xcode's
   Team dropdown from "Personal Team" to your paid team.

---

## 4. Where signing config lives

Two places matter. Know which is which so you don't chase a setting in the
wrong file.

### a) `tauri.conf.json` — the source-of-truth Team ID
The Apple Team ID can be pinned in the Tauri config under the iOS bundle
section. It currently is **not** set (the file only has `productName`,
`identifier: com.ollie.app`, etc.), which is correct for free Personal-Team
signing. To pin a team (do this once you have a stable/paid Team ID), add:

```jsonc
// apps/native/src-tauri/tauri.conf.json
{
  "bundle": {
    "iOS": {
      "developmentTeam": "AB12CD34EF",      // your 10-char Apple Team ID
      "minimumSystemVersion": "14.0"        // optional, defaults to 14.0
    }
  }
}
```

Equivalently, without editing the file, export the env var before building:
```bash
export APPLE_DEVELOPMENT_TEAM=AB12CD34EF
```
This is the right approach for CI and for keeping a personal team id out of git.

- `developmentTeam` / `APPLE_DEVELOPMENT_TEAM` — your Apple **Team ID**.
- `minimumSystemVersion` — lowest iOS version Ollie supports.
- The **bundle identifier** (`com.ollie.app`) lives at the **top level** of
  `tauri.conf.json` as `identifier`, not in the iOS section. This is the id
  your signing/provisioning is registered against.

### b) Xcode project (`gen/apple/`) — the UI you actually click
The **Signing & Capabilities** tab (Team dropdown, "Automatically manage
signing," capabilities) is set in Xcode and stored in the generated Xcode
project under `apps/native/src-tauri/gen/apple/`.

**Important:** `gen/apple/` is **generated** by Tauri. Treat the Team ID in
`tauri.conf.json` (or the `APPLE_DEVELOPMENT_TEAM` env var) as the durable
source of truth — Tauri feeds it into the Xcode project when it regenerates.
For quick local free-signing, picking the Team in the Xcode UI is fine; for
anything you want to survive a regen or work in CI, set it in config/env.

---

## 5. Notification permission on iOS

Ollie schedules **local** notifications through Apple's
`UNUserNotificationCenter` (see `apps/native/src-tauri/src/local_notifications.rs`).
The TS side (`apps/native/src/notify/systemNotify.ts`) requests permission
**lazily and idempotently**: it checks `isPermissionGranted()` first and only
calls `requestPermission()` if not already granted, and never re-prompts a user
who denied.

What this means on a real iPhone:

- **First request triggers the OS prompt.** The very first time Ollie tries to
  schedule/send a notification, iOS shows the standard _"'Ollie' Would Like to
  Send You Notifications"_ dialog. The user taps **Allow** or **Don't Allow**.
- If allowed → notifications fire (including the time-deferred reminders held by
  the OS even after the app is quit).
- If denied → no prompt again; the user must enable it manually in
  **Settings → Notifications → Ollie**.

### Info.plist usage strings — none required for local notifications
Apple requires a `Privacy - … Usage Description` string in `Info.plist` only for
**privacy-sensitive hardware/data**: camera (`NSCameraUsageDescription`),
microphone, photos, location, contacts, etc. **Local notifications do NOT have
a usage-string requirement** — the permission is requested at runtime via
`UNUserNotificationCenter.requestAuthorization`, and iOS supplies the prompt
copy itself. So unlike camera/mic, you do **not** need to add an `Info.plist`
key just to use local notifications. (This stays true as long as Ollie uses
local notifications only; remote/APNs push later would add entitlements, not a
usage string — that's the Section 3 / `REMINDER_PUSH_TODO.md` path.)

> If you ever add a usage-string-bearing capability, the Info.plist for the iOS
> build lives in the generated `gen/apple/` project (or via the
> `bundle.iOS.infoPlist` config), not in your TS code.

---

## 6. Troubleshooting

| Symptom | One-line fix |
|---|---|
| **`pod install` / CocoaPods errors** during build | Run `pod repo update`, then re-run the dev command. If pods are stale, delete `apps/native/src-tauri/gen/apple/Pods` and `Podfile.lock` and rebuild. |
| **"Signing for 'Ollie' requires a development team" / "no team"** | Open the Xcode project (Section 2 step 2), Signing & Capabilities → check "Automatically manage signing" → pick your Apple ID team. Or set `APPLE_DEVELOPMENT_TEAM`. |
| **"Untrusted Developer" on the iPhone** | iPhone → Settings → General → VPN & Device Management → tap your Apple ID → **Trust** (Section 2). |
| **App won't launch after ~a week** | Free 7-day signature expired — re-run `tauri ios dev --open --host` / press ▶ in Xcode to re-sign (Section 2, "The 7-day limit"). |
| **"No simulators found" / picker is empty** | `xcrun simctl list devices available` to check; install an iOS runtime via Xcode → Settings → Components. Then `tauri ios dev 'iPhone 16 Pro'`. |
| **"target ... not installed" / Rust target missing** | Add the iOS targets: `rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios` and rebuild. |
| **CLI exits as soon as Xcode opens** | When using `--open`, the Tauri CLI **must keep running** — don't Ctrl-C the terminal; leave it open while you work in Xcode. |
| **Physical device build can't reach the dev server** | Add `--host` (and `--force-ip-prompt` to pick your Mac's IP). Phone and Mac must be on the same network. |
| **`gen/apple` doesn't exist** | Re-run `pnpm --filter native exec tauri ios init` to regenerate the Xcode project. |
| **Stale build behaving oddly** | `pnpm --filter native exec tauri ios build --debug` clean, or delete `gen/apple/build` and rebuild. |

---

### TL;DR
1. **Today, zero account:** `pnpm --filter native exec tauri ios dev` → pick a Simulator.
2. **Your phone, free:** Xcode → Signing → your Apple ID (Personal Team) → ▶. Re-sign every 7 days.
3. **$99/yr:** only when you want TestFlight / App Store / 1-year certs — not now.
